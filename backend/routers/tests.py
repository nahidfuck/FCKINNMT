"""
routers/tests.py — Ендпоінти для роботи з тестами
===================================================
GET /api/tests          — список усіх тестів
GET /api/tests/{id}     — деталі тесту + питання
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from config import settings
from database import get_db

# Префікс /api/tests підключається в main.py
router = APIRouter(prefix="/api/tests", tags=["Тести"])


@router.get("/", response_model=list[schemas.TestListItem])
def get_tests_list(
    subject_slug: str | None = None,  # ?subject_slug=math — фільтр по предмету
    db: Session = Depends(get_db)
):
    """
    Повертає список усіх опублікованих тестів.

    Feature Flag логіка:
    - Якщо PAYMENTS_ENABLED = False (бета):
        → Безкоштовні тести: is_locked = False
        → Платні тести: is_locked = True (але вони є в списку, просто заблоковані)
    - Якщо PAYMENTS_ENABLED = True:
        → Логіка оплати (розширимо пізніше)
    """
    query = db.query(models.Test).filter(models.Test.is_published == True)

    # Фільтрація по предмету (опціонально)
    if subject_slug:
        query = query.join(models.Subject).filter(
            models.Subject.slug == subject_slug
        )

    tests = query.order_by(models.Test.order_index).all()

    # Формуємо відповідь з обрахунком is_locked
    result = []
    for test in tests:
        is_locked = _is_test_locked(test)

        result.append(schemas.TestListItem(
            id=test.id,
            title=test.title,
            description=test.description,
            duration=test.duration,
            is_premium=test.is_premium,
            is_locked=is_locked,
            subject=test.subject,
            question_count=len(test.questions)
        ))

    return result


@router.get("/{test_id}", response_model=schemas.TestDetail)
def get_test_detail(test_id: int, db: Session = Depends(get_db)):
    """
    Повертає деталі тесту з питаннями (БЕЗ правильних відповідей).

    Якщо тест заблокований — повертаємо 403 Forbidden.
    """
    test = db.query(models.Test).filter(
        models.Test.id == test_id,
        models.Test.is_published == True
    ).first()

    if not test:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Тест з ID {test_id} не знайдено"
        )

    # Перевіряємо чи тест доступний
    if _is_test_locked(test):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "message": "Цей тест доступний тільки після релізу платформи.",
                "code": "TEST_LOCKED",
                "payments_enabled": settings.PAYMENTS_ENABLED
            }
        )

    return test


def _is_test_locked(test: models.Test) -> bool:
    """
    Допоміжна функція: визначає чи заблокований тест.

    Логіка Feature Flag:
    - Якщо платіжна система вимкнена (бета) → всі premium тести заблоковані
    - Якщо платіжна система увімкнена → TODO: перевірити оплату користувача
    """
    if not test.is_premium:
        return False  # Безкоштовний — завжди доступний

    if not settings.PAYMENTS_ENABLED:
        return True   # Бета: premium = заблоковано

    # TODO: Після додавання авторизації:
    # return not current_user.has_paid_for(test.id)
    return True
