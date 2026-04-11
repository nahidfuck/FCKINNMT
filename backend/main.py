"""
main.py — Точка входу FastAPI додатку
======================================
Запуск: uvicorn main:app --reload --port 8000
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import settings
from database import engine, Base
from routers import tests, sessions, reports

# Автоматично створює таблиці якщо їх нема
# (на продакшені краще використовувати Alembic міграції)
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/api/docs",      # Swagger UI — http://localhost:8000/api/docs
    redoc_url="/api/redoc",
)

# CORS — дозволяємо фронтенду звертатися до API
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Підключаємо роутери
app.include_router(tests.router)
app.include_router(sessions.router)
app.include_router(reports.router)

# Вказуємо шлях до папки frontend (вона на рівень вище за backend)
frontend_path = os.path.join(os.path.dirname(__file__), "../frontend")
# Монтуємо статику. html=True дозволяє відкривати .html файли
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

@app.get("/api/health", tags=["Системні"])
def health_check():
    """Перевірка що сервер живий. Корисно для моніторингу."""
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "payments_enabled": settings.PAYMENTS_ENABLED,
    }
