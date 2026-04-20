"""
routers/teachers.py — B2B функціонал для вчителів
===================================================
Всі ендпоінти захищені залежністю get_current_teacher,
яка перевіряє role == "teacher".

POST /api/teachers/groups       — створити групу
GET  /api/teachers/groups       — список своїх груп
GET  /api/teachers/stats        — статистика учнів
"""

import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from routers.auth import get_current_user

router = APIRouter(prefix="/api/teachers", tags=["Вчитель"])


# ============================================
# ЗАЛЕЖНІСТЬ: тільки для вчителів
# ============================================

def get_current_teacher(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """
    Залежність-обгортка: перевіряє що поточний юзер — вчитель.

    Використання:
        @router.get("/something")
        def route(teacher = Depends(get_current_teacher)):
            ...
    """
    if current_user.role not in (models.UserRole.teacher, models.UserRole.admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Доступ тільки для вчителів"
        )
    return current_user


# ============================================
# ЕНДПОІНТИ
# ============================================

@router.post(
    "/groups",
    response_model=schemas.GroupPublic,
    status_code=201,
    summary="Створити нову групу"
)
def create_group(
    payload: schemas.GroupCreate,
    db:      Session      = Depends(get_db),
    teacher: models.User  = Depends(get_current_teacher),
):
    """
    Створює нову групу і генерує унікальний invite_code.
    Код складається з великих літер + цифр, 8 символів — легко продиктувати учням.
    """
    invite_code = _generate_unique_invite_code(db)

    group = models.Group(
        name=payload.name.strip(),
        invite_code=invite_code,
        teacher_id=teacher.id,
    )
    db.add(group)
    db.commit()
    db.refresh(group)

    return schemas.GroupPublic(
        id=group.id,
        name=group.name,
        invite_code=group.invite_code,
        teacher_id=group.teacher_id,
        created_at=group.created_at,
        member_count=0,  # Щойно створена — учнів ще нема
    )


@router.get(
    "/groups",
    response_model=list[schemas.GroupPublic],
    summary="Мої групи"
)
def get_my_groups(
    db:      Session     = Depends(get_db),
    teacher: models.User = Depends(get_current_teacher),
):
    """
    Повертає всі групи цього вчителя з кількістю учнів.
    """
    groups = db.query(models.Group).filter(
        models.Group.teacher_id == teacher.id
    ).order_by(models.Group.created_at.desc()).all()

    result = []
    for group in groups:
        # Рахуємо учнів у групі окремим запитом
        # (не через len(group.members) — це завантажить усіх юзерів)
        member_count = db.query(models.User).filter(
            models.User.group_id == group.id
        ).count()

        result.append(schemas.GroupPublic(
            id=group.id,
            name=group.name,
            invite_code=group.invite_code,
            teacher_id=group.teacher_id,
            created_at=group.created_at,
            member_count=member_count,
        ))

    return result


@router.get(
    "/stats",
    response_model=list[schemas.StudentStatRow],
    summary="Статистика учнів моїх груп"
)
def get_students_stats(
    db:      Session     = Depends(get_db),
    teacher: models.User = Depends(get_current_teacher),
):
    """
    Повертає результати всіх завершених тестів учнів з груп цього вчителя.

    Запит:
      1. Знаходимо всі групи вчителя
      2. Знаходимо всіх учнів цих груп
      3. Завантажуємо завершені сесії цих учнів з деталями тесту
    """
    # Знаходимо ID всіх груп цього вчителя
    group_ids = [
        g.id for g in db.query(models.Group.id).filter(
            models.Group.teacher_id == teacher.id
        ).all()
    ]

    if not group_ids:
        return []  # Вчитель ще не створив жодної групи

    # Знаходимо всіх учнів цих груп
    students = db.query(models.User).filter(
        models.User.group_id.in_(group_ids)
    ).all()

    if not students:
        return []  # Ще ніхто не приєднався

    student_ids = [s.id for s in students]

    # Словник для швидкого доступу: user_id → user
    students_map = {s.id: s for s in students}

    # Словник для швидкого доступу: group_id → group_name
    groups_map = {
        g.id: g.name for g in db.query(models.Group).filter(
            models.Group.id.in_(group_ids)
        ).all()
    }

    # Завантажуємо завершені сесії цих учнів
    sessions = (
        db.query(models.TestSession)
        .filter(
            models.TestSession.user_id.in_(student_ids),
            models.TestSession.status == models.SessionStatus.finished,
            models.TestSession.score.isnot(None),
        )
        .order_by(models.TestSession.finished_at.desc())
        .all()
    )

    result = []
    for session in sessions:
        student   = students_map.get(session.user_id)
        if not student:
            continue

        group_name = groups_map.get(student.group_id, "—")
        percentage = round(
            (session.score / session.max_score * 100)
            if session.max_score and session.max_score > 0
            else 0,
            1
        )

        result.append(schemas.StudentStatRow(
            student_name=student.full_name or student.email.split("@")[0],
            student_email=student.email,
            group_name=group_name,
            test_title=session.test.title,
            score=session.score,
            max_score=session.max_score,
            percentage=percentage,
            finished_at=session.finished_at,
        ))

    return result


# ============================================
# УТИЛІТИ
# ============================================

def _generate_unique_invite_code(db: Session, length: int = 8) -> str:
    """
    Генерує унікальний invite_code.
    Символи: великі літери + цифри (без 0, O, I, L — легше читати)
    Перевіряє що такого коду ще нема в БД.
    """
    alphabet = (string.ascii_uppercase + string.digits)\
               .replace("0", "").replace("O", "")\
               .replace("I", "").replace("L", "")

    for _ in range(10):  # Максимум 10 спроб — на практиці завжди з першої
        code = "".join(secrets.choice(alphabet) for _ in range(length))
        exists = db.query(models.Group).filter(
            models.Group.invite_code == code
        ).first()
        if not exists:
            return code

    raise RuntimeError("Не вдалося згенерувати унікальний invite_code")


@router.post(
    "/groups/{group_id}/assign",
    status_code=201,
    summary="Задати тест групі"
)
def assign_test_to_group(
    group_id: int,
    payload:  schemas.AssignTestPayload,
    db:       Session     = Depends(get_db),
    teacher:  models.User = Depends(get_current_teacher),
):
    """
    Прив'язує тест до групи.
    Ідемпотентний: повторне призначення того ж тесту не створює дубль.
    """
    # Перевіряємо що група належить цьому вчителю
    group = db.query(models.Group).filter(
        models.Group.id == group_id,
        models.Group.teacher_id == teacher.id,
    ).first()

    if not group:
        raise HTTPException(status_code=404, detail="Групу не знайдено")

    # Перевіряємо що тест існує
    test = db.query(models.Test).filter(
        models.Test.id == payload.test_id,
        models.Test.is_published == True,
    ).first()

    if not test:
        raise HTTPException(status_code=404, detail="Тест не знайдено")

    # Ідемпотентність: якщо вже призначено — нічого не робимо
    existing = db.query(models.GroupTest).filter(
        models.GroupTest.group_id == group_id,
        models.GroupTest.test_id  == payload.test_id,
    ).first()

    if existing:
        return {"message": "Тест вже призначено цій групі", "already_assigned": True}

    assignment = models.GroupTest(group_id=group_id, test_id=payload.test_id)
    db.add(assignment)
    db.commit()

    return {
        "message": f"Тест «{test.title}» успішно задано групі «{group.name}»",
        "already_assigned": False,
    }
