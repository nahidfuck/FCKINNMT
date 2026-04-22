"""
models.py — ORM-моделі (структура бази даних)
==============================================
Архітектура відповідей по типах питань:

  single:
    - options: [AnswerOption, ...]
    - correct_data: {"answer_id": 5}
    - answer_data:  {"answer_id": 5}

  multiple:
    - options: [AnswerOption, ...]
    - correct_data: {"answer_ids": [3, 5, 7]}
    - answer_data:  {"answer_ids": [3, 5]}

  matching:
    - options: [] (не використовуються)
    - content:  {"left": [{"id":"1","text":"..."}, ...],
                 "right": [{"id":"A","text":"..."}, ...]}
    - correct_data: {"pairs": {"1":"A","2":"C","3":"B","4":"D"}}
    - answer_data:  {"pairs": {"1":"A","2":"C"}}

  open:
    - options: [] (не використовуються)
    - correct_data: {"answers": ["12","12.0","12,0"]}
    - answer_data:  {"text": "12"}
"""

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, ForeignKey,
    Integer, String, Text, Float, JSON
)
from sqlalchemy.orm import relationship

from database import Base


# ============================================
# ENUM-типи
# ============================================

class QuestionType(str, enum.Enum):
    single   = "single"    # Одна правильна відповідь (радіо)
    multiple = "multiple"  # Кілька правильних (чекбокси)
    matching = "matching"  # Встановлення відповідності (select)
    open     = "open"      # Відкрита відповідь (input text)


class SessionStatus(str, enum.Enum):
    active    = "active"
    finished  = "finished"
    timed_out = "timed_out"


class UserRole(str, enum.Enum):
    student = "student"
    teacher = "teacher"
    admin   = "admin"


# ============================================
# GROUP
# ============================================

class Group(Base):
    __tablename__ = "groups"

    id          = Column(Integer, primary_key=True, index=True)
    name        = Column(String(200), nullable=False)
    invite_code = Column(String(16), unique=True, nullable=False, index=True)
    teacher_id  = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    teacher        = relationship("User", foreign_keys=[teacher_id], back_populates="taught_groups")
    members        = relationship("User", foreign_keys="User.group_id", back_populates="group")
    assigned_tests = relationship("GroupTest", back_populates="group")


# ============================================
# USER
# ============================================

class User(Base):
    __tablename__ = "users"

    id              = Column(Integer, primary_key=True, index=True)
    email           = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    full_name       = Column(String(200), nullable=True)
    role            = Column(Enum(UserRole), default=UserRole.student, nullable=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    group_id        = Column(Integer, ForeignKey("groups.id"), nullable=True)

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
    """
    Питання тесту.

    content      — специфічна структура типу (обов'язково для matching).
    correct_data — правильні відповіді у форматі специфічному для типу.
                   Ніколи не відправляємо клієнту під час тесту!
    """
    __tablename__ = "questions"

    id          = Column(Integer, primary_key=True, index=True)
    test_id     = Column(Integer, ForeignKey("tests.id"), nullable=False)
    type        = Column(Enum(QuestionType), default=QuestionType.single, nullable=False)
    text        = Column(Text, nullable=False)
    order_index = Column(Integer, default=0)
    points      = Column(Float, default=1.0)
    explanation = Column(Text, nullable=True)
    image_url   = Column(String(500), nullable=True)

    # JSON-поля для нових типів питань
    content      = Column(JSON, nullable=True)   # matching: {"left":[...], "right":[...]}
    correct_data = Column(JSON, nullable=True)   # правильна відповідь по типу

    # Backward compat: для single/multiple — зберігаємо варіанти в AnswerOption
    test    = relationship("Test", back_populates="questions")
    options = relationship(
        "AnswerOption",
        back_populates="question",
        foreign_keys="AnswerOption.question_id",
        order_by="AnswerOption.order_index"
    )


class AnswerOption(Base):
    """
    Варіанти відповідей для типів single та multiple.
    Для matching та open — не використовується.
    """
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
    __tablename__ = "test_sessions"

    id            = Column(Integer, primary_key=True, index=True)
    test_id       = Column(Integer, ForeignKey("tests.id"), nullable=False)
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
    """
    Відповідь студента.
    answer_data — JSON, формат залежить від типу питання:
      single:   {"answer_id": 5}
      multiple: {"answer_ids": [3, 5]}
      matching: {"pairs": {"1":"A","2":"C"}}
      open:     {"text": "12"}
    """
    __tablename__ = "session_answers"

    id          = Column(Integer, primary_key=True, index=True)
    session_id  = Column(Integer, ForeignKey("test_sessions.id"), nullable=False)
    question_id = Column(Integer, ForeignKey("questions.id"), nullable=False)
    answer_data = Column(JSON, nullable=True)   # замість answer_option_id
    is_skipped  = Column(Boolean, default=False)
    answered_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("TestSession", back_populates="answers")


class GroupTest(Base):
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
