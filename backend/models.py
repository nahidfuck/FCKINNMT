"""
models.py — ORM-моделі (структура бази даних)
==============================================
Кожен клас тут = одна таблиця в БД.
Кожен атрибут класу = одна колонка.

Схема зв'язків:
  Subject (предмет)
    └── Test (тест)
          └── Question (питання)
                └── AnswerOption (варіант відповіді)

  TestSession (сесія проходження)
    └── SessionAnswer (відповідь у сесії)

  BugReport (репорт помилки)
"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, String, Text, Float
)
from sqlalchemy.orm import relationship

from database import Base


# ============================================
# ENUM-типи (перелічувані значення)
# ============================================

class QuestionType(str, enum.Enum):
    """Тип питання. 'str' успадкування = серіалізується як рядок у JSON."""
    single   = "single"    # Одна правильна відповідь
    multiple = "multiple"  # Кілька правильних (НМТ тип 2, додамо пізніше)
    open     = "open"      # Відкрита відповідь (НМТ тип 3, додамо пізніше)


class SessionStatus(str, enum.Enum):
    """Статус сесії проходження тесту."""
    active    = "active"     # Тест в процесі
    finished  = "finished"   # Завершено студентом
    timed_out = "timed_out"  # Час вийшов


# ============================================
# МОДЕЛІ
# ============================================

class Subject(Base):
    """
    Таблиця предметів (Математика, Укр. мова, Історія).
    Потрібна для фільтрації та майбутнього B2B функціоналу.
    """
    __tablename__ = "subjects"

    id       = Column(Integer, primary_key=True, index=True)
    name     = Column(String(100), unique=True, nullable=False)  # "Математика"
    slug     = Column(String(50),  unique=True, nullable=False)  # "math"
    icon     = Column(String(10),  nullable=True)                # "📐"
    is_active = Column(Boolean, default=True)

    # Зворотній зв'язок: предмет → список тестів
    tests = relationship("Test", back_populates="subject")


class Test(Base):
    """
    Таблиця тестів. Один тест = один НМТ-іспит по предмету.

    Поле `is_premium` визначає чи тест платний.
    Але показувати/ховати його керує Feature Flag у config.py —
    сам тест завжди є в БД, тільки доступ блокується логікою.
    """
    __tablename__ = "tests"

    id          = Column(Integer, primary_key=True, index=True)
    subject_id  = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    title       = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    duration    = Column(Integer, nullable=False)  # Секунди (10800 = 180 хв)
    is_premium  = Column(Boolean, default=False)   # True = платний тест
    is_published = Column(Boolean, default=False)  # False = чернетка
    order_index  = Column(Integer, default=0)      # Порядок у списку
    created_at  = Column(DateTime, default=datetime.utcnow)

    # Зв'язки
    subject    = relationship("Subject", back_populates="tests")
    questions  = relationship("Question", back_populates="test",
                              order_by="Question.order_index")
    sessions   = relationship("TestSession", back_populates="test")

    # Довідкові матеріали (HTML-рядок)
    reference_materials = Column(Text, nullable=True)


class Question(Base):
    """
    Таблиця питань. Кожне питання належить одному тесту.

    `correct_answer_id` — FK на AnswerOption.
    ВАЖЛИВО: Це поле НІКОЛИ не відправляємо на фронтенд під час тесту!
    Тільки після завершення сесії.
    """
    __tablename__ = "questions"

    id           = Column(Integer, primary_key=True, index=True)
    test_id      = Column(Integer, ForeignKey("tests.id"), nullable=False)
    type         = Column(Enum(QuestionType), default=QuestionType.single)
    text         = Column(Text, nullable=False)           # Підтримує HTML
    order_index  = Column(Integer, default=0)             # Порядок у тесті
    points       = Column(Float, default=1.0)             # Балів за правильну
    explanation  = Column(Text, nullable=True)            # Пояснення після тесту

    # ForeignKey на правильну відповідь.
    # use_alter=True потрібно через циклічний FK (Question ↔ AnswerOption)
    correct_answer_id = Column(
        Integer,
        ForeignKey("answer_options.id", use_alter=True, name="fk_correct_answer"),
        nullable=True
    )

    # Зв'язки
    test           = relationship("Test", back_populates="questions")
    options        = relationship(
        "AnswerOption",
        back_populates="question",
        foreign_keys="AnswerOption.question_id",
        order_by="AnswerOption.order_index"
    )
    correct_answer = relationship(
        "AnswerOption",
        foreign_keys=[correct_answer_id]
    )


class AnswerOption(Base):
    """
    Таблиця варіантів відповідей.
    Кожен варіант належить одному питанню.
    """
    __tablename__ = "answer_options"

    id          = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    text        = Column(Text, nullable=False)      # Текст варіанту
    order_index = Column(Integer, default=0)        # А=0, Б=1, В=2, Г=3

    # Зв'язок назад до питання
    question = relationship(
        "Question",
        back_populates="options",
        foreign_keys=[question_id]
    )


class TestSession(Base):
    """
    Сесія проходження тесту одним студентом.

    Зараз без авторизації — ідентифікуємо по session_token.
    Пізніше додамо user_id після впровадження авторизації.

    `score` і `max_score` заповнюються при завершенні.
    """
    __tablename__ = "test_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    test_id       = Column(Integer, ForeignKey("tests.id"), nullable=False)
    session_token = Column(String(64), unique=True, nullable=False, index=True)
    status        = Column(Enum(SessionStatus), default=SessionStatus.active)
    time_left     = Column(Integer, nullable=False)  # Залишок часу в секундах
    score         = Column(Float, nullable=True)     # Набрані бали (після фінішу)
    max_score     = Column(Float, nullable=True)     # Максимум балів
    started_at    = Column(DateTime, default=datetime.utcnow)
    finished_at   = Column(DateTime, nullable=True)

    # Зв'язки
    test    = relationship("Test", back_populates="sessions")
    answers = relationship("SessionAnswer", back_populates="session")


class SessionAnswer(Base):
    """
    Відповідь студента на конкретне питання в межах сесії.
    Зберігається по одному запису на кожну відповідь/зміну відповіді.
    """
    __tablename__ = "session_answers"

    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("test_sessions.id"), nullable=False)
    question_id      = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer_option_id = Column(Integer, ForeignKey("answer_options.id"), nullable=True)
    is_skipped       = Column(Boolean, default=False)  # True = пропустив
    answered_at      = Column(DateTime, default=datetime.utcnow)

    # Зв'язки
    session = relationship("TestSession", back_populates="answers")


class BugReport(Base):
    """
    Репорти про помилки у питаннях від студентів.
    Статус: new → reviewed → resolved / rejected
    """
    __tablename__ = "bug_reports"

    id          = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    report_type = Column(String(50), nullable=False)  # wrong_answer, typo, etc.
    comment     = Column(Text, nullable=False)
    status      = Column(String(20), default="new")   # new, reviewed, resolved
    created_at  = Column(DateTime, default=datetime.utcnow)
