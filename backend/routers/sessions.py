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

def _calculate_score(session: models.TestSession) -> tuple[float, float, dict]:
    """
    Підраховує бали залежно від типу кожного питання.

    single:
      1 бал якщо answer_data["answer_id"] == correct_data["answer_id"]

    multiple (MVP — strict match):
      1 бал якщо набір answer_ids точно збігається з correct_answer_ids.
      Для більш м'якого підрахунку — можна розкоментувати partial нижче.

    matching:
      +1 бал за кожну правильну пару (max = кількість пар у correct_data["pairs"])

    open:
      points балів якщо текст (після trim+lower) є в correct_data["answers"]
    """
    # Будуємо словник: {question_id: answer_data}
    answers_map: dict[int, Any] = {
        a.question_id: a.answer_data
        for a in session.answers
        if not a.is_skipped
    }

    score     = 0.0
    max_score = 0.0

    for q in session.test.questions:
        q_max = q.points
        max_score += q_max

        user_data    = answers_map.get(q.id)
        correct_data = q.correct_data or {}

        if user_data is None:
            continue  # Пропущено — 0 балів

        earned = _score_question(q.type, user_data, correct_data, q_max)
        score += earned

    return score, max_score, answers_map


def _score_question(
    q_type:       str,
    user_data:    Any,
    correct_data: dict,
    max_points:   float,
) -> float:
    """
    Повертає кількість балів за одне питання.
    Ніколи не кидає — захищено від невалідних даних через try/except.
    """
    try:
        if q_type == models.QuestionType.single:
            # {"answer_id": 5}
            return max_points if (
                isinstance(user_data, dict) and
                user_data.get("answer_id") == correct_data.get("answer_id")
            ) else 0.0

        elif q_type == models.QuestionType.multiple:
            # {"answer_ids": [3, 5]}
            # MVP — strict match: правильно тільки якщо набір точно збігається
            user_ids    = set(user_data.get("answer_ids", []) if isinstance(user_data, dict) else [])
            correct_ids = set(correct_data.get("answer_ids", []))
            if not correct_ids:
                return 0.0
            return max_points if user_ids == correct_ids else 0.0

            # Partial scoring (розкоментуй якщо потрібно):
            # correct = len(user_ids & correct_ids)
            # wrong   = len(user_ids - correct_ids)
            # earned  = max(0, correct - wrong) / len(correct_ids) * max_points
            # return round(earned, 2)

        elif q_type == models.QuestionType.matching:
            # {"pairs": {"1":"A","2":"C","3":"B","4":"D"}}
            correct_pairs = correct_data.get("pairs", {})
            user_pairs    = user_data.get("pairs", {}) if isinstance(user_data, dict) else {}
            if not correct_pairs:
                return 0.0
            # 1 бал за кожну правильну пару
            correct_count = sum(
                1 for key, val in correct_pairs.items()
                if str(user_pairs.get(str(key))) == str(val)
            )
            return float(correct_count)

        elif q_type == models.QuestionType.open:
            # {"text": "12"}
            correct_answers = [
                str(a).strip().lower()
                for a in correct_data.get("answers", [])
            ]
            user_text = str(user_data.get("text", "")).strip().lower() \
                if isinstance(user_data, dict) else ""
            return max_points if user_text in correct_answers else 0.0

    except Exception as e:
        import sys
        print(f"[score] Помилка підрахунку: {e}", file=sys.stderr)

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
