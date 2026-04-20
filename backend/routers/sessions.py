"""
routers/sessions.py — Ендпоінти для сесій проходження тесту
=============================================================
POST /api/sessions               — почати тест
POST /api/sessions/{id}/answer   — зберегти відповідь
POST /api/sessions/{id}/finish   — завершити тест
GET  /api/sessions/{token}       — отримати стан сесії (для відновлення)
"""

import secrets
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from routers.auth import get_optional_user  # nullable auth залежність

router = APIRouter(prefix="/api/sessions", tags=["Сесії"])


@router.post("/", response_model=schemas.SessionPublic, status_code=201)
def create_session(
    payload:      schemas.SessionCreate,
    db:           Session              = Depends(get_db),
    current_user: Optional[models.User] = Depends(get_optional_user),
):
    """
    Починає нову сесію проходження тесту.
    Якщо юзер авторизований — прив'язуємо сесію до user_id.
    Це потрібно для статистики вчителя.
    """
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
        # Прив'язуємо до юзера якщо він авторизований
        user_id=current_user.id if current_user else None,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return session


@router.get("/{session_token}", response_model=schemas.SessionPublic)
def get_session(session_token: str, db: Session = Depends(get_db)):
    """
    Повертає стан сесії за токеном.
    Використовується клієнтом для відновлення після перезавантаження.
    (Доповнення до localStorage — серверна копія стану)
    """
    session = _get_active_session(session_token, db)
    return session


@router.post("/{session_token}/answer", response_model=schemas.AnswerPublic)
def save_answer(
    session_token: str,
    payload: schemas.AnswerCreate,
    db: Session = Depends(get_db)
):
    """
    Зберігає або оновлює відповідь на питання.

    Логіка:
    - Якщо відповідь на це питання вже є → оновлюємо (студент передумав)
    - Якщо нема → створюємо нову
    - Також синхронізуємо time_left із клієнтом (захист від читингу)
    """
    session = _get_active_session(session_token, db)

    # Перевіряємо чи питання належить цьому тесту
    question = db.query(models.Question).filter(
        models.Question.id == payload.question_id,
        models.Question.test_id == session.test_id
    ).first()

    if not question:
        raise HTTPException(
            status_code=404,
            detail="Питання не знайдено у цьому тесті"
        )

    # Шукаємо існуючу відповідь
    existing = db.query(models.SessionAnswer).filter(
        models.SessionAnswer.session_id  == session.id,
        models.SessionAnswer.question_id == payload.question_id
    ).first()

    if existing:
        # Оновлюємо існуючу відповідь
        existing.answer_option_id = payload.answer_option_id
        existing.is_skipped       = payload.is_skipped
        existing.answered_at      = datetime.utcnow()
    else:
        # Створюємо нову
        answer = models.SessionAnswer(
            session_id=session.id,
            question_id=payload.question_id,
            answer_option_id=payload.answer_option_id,
            is_skipped=payload.is_skipped
        )
        db.add(answer)

    # Синхронізуємо час (беремо мінімум між серверним і клієнтським)
    # Це захист: клієнт не може "подарувати" собі більше часу
    session.time_left = min(session.time_left, payload.time_left)

    db.commit()

    return schemas.AnswerPublic(question_id=payload.question_id)


@router.post("/{session_token}/finish", response_model=schemas.SessionResult)
def finish_session(session_token: str, db: Session = Depends(get_db)):
    """
    Завершує тест і повертає результати.

    Підраховує бали на сервері (клієнту не довіряємо).
    Повертає питання з правильними відповідями для показу результатів.
    """
    session = _get_active_session(session_token, db)

    # Позначаємо сесію як завершену
    session.status      = models.SessionStatus.finished
    session.finished_at = datetime.utcnow()

    # Підраховуємо результат
    score, max_score, user_answers = _calculate_score(session, db)

    session.score     = score
    session.max_score = max_score
    db.commit()

    # Час витрачено = duration тесту - залишок
    time_spent = session.test.duration - session.time_left

    # Формуємо питання З правильними відповідями (для екрану результатів)
    questions_with_answers = [
        schemas.QuestionResult(
            id=q.id,
            type=q.type,
            text=q.text,
            order_index=q.order_index,
            options=[schemas.AnswerOptionPublic(
                id=o.id, text=o.text, order_index=o.order_index
            ) for o in q.options],
            correct_answer_id=q.correct_answer_id,
            explanation=q.explanation
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
        user_answers={str(k): v for k, v in user_answers.items()}
    )


# ============================================
# ДОПОМІЖНІ ФУНКЦІЇ
# ============================================

def _get_active_session(token: str, db: Session) -> models.TestSession:
    """Знаходить активну сесію за токеном або кидає 404/409."""
    session = db.query(models.TestSession).filter(
        models.TestSession.session_token == token
    ).first()

    if not session:
        raise HTTPException(status_code=404, detail="Сесію не знайдено")

    if session.status != models.SessionStatus.active:
        raise HTTPException(
            status_code=409,  # 409 Conflict — сесія вже завершена
            detail=f"Сесія вже завершена зі статусом: {session.status}"
        )

    return session


def _calculate_score(
    session: models.TestSession,
    db: Session
) -> tuple[float, float, dict]:
    """
    Підраховує бали за тест.

    Повертає: (набрані_бали, максимум_балів, словник_відповідей)
    """
    score = 0.0
    max_score = 0.0

    # Словник: {question_id: answer_option_id}
    user_answers: dict[int, Optional[int]] = {}

    # Будуємо словник відповідей студента
    for answer in session.answers:
        user_answers[answer.question_id] = answer.answer_option_id

    # Перевіряємо кожне питання
    for question in session.test.questions:
        max_score += question.points

        user_answer_id = user_answers.get(question.id)

        if user_answer_id and user_answer_id == question.correct_answer_id:
            score += question.points

    return score, max_score, user_answers
