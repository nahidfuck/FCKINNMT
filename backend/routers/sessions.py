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

    Правила нарахування:
      single   — 1 бал за точний збіг answer_id
      multiple — 1 бал за кожен правильний вибір (partial scoring)
      matching — 1 бал за кожну правильну пару
      open     — 2 бали за точний текстовий збіг (фіксовано)

    max_score рахується через _question_max_score(), бо matching і multiple
    мають змінний максимум (не просто question.points).
    """
    answers_map: dict[int, Any] = {
        a.question_id: a.answer_data
        for a in session.answers
        if not a.is_skipped
    }

    score     = 0.0
    max_score = 0.0

    for q in session.test.questions:
        correct_data = q.correct_data or {}

        # Максимум балів залежить від типу
        q_max = _question_max_score(q.type, correct_data, q.points)
        max_score += q_max

        user_data = answers_map.get(q.id)
        if user_data is None:
            continue  # Не відповів — 0

        earned = _score_question(q.type, user_data, correct_data, q.points)
        score  += earned

    return score, max_score, answers_map


def _question_max_score(q_type: str, correct_data: dict, base_points: float) -> float:
    """
    Повертає максимально можливий бал за питання.

    single  → base_points (зазвичай 1.0)
    multiple→ кількість правильних варіантів (1 бал кожен)
    matching→ кількість пар (1 бал кожна)
    open    → 2 бали (фіксовано за специфікацією НМТ)
    """
    if q_type == models.QuestionType.multiple:
        return float(len(correct_data.get("answer_ids", [])))
    if q_type == models.QuestionType.matching:
        return float(len(correct_data.get("pairs", {})))
    if q_type == models.QuestionType.open:
        return 2.0
    return base_points  # single


def _score_question(
    q_type:       str,
    user_data:    Any,
    correct_data: dict,
    base_points:  float,
) -> float:
    """
    Повертає зароблені бали за одне питання.
    Захищено від невалідних даних: будь-яка помилка → 0.

    single:
      Умова: answer_data["answer_id"] == correct_data["answer_id"]
      Бали:  base_points (зазвичай 1.0) або 0

    multiple (partial scoring):
      За кожен ID в correct_ids: +1 якщо є у user_ids, 0 якщо нема.
      Штраф за зайві (неправильні) варіанти: -1 за кожен.
      Мінімум 0 балів (не від'ємний).

    matching:
      За кожну пару в correct_pairs: +1 якщо user вгадав, 0 якщо ні.
      Порівняння str-to-str щоб уникнути проблем типів ("1" == 1).

    open:
      Умова: user_text.strip().lower() є в списку correct_data["answers"]
      Бали: 2.0 (фіксовано) або 0
    """
    try:
        # ── SINGLE ──────────────────────────────────────────────
        if q_type == models.QuestionType.single:
            return base_points if (
                isinstance(user_data, dict) and
                user_data.get("answer_id") == correct_data.get("answer_id")
            ) else 0.0

        # ── MULTIPLE (partial, зі штрафом за зайве) ─────────────
        elif q_type == models.QuestionType.multiple:
            if not isinstance(user_data, dict):
                return 0.0
            user_ids    = set(user_data.get("answer_ids") or [])
            correct_ids = set(correct_data.get("answer_ids") or [])
            if not correct_ids:
                return 0.0

            correct_hits = len(user_ids & correct_ids)   # правильно вибрані
            wrong_hits   = len(user_ids - correct_ids)   # зайві (помилкові)

            # Штраф: -1 за кожен зайвий вибір, але не менше 0
            earned = max(0, correct_hits - wrong_hits)
            return float(earned)

        # ── MATCHING ─────────────────────────────────────────────
        elif q_type == models.QuestionType.matching:
            if not isinstance(user_data, dict):
                return 0.0
            correct_pairs = correct_data.get("pairs") or {}
            user_pairs    = user_data.get("pairs") or {}
            if not correct_pairs:
                return 0.0

            # str(key) і str(val) — захист від int/str невідповідності
            correct_count = sum(
                1 for key, val in correct_pairs.items()
                if str(user_pairs.get(str(key), "")) == str(val)
            )
            return float(correct_count)

        # ── OPEN ──────────────────────────────────────────────────
        elif q_type == models.QuestionType.open:
            if not isinstance(user_data, dict):
                return 0.0
            correct_answers = [
                str(a).strip().lower()
                for a in (correct_data.get("answers") or [])
            ]
            user_text = str(user_data.get("text") or "").strip().lower()
            # Фіксовано 2 бали за правильну відповідь (специфікація НМТ)
            return 2.0 if (user_text and user_text in correct_answers) else 0.0

    except Exception as e:
        import sys
        print(f"[score] Помилка підрахунку ({q_type}): {e}", file=sys.stderr)

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
