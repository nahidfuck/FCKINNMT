"""
main.py — Точка входу FastAPI додатку
======================================
Запуск: uvicorn main:app --reload --port 8000

Структура папок (відносно backend/):
  ../frontend/   ← фронтенд, FastAPI роздає його як статику
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from config import settings
from database import engine, Base
from routers import tests, sessions, reports, auth, teachers, students
from fastapi.middleware.cors import CORSMiddleware

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    swagger_ui_oauth2_redirect_url="/api/docs/oauth2-redirect",
)

# Дозволяємо запити з будь-яких доменів (тимчасово для деплою)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://fckinnmt.vercel.app", 
        "http://localhost:5500", 
        "http://127.0.0.1:5500"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- API роутери (підключаємо ДО статики, щоб /api/* мав пріоритет) ---
app.include_router(tests.router)
app.include_router(sessions.router)
app.include_router(reports.router)
app.include_router(auth.router)
app.include_router(teachers.router)
app.include_router(students.router)


@app.get("/api/health", tags=["Системні"])
def health_check():
    return {
        "status": "ok",
        "version": settings.APP_VERSION,
        "payments_enabled": settings.PAYMENTS_ENABLED,
    }


# --- Статичні файли фронтенду ---
# Path(__file__) — це backend/main.py
# .parent.parent — піднімаємось на рівень вище (корінь проєкту)
# / "frontend"   — папка з HTML/CSS/JS
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

if FRONTEND_DIR.exists():
    # Роздаємо всі файли з frontend/ за їх іменами
    # http://localhost:8000/style.css → frontend/style.css
    # http://localhost:8000/js/api.js → frontend/js/api.js
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
else:
    # Якщо папки нема — просто попереджаємо, API продовжує працювати
    import warnings
    warnings.warn(f"Папку фронтенду не знайдено: {FRONTEND_DIR}")
