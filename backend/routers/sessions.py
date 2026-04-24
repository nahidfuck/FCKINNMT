"""
routers/sessions.py — Ендпоінти для сесій проходження тесту
=============================================================
POST /api/sessions/              — почати тест
POST /api/sessions/{token}/answer — зберегти відповідь
POST /api/sessions/{token}/finish — завершити тест
GET  /api/sessions/{token}        — стан сесії (відновлення)
"""

import secrets
from datetime import datetime
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from routers.auth import get_optional_user

router = APIRouter(prefix="/api/sessions", tags=["Сесії"])


@router.post("/", response_model=schemas.SessionPublic, status_code=201)
def create_session(
    payload:      schemas.SessionCreate,
    db:           Session               = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    test = db.query(models.Test).filter(
        models.Test.id == payload.test_id,
        models.Test.is_published == True
    ).first()

    if not test:
        raise HTTPException(status_code=404, detail="Тест не знайдено")

    token = secrets.token_hex(32)

    session = models.TestSession(
        test_id=payload.test_id,
        session_token=token,
        time_left=test.duration,
        status=models.SessionStatus.active,
        user_id=current_user.id if current_user else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.get("/{session_token}", response_model=schemas.SessionPublic)
def get_session(session_token: str, db: Session = Depends(get_db)):
    return _get_active_session(session_token, db)


@router.post("/{session_token}/answer", response_model=schemas.AnswerPublic)
def save_answer(
    session_token: str,
    payload:       schemas.AnswerCreate,
    db:            Session = Depends(get_db),
):
    """
    Зберігає відповідь студента.
    answer_data — JSON специфічний для типу питання.
    """
    session = _get_active_session(session_token, db)

    # Перевіряємо що питання належить цьому тесту
    question = db.query(models.Question).filter(
        models.Question.id      == payload.question_id,
        models.Question.test_id == session.test_id,
    ).first()

    if not question:
        raise HTTPException(status_code=404, detail="Питання не знайдено у цьому тесті")

    existing = db.query(models.SessionAnswer).filter(
        models.SessionAnswer.session_id  == session.id,
        models.SessionAnswer.question_id == payload.question_id,
    ).first()

    if existing:
        existing.answer_data = payload.answer_data
        existing.is_skipped  = payload.is_skipped
        existing.answered_at = datetime.utcnow()
    else:
        db.add(models.SessionAnswer(
            session_id=session.id,
            question_id=payload.question_id,
            answer_data=payload.answer_data,
            is_skipped=payload.is_skipped,
        ))

    session.time_left = min(session.time_left, payload.time_left)
    db.commit()

    return schemas.AnswerPublic(question_id=payload.question_id)


@router.post("/{session_token}/finish", response_model=schemas.SessionResult)
def finish_session(session_token: str, db: Session = Depends(get_db)):
    """
    Завершує тест і повертає результати з підрахунком балів на сервері.
    """
    session = _get_active_session(session_token, db)

    session.status      = models.SessionStatus.finished
    session.finished_at = datetime.utcnow()

    score, max_score, user_answers = _calculate_score(session)

    session.score     = score
    session.max_score = max_score
    db.commit()

    time_spent = session.test.duration - session.time_left

    # Формуємо питання з правильними відповідями (для екрану результатів)
    questions_with_answers = [
        schemas.QuestionResult(
            id=q.id,
            type=q.type,
            text=q.text,
            order_index=q.order_index,
            points=q.points,
            image_url=q.image_url,
            content=q.content,
            options=[
                schemas.AnswerOptionPublic(id=o.id, text=o.text, order_index=o.order_index)
                for o in q.options
            ],
            correct_data=q.correct_data,
            explanation=q.explanation,
        )
        for q in session.test.questions
    ]

    return schemas.SessionResult(
        session_id=session.id,
        status=session.status,
        score=score,
        max_score=max_score,
        percentage=round((score / max_score * 100) if max_score > 0 else 0, 1),
        time_spent=time_spent,
        questions=questions_with_answers,
        user_answers={str(a.question_id): a.answer_data for a in session.answers},
    )


# ============================================
# ПІДРАХУНОК БАЛІВ
# ============================================
import json

def _safe_json(data: Any) -> Any:
    """Хелпер: парсить JSON, якщо SQLite віддав його як рядок."""
    if isinstance(data, str):
        try:
            return json.loads(data)
        except:
            return {}
    return data

def _calculate_score(session: models.TestSession) -> tuple[float, float, dict]:
    answers_map: dict[int, Any] = {
        a.question_id: _safe_json(a.answer_data)
        for a in session.answers
        if not a.is_skipped
    }

    score     = 0.0
    max_score = 0.0

    for q in session.test.questions:
        correct_data = _safe_json(q.correct_data) or {}
        q_max = _question_max_score(q.type, correct_data, q.points)
        max_score += q_max

        user_data = answers_map.get(q.id)
        if user_data is None:
            continue

        earned = _score_question(q.type, user_data, correct_data, q.points)
        score  += earned

    return score, max_score, answers_map


def _question_max_score(q_type: str, correct_data: dict, base_points: float) -> float:
    if q_type == models.QuestionType.multiple:
        return float(len(correct_data.get("answer_ids", [])))
    if q_type == models.QuestionType.matching:
        return float(len(correct_data.get("pairs", {})))
    if q_type == models.QuestionType.open:
        return 2.0  # Завжди 2 бали за відкрите
    return base_points


def _score_question(q_type: str, user_data: Any, correct_data: dict, base_points: float) -> float:
    try:
        if q_type == models.QuestionType.single:
            return base_points if (
                isinstance(user_data, dict) and
                user_data.get("answer_id") == correct_data.get("answer_id")
            ) else 0.0

        elif q_type == models.QuestionType.multiple:
            if not isinstance(user_data, dict): return 0.0
            user_ids    = set(user_data.get("answer_ids") or [])
            correct_ids = set(correct_data.get("answer_ids") or [])
            if not correct_ids: return 0.0
            correct_hits = len(user_ids & correct_ids)
            wrong_hits   = len(user_ids - correct_ids)
            earned = max(0, correct_hits - wrong_hits)
            return float(earned)

        elif q_type == models.QuestionType.matching:
            if not isinstance(user_data, dict): return 0.0
            correct_pairs = correct_data.get("pairs") or {}
            user_pairs    = user_data.get("pairs") or {}
            if not correct_pairs: return 0.0
            correct_count = sum(
                1 for key, val in correct_pairs.items()
                if str(user_pairs.get(str(key), "")) == str(val)
            )
            return float(correct_count)

        elif q_type == models.QuestionType.open:
            if not isinstance(user_data, dict): return 0.0
            correct_answers = [str(a).strip().lower() for a in (correct_data.get("answers") or [])]
            user_text = str(user_data.get("text") or "").strip().lower()
            return 2.0 if (user_text and user_text in correct_answers) else 0.0
    except:
        pass
    return 0.0


# ============================================
# ДОПОМІЖНІ ФУНКЦІЇ
# ============================================

def _get_active_session(token: str, db: Session) -> models.TestSession:
    session = db.query(models.TestSession).filter(
        models.TestSession.session_token == token
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Сесію не знайдено")

    if session.status != models.SessionStatus.active:
        raise HTTPException(
            status_code=409,
            detail=f"Сесія вже завершена зі статусом: {session.status}"
        )

    return session
