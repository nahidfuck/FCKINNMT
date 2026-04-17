"""
config.py — Налаштування проєкту та Feature Flags
==================================================
Feature Flags — це перемикачі функціоналу.
Ідея: замість того щоб видаляти/коментувати код,
ми просто вмикаємо/вимикаємо функції одним рядком.

Під час Soft Launch (бета):
  - PAYMENTS_ENABLED = False  → платні тести показуються як "Скоро"
  - MAX_FREE_TESTS = 2        → перші 2 тести безкоштовні

Після релізу:
  - PAYMENTS_ENABLED = True   → платіжна система вмикається
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # --- База даних ---
    # sqlite:///./nmt.db — файл nmt.db у поточній папці
    # Потім змінимо на: postgresql://user:pass@localhost/nmt
    DATABASE_URL: str = "sqlite:///./nmt.db"

    # --- JWT ---
    # Секретний ключ для підпису токенів.
    # У продакшені ОБОВ'ЯЗКОВО замінити на довгий випадковий рядок і тримати в .env!
    # Генерація: python -c "import secrets; print(secrets.token_hex(32))"
    SECRET_KEY: str = "change-me-in-production-use-secrets-token-hex-32"

        # --- Feature Flags ---
    # False = Soft Launch (бета): платні тести заблоковані
    # True  = Після релізу: платіжна система активна
    PAYMENTS_ENABLED: bool = False

    # Скільки тестів доступно безкоштовно у Freemium моделі
    MAX_FREE_TESTS: int = 2

    # --- CORS ---
    # Список доменів, яким дозволено звертатись до API
    # Під час розробки дозволяємо все ("*")
    # На продакшені: ["https://nmt-platform.ua"]
    ALLOWED_ORIGINS: list[str] = ["*"]

    # --- Додатково ---
    APP_NAME: str = "НМТ Платформа API"
    APP_VERSION: str = "0.1.0-beta"
    DEBUG: bool = True

    class Config:
        # Можна перевизначати через .env файл
        # Наприклад: PAYMENTS_ENABLED=true python main.py
        env_file = ".env"
        env_file_encoding = "utf-8"


# Єдиний екземпляр налаштувань для всього проєкту
# Імпортуй так: from config import settings
settings = Settings()
