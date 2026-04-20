"""
routers/students.py — Ендпоінти для студентів
===============================================
POST /api/students/join/{invite_code} — приєднатись до групи за кодом
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from routers.auth import get_current_user

router = APIRouter(prefix="/api/students", tags=["Студент"])


@router.post(
    "/join/{invite_code}",
    response_model=schemas.JoinGroupResponse,
    summary="Приєднатись до групи вчителя"
)
def join_group(
    invite_code:  str,
    db:           Session      = Depends(get_db),
    current_user: models.User  = Depends(get_current_user),
):
    """
    Учень вводить invite_code → бекенд знаходить групу →
    оновлює group_id цьому учню.

    Правила:
    - Тільки студенти можуть приєднуватись (не вчителі)
    - Якщо вже в цій групі — повертаємо успіх (ідемпотентно)
    - Якщо в іншій групі — переводимо (MVP: одна група на студента)
    """
    # Вчитель не може приєднуватись до груп як учень
    if current_user.role == models.UserRole.teacher:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Вчителі не можуть приєднуватись до груп як учні"
        )

    # Шукаємо групу за кодом
    group = db.query(models.Group).filter(
        models.Group.invite_code == invite_code.strip().upper()
    ).first()

    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Групу з таким кодом не знайдено. Перевірте код та спробуйте ще раз."
        )

    # Якщо вже в цій групі — нічого не міняємо
    if current_user.group_id == group.id:
        return schemas.JoinGroupResponse(
            message="Ви вже перебуваєте в цій групі.",
            group_name=group.name,
        )

    # Оновлюємо group_id
    current_user.group_id = group.id
    db.commit()

    return schemas.JoinGroupResponse(
        message="Ви успішно приєднались до групи!",
        group_name=group.name,
    )
