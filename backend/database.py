"""
database.py — Підключення до бази даних
========================================
SQLAlchemy — це ORM (Object-Relational Mapper).
Він дозволяє працювати з БД через Python-класи
замість написання SQL вручну.

Головні поняття:
- engine    : "двигун" — фізичне з'єднання з файлом БД
- SessionLocal: фабрика сесій — кожен запит отримує свою сесію
- Base      : базовий клас для всіх ORM-моделей
- get_db()  : залежність (Dependency) для FastAPI —
              автоматично відкриває і закриває сесію
"""

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from config import settings

# --- Створення двигуна ---
# connect_args потрібен ТІЛЬКИ для SQLite:
# він дозволяє використовувати одне з'єднання в різних потоках.
# Для PostgreSQL цей параметр прибираємо.
engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"check_same_thread": False}  # SQLite-специфічно
)

# --- Фабрика сесій ---
# autocommit=False → зміни не зберігаються автоматично (ми контролюємо)
# autoflush=False  → запити не відправляються до явного flush/commit
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# --- Базовий клас для моделей ---
# Всі моделі в models.py успадковуються від Base
Base = declarative_base()


def get_db():
    """
    FastAPI Dependency — генератор сесії БД.

    Як це працює:
    1. FastAPI бачить параметр `db: Session = Depends(get_db)` у роутері
    2. Викликає цю функцію → отримує сесію
    3. Передає сесію в роутер
    4. Після відповіді — виконує finally → сесія закривається

    Це гарантує що сесія ЗАВЖДИ закриється, навіть при помилці.
    """
    db = SessionLocal()
    try:
        yield db       # ← тут FastAPI "зупиняється" і виконує роутер
    finally:
        db.close()     # ← виконується після відповіді клієнту
