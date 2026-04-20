"""
schemas.py — Pydantic-схеми (контракти API)
============================================
Pydantic — це бібліотека валідації даних.
FastAPI використовує її для двох речей:
  1. Валідація вхідних даних (тіло запиту від клієнта)
  2. Серіалізація вихідних даних (що відправляємо клієнту)

Конвенція іменування:
  - XxxBase    — спільні поля
  - XxxCreate  — схема для створення (POST-запит)
  - XxxPublic  — схема для відповіді (що бачить клієнт)

ВАЖЛИВО: Схеми — це НЕ моделі БД. Вони описують форму JSON.
Один і той самий об'єкт БД може мати різні схеми:
  - QuestionPublic  — без correct_answer_id (для тесту)
  - QuestionResult  — з correct_answer_id (після завершення)
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


# ============================================
# ANSWER OPTIONS (Варіанти відповідей)
# ============================================

class AnswerOptionPublic(BaseModel):
    """Варіант відповіді — те що бачить студент під час тесту."""
    id:   int
    text: str
    order_index: int

    class Config:
        from_attributes = True  # Дозволяє створювати з ORM-об'єктів


# ============================================
# QUESTIONS (Питання)
# ============================================

class QuestionPublic(BaseModel):
    """
    Питання БЕЗ правильної відповіді.
    Саме цю схему відправляємо клієнту під час тесту.
    """
    id:          int
    type:        str
    text:        str
    order_index: int
    options:     list[AnswerOptionPublic]
    # correct_answer_id — НАВМИСНО ВІДСУТНІЙ

    class Config:
        from_attributes = True


class QuestionResult(QuestionPublic):
    """
    Питання З правильною відповіддю.
    Відправляємо тільки після завершення сесії.
    """
    correct_answer_id: Optional[int] = None
    explanation:       Optional[str] = None


# ============================================
# TESTS (Тести)
# ============================================

class SubjectPublic(BaseModel):
    id:   int
    name: str
    slug: str
    icon: Optional[str] = None

    class Config:
        from_attributes = True


class TestListItem(BaseModel):
    """
    Скорочена схема тесту для списку.
    Не містить питань (вони великі, не потрібні для списку).
    """
    id:          int
    title:       str
    description: Optional[str] = None
    duration:    int           # Секунди
    is_premium:  bool
    is_locked:   bool          # Вираховується в роутері (Feature Flag)
    subject:     SubjectPublic
    question_count: int        # Скільки питань (рахуємо окремо)

    class Config:
        from_attributes = True


class TestDetail(BaseModel):
    """
    Повна схема тесту — з питаннями.
    Відправляємо коли студент відкриває тест.
    """
    id:                  int
    title:               str
    duration:            int
    subject:             SubjectPublic
    questions:           list[QuestionPublic]
    reference_materials: Optional[str] = None

    class Config:
        from_attributes = True


# ============================================
# SESSIONS (Сесії проходження)
# ============================================

class SessionCreate(BaseModel):
    """Тіло POST /sessions — що надсилає клієнт щоб почати тест."""
    test_id: int = Field(..., gt=0, description="ID тесту, який хочемо пройти")


class SessionPublic(BaseModel):
    """Відповідь після створення сесії."""
    id:            int
    session_token: str     # Токен для наступних запитів
    test_id:       int
    status:        str
    time_left:     int
    started_at:    datetime

    class Config:
        from_attributes = True


class AnswerCreate(BaseModel):
    """
    Тіло POST /sessions/{id}/answer — відповідь на питання.
    answer_option_id = None якщо студент "пропустив".
    """
    question_id:      int = Field(..., gt=0)
    answer_option_id: Optional[int] = Field(None, gt=0)
    is_skipped:       bool = False
    time_left:        int  = Field(..., ge=0, description="Залишок часу для синхронізації")


class AnswerPublic(BaseModel):
    """Відповідь після збереження відповіді."""
    question_id:     int
    is_saved:        bool = True
    message:         str  = "Відповідь збережено"


class SessionResult(BaseModel):
    """
    Результати тесту після завершення.
    Містить питання з правильними відповідями.
    """
    session_id:      int
    status:          str
    score:           float
    max_score:       float
    percentage:      float
    time_spent:      int            # Скільки секунд витрачено
    questions:       list[QuestionResult]
    user_answers:    dict[str, Optional[int]]  # ключі — str, бо JSON серіалізує int-ключі як рядки

    class Config:
        from_attributes = True


# ============================================
# BUG REPORTS (Репорти)
# ============================================

class BugReportCreate(BaseModel):
    """Тіло POST /reports."""
    question_id: int    = Field(..., gt=0)
    report_type: str    = Field(..., min_length=3, max_length=50)
    comment:     str    = Field(..., min_length=5, max_length=1000)


class BugReportPublic(BaseModel):
    """Підтвердження прийому репорту."""
    id:         int
    status:     str = "new"
    message:    str = "Дякуємо! Репорт прийнято."
    created_at: datetime

    class Config:
        from_attributes = True


# ============================================
# AUTH SCHEMAS
# ============================================

class UserRegister(BaseModel):
    """Тіло POST /api/auth/register."""
    email:     str       = Field(..., min_length=5, max_length=255)
    password:  str       = Field(..., min_length=8, max_length=100,
                                 description="Мінімум 8 символів")
    full_name: Optional[str] = Field(None, max_length=200)
    # Роль передається при реєстрації. Валідація на рівні роутера.
    role:      str            = Field("student", pattern="^(student|teacher)$")


class UserPublic(BaseModel):
    """Публічні дані юзера — те що повертаємо клієнту (без пароля)."""
    id:         int
    email:      str
    full_name:  Optional[str] = None
    role:       str
    group_id:   Optional[int] = None   # ID групи (для студентів)
    group_name: Optional[str] = None   # Назва групи (для зручності фронтенду)
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    """Відповідь після успішного логіну."""
    access_token: str
    token_type:   str = "bearer"
    user:         UserPublic    # Зручно: повертаємо дані юзера разом з токеном


# ============================================
# TEACHER / GROUP SCHEMAS
# ============================================

class GroupCreate(BaseModel):
    """Тіло POST /api/teachers/groups."""
    name: str = Field(..., min_length=2, max_length=200,
                      description="Назва групи, наприклад: '11-А Математика'")


class GroupPublic(BaseModel):
    """Публічні дані групи."""
    id:          int
    name:        str
    invite_code: str          # Показуємо вчителю щоб він роздав учням
    teacher_id:  int
    created_at:  datetime
    member_count: int = 0     # Скільки учнів у групі (рахуємо окремо)

    class Config:
        from_attributes = True


class StudentStatRow(BaseModel):
    """
    Один рядок у таблиці статистики вчителя.
    Відповідає одній завершеній сесії одного учня.
    """
    student_name:  str           # full_name або email учня
    student_email: str
    group_name:    str
    test_title:    str
    score:         float
    max_score:     float
    percentage:    float
    finished_at:   Optional[datetime] = None

    class Config:
        from_attributes = True


class JoinGroupResponse(BaseModel):
    """Відповідь після успішного приєднання до групи."""
    message:    str = "Ви успішно приєднались до групи!"
    group_name: str


# ============================================
# GROUP TEST SCHEMAS
# ============================================

class AssignTestPayload(BaseModel):
    """Тіло POST /api/teachers/groups/{group_id}/assign."""
    test_id: int = Field(..., gt=0)


class AssignedTestItem(BaseModel):
    """Один тест із списку виданих групі."""
    id:          int
    title:       str
    subject:     SubjectPublic
    duration:    int
    question_count: int = 0

    class Config:
        from_attributes = True


class MyGroupResponse(BaseModel):
    """Відповідь GET /api/students/my-group."""
    group_id:       int
    group_name:     str
    invite_code:    str
    assigned_tests: list[AssignedTestItem] = []
