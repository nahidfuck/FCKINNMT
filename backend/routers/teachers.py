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
    Повертає результати ТІЛЬКИ по тестах, які вчитель задав своїм групам.

    Логіка:
      1. Отримуємо всі групи вчителя.
      2. Для кожної групи — список ID тестів, що їй задані (через GroupTest).
      3. Збираємо ID учнів кожної групи.
      4. З БД беремо лише ті завершені сесії, де:
           - user_id належить до потрібної групи, І
           - test_id входить до списку ЗАДАНИХ тестів саме цієї групи.
         (учень міг пройти 100 інших тестів — вчитель їх не побачить)
    """
    # ── Крок 1: групи вчителя ─────────────────────────────────
    groups = db.query(models.Group).filter(
        models.Group.teacher_id == teacher.id
    ).all()

    if not groups:
        return []

    # ── Крок 2: для кожної групи — множина заданих test_id ────
    # group_assigned: { group_id → set(test_id) }
    group_assigned: dict[int, set[int]] = {}
    for group in groups:
        assigned_rows = db.query(models.GroupTest.test_id).filter(
            models.GroupTest.group_id == group.id
        ).all()
        group_assigned[group.id] = {row.test_id for row in assigned_rows}

    # ── Крок 3: учні кожної групи ─────────────────────────────
    group_ids   = [g.id for g in groups]
    students    = db.query(models.User).filter(
        models.User.group_id.in_(group_ids)
    ).all()

    if not students:
        return []

    # Допоміжні словники для O(1)-доступу
    students_map: dict[int, models.User] = {s.id: s for s in students}
    groups_map:   dict[int, str]         = {g.id: g.name for g in groups}
    student_ids = list(students_map.keys())

    # ── Крок 4: завершені сесії ────────────────────────────────
    # Спочатку отримуємо всі завершені сесії учнів — потім фільтруємо
    # в Python, бо умова "test_id in assigned_ids ДЛЯ ГРУПИ СТУДЕНТА"
    # потребує join-у через group_id студента, що зручніше зробити в коді.
    all_sessions = (
        db.query(models.TestSession)
        .filter(
            models.TestSession.user_id.in_(student_ids),
            models.TestSession.status   == models.SessionStatus.finished,
            models.TestSession.score.isnot(None),
        )
        .order_by(models.TestSession.finished_at.desc())
        .all()
    )

    result = []
    for session in all_sessions:
        student = students_map.get(session.user_id)
        if not student or student.group_id is None:
            continue

        # Ключова перевірка: чи цей тест задано групі студента?
        assigned_for_group = group_assigned.get(student.group_id, set())
        if session.test_id not in assigned_for_group:
            continue   # ← учень пройшов це сам, вчитель не бачить

        group_name = groups_map.get(student.group_id, "—")
        percentage = round(
            session.score / session.max_score * 100
            if session.max_score and session.max_score > 0
            else 0,
            1,
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
