"""
routers/reports.py — Ендпоінт для репортів помилок
====================================================
POST /api/reports — надіслати репорт про помилку в питанні
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter(prefix="/api/reports", tags=["Репорти"])


@router.post("/", response_model=schemas.BugReportPublic, status_code=201)
def create_report(payload: schemas.BugReportCreate, db: Session = Depends(get_db)):
    """
    Зберігає репорт про помилку від студента.

    Перевіряємо що питання існує, потім зберігаємо.
    Адміністратор побачить репорт у майбутній адмін-панелі.
    """
    # Перевіряємо чи питання існує
    question = db.query(models.Question).filter(
        models.Question.id == payload.question_id
    ).first()

    if not question:
        raise HTTPException(status_code=404, detail="Питання не знайдено")

    report = models.BugReport(
        question_id=payload.question_id,
        report_type=payload.report_type,
        comment=payload.comment
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return report
