"""
models.py — ORM-моделі (структура бази даних)
==============================================
Схема зв'язків:
  Group (група/клас)
    ├── teacher: User (хто створив)
    └── members: [User] (учні)

  User
    ├── group: Group (nullable — до якої групи належить)
    └── sessions: [TestSession]

  Subject → Test → Question → AnswerOption
  TestSession (прив'язана до User) → SessionAnswer
  BugReport
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
# ENUM-типи
# ============================================

class QuestionType(str, enum.Enum):
    single   = "single"
    multiple = "multiple"
    open     = "open"


class SessionStatus(str, enum.Enum):
    active    = "active"
    finished  = "finished"
    timed_out = "timed_out"


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin   = "admin"


# ============================================
# GROUP (визначаємо ДО User, щоб FK працював)
# ============================================

class Group(Base):
    """
    Група/клас вчителя.

    Вчитель створює групу → отримує invite_code → роздає учням.
    Учень вводить код → його user.group_id оновлюється.

    Один учень може належати тільки до однієї групи (поточне MVP).
    """
    __tablename__ = "groups"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)           # "11-А Математика"
    invite_code = Column(String(16), unique=True, nullable=False, index=True)
    teacher_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    # Зв'язки
    teacher = relationship("User", foreign_keys=[teacher_id], back_populates="taught_groups")
    members        = relationship("User", foreign_keys="User.group_id", back_populates="group")
    assigned_tests = relationship("GroupTest", back_populates="group")


# ============================================
# USER
# ============================================

class User(Base):
    """
    Таблиця користувачів.

    role:     student | teacher | admin
    group_id: nullable FK → Group (для студентів)
    """
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    email           = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name       = Column(String(200), nullable=True)
    role            = Column(Enum(UserRole), default=UserRole.student, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)

    # Nullable FK — студент може бути без групи
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True)

    # Зв'язки
    group         = relationship("Group", foreign_keys=[group_id], back_populates="members")
    taught_groups = relationship("Group", foreign_keys="Group.teacher_id", back_populates="teacher")
    sessions      = relationship("TestSession", back_populates="user")


# ============================================
# SUBJECT / TEST / QUESTION / ANSWER
# ============================================

class Subject(Base):
    __tablename__ = "subjects"

    id        = Column(Integer, primary_key=True, index=True)
    name      = Column(String(100), unique=True, nullable=False)
    slug      = Column(String(50),  unique=True, nullable=False)
    icon      = Column(String(10),  nullable=True)
    is_active = Column(Boolean, default=True)

    tests = relationship("Test", back_populates="subject")


class Test(Base):
    __tablename__ = "tests"

    id                  = Column(Integer, primary_key=True, index=True)
    subject_id          = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    title               = Column(String(200), nullable=False)
    description         = Column(Text, nullable=True)
    duration            = Column(Integer, nullable=False)
    is_premium          = Column(Boolean, default=False)
    is_published        = Column(Boolean, default=False)
    order_index         = Column(Integer, default=0)
    created_at          = Column(DateTime, default=datetime.utcnow)
    reference_materials = Column(Text, nullable=True)

    subject   = relationship("Subject", back_populates="tests")
    questions = relationship("Question", back_populates="test",
                             order_by="Question.order_index")
    sessions  = relationship("TestSession", back_populates="test")


class Question(Base):
    __tablename__ = "questions"

    id                = Column(Integer, primary_key=True, index=True)
    test_id           = Column(Integer, ForeignKey("tests.id"), nullable=False)
    type              = Column(Enum(QuestionType), default=QuestionType.single)
    text              = Column(Text, nullable=False)
    order_index       = Column(Integer, default=0)
    points            = Column(Float, default=1.0)
    explanation       = Column(Text, nullable=True)
    correct_answer_id = Column(
        Integer,
        ForeignKey("answer_options.id", use_alter=True, name="fk_correct_answer"),
        nullable=True
    )

    test           = relationship("Test", back_populates="questions")
    options        = relationship(
        "AnswerOption",
        back_populates="question",
        foreign_keys="AnswerOption.question_id",
        order_by="AnswerOption.order_index"
    )
    correct_answer = relationship("AnswerOption", foreign_keys=[correct_answer_id])


class AnswerOption(Base):
    __tablename__ = "answer_options"

    id          = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    text        = Column(Text, nullable=False)
    order_index = Column(Integer, default=0)

    question = relationship("Question", back_populates="options",
                            foreign_keys=[question_id])


# ============================================
# TEST SESSION
# ============================================

class TestSession(Base):
    """
    Сесія проходження тесту.

    user_id — nullable FK на User.
    Nullable тому що MVP підтримував анонімні сесії.
    Для статистики вчителя використовуємо тільки сесії де user_id IS NOT NULL.
    """
    __tablename__ = "test_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    test_id       = Column(Integer, ForeignKey("tests.id"), nullable=False)
    # Nullable: старі сесії без авторизації залишаються валідними
    user_id       = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    session_token = Column(String(64), unique=True, nullable=False, index=True)
    status        = Column(Enum(SessionStatus), default=SessionStatus.active)
    time_left     = Column(Integer, nullable=False)
    score         = Column(Float, nullable=True)
    max_score     = Column(Float, nullable=True)
    started_at    = Column(DateTime, default=datetime.utcnow)
    finished_at   = Column(DateTime, nullable=True)

    test    = relationship("Test", back_populates="sessions")
    user    = relationship("User", back_populates="sessions")
    answers = relationship("SessionAnswer", back_populates="session")


class SessionAnswer(Base):
    __tablename__ = "session_answers"

    id               = Column(Integer, primary_key=True, index=True)
    session_id       = Column(Integer, ForeignKey("test_sessions.id"), nullable=False)
    question_id      = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer_option_id = Column(Integer, ForeignKey("answer_options.id"), nullable=True)
    is_skipped       = Column(Boolean, default=False)
    answered_at      = Column(DateTime, default=datetime.utcnow)

    session = relationship("TestSession", back_populates="answers")



class GroupTest(Base):
    """
    Зв'язок "Тест задано групі" (вчитель → клас).
    Багато-до-багатьох: одна група може мати кілька тестів,
    один тест може бути виданий кільком групам.
    """
    __tablename__ = "group_tests"

    id         = Column(Integer, primary_key=True, index=True)
    group_id   = Column(Integer, ForeignKey("groups.id"),  nullable=False)
    test_id    = Column(Integer, ForeignKey("tests.id"),   nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    group = relationship("Group", back_populates="assigned_tests")
    test  = relationship("Test")


class BugReport(Base):
    __tablename__ = "bug_reports"

    id          = Column(Integer, primary_key=True, index=True)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    report_type = Column(String(50), nullable=False)
    comment     = Column(Text, nullable=False)
    status      = Column(String(20), default="new")
    created_at  = Column(DateTime, default=datetime.utcnow)
