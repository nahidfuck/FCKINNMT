"""
utils/security.py — Хешування паролів та JWT
=============================================
Два незалежних інструменти:

1. PassLib / bcrypt — для паролів.
   Ніколи не зберігаємо сирий пароль у БД.
   bcrypt сам генерує унікальну "сіль" при кожному хешуванні,
   тому однаковий пароль дає різний хеш — це захист від rainbow tables.

2. python-jose — для JWT токенів.
   JWT (JSON Web Token) — це підписаний рядок виду header.payload.signature.
   Сервер підписує його SECRET_KEY. Будь-яка зміна payload → підпис невалідний.
   Токен НЕ зашифрований (payload читається), але захищений від підробки.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

from jose import JWTError, jwt
from passlib.context import CryptContext

from config import settings

# ============================================
# КОНФІГУРАЦІЯ
# ============================================

# Алгоритм підпису JWT.
# HS256 = HMAC + SHA-256 (симетричний: один ключ для підпису і перевірки)
ALGORITHM = "HS256"

# Час життя access-токена.
# 60 хвилин — розумний баланс між безпекою і зручністю.
# Після цього часу токен стає невалідним і юзер має увійти знову.
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 години для зручності розробки

# CryptContext — менеджер схем хешування.
# schemes=["bcrypt"] — використовуємо bcrypt
# deprecated="auto"  — автоматично оновлює старі хеші при наступному вході
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ============================================
# ПАРОЛІ
# ============================================

def hash_password(plain_password: str) -> str:
    """
    Хешує сирий пароль через bcrypt.

    Приклад:
      hash_password("mypassword123")
      → "$2b$12$EixZaYVK1fsbw1ZfbX3OXe.PmYFhLmMBKzMR..."
    """
    return pwd_context.hash(plain_password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Перевіряє чи сирий пароль відповідає збереженому хешу.
    Ніколи не "розхешовує" — тільки порівнює.

    Приклад:
      verify_password("mypassword123", "$2b$12$...") → True
      verify_password("wrongpassword", "$2b$12$...") → False
    """
    return pwd_context.verify(plain_password, hashed_password)


# ============================================
# JWT ТОКЕНИ
# ============================================

def create_access_token(
    subject: str | int,
    expires_delta: Optional[timedelta] = None
) -> str:
    """
    Генерує підписаний JWT access-токен.

    :param subject: Унікальний ідентифікатор юзера (зазвичай user.id або email).
                    Зберігається в полі "sub" (subject) токена.
    :param expires_delta: Кастомний час життя токена.

    Структура payload (що буде в токені):
      {
        "sub": "42",           ← ID юзера
        "exp": 1719999999      ← Unix timestamp коли токен протухне
      }
    """
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    payload = {
        "sub": str(subject),  # subject — стандартне JWT поле
        "exp": expire,
    }

    # jwt.encode підписує payload за допомогою SECRET_KEY
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[str]:
    """
    Декодує та верифікує JWT токен.
    Повертає `sub` (ID юзера) або None якщо токен невалідний/протухлий.

    JWTError кидається якщо:
      - підпис не збігається (токен підроблений)
      - токен протухлий (exp в минулому)
      - токен пошкоджений
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        subject: str = payload.get("sub")
        return subject  # поверне None якщо поля "sub" нема
    except JWTError:
        return None
