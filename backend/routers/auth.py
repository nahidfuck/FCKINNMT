"""
routers/auth.py — Ендпоінти авторизації
=========================================
POST /api/auth/register  — реєстрація нового юзера
POST /api/auth/token     — логін, повертає JWT
GET  /api/auth/me        — дані поточного юзера (захищений)

А також: залежність `get_current_user` для захисту інших ендпоінтів.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from utils.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["Авторизація"])

# ============================================
# OAuth2 СХЕМА
# ============================================

# OAuth2PasswordBearer вказує FastAPI де шукати токен.
# tokenUrl — URL ендпоінту логіну (для Swagger UI).
# Коли ти додаєш `token: str = Depends(oauth2_scheme)` до ендпоінту,
# FastAPI автоматично читає заголовок: `Authorization: Bearer <token>`
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

# ============================================
# ЗАЛЕЖНІСТЬ: get_current_user
# ============================================

def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """
    Залежність для захисту ендпоінтів.

    Як використовувати в будь-якому роутері:

        from routers.auth import get_current_user

        @router.get("/protected")
        def protected_route(current_user: models.User = Depends(get_current_user)):
            return {"message": f"Привіт, {current_user.email}!"}

    FastAPI автоматично:
      1. Читає заголовок Authorization: Bearer <token>
      2. Передає токен сюди
      3. Якщо повертаємо юзера — все ОК
      4. Якщо кидаємо HTTPException — клієнт отримує 401
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невалідний або прострочений токен",
        # WWW-Authenticate — стандартний заголовок для 401
        # Підказує клієнту що потрібна Bearer-авторизація
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Декодуємо токен → отримуємо user_id (або None якщо токен невалідний)
    user_id_str = decode_access_token(token)
    if user_id_str is None:
        raise credentials_exception

    # Шукаємо юзера в БД
    user = db.query(models.User).filter(
        models.User.id == int(user_id_str)
    ).first()

    if user is None:
        raise credentials_exception

    # Перевіряємо чи акаунт активний (адмін може деактивувати)
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Акаунт деактивовано"
        )

    return user


def get_current_admin(
    current_user: models.User = Depends(get_current_user),
) -> models.User:
    """
    Залежність тільки для адміністраторів.
    Використовуй замість get_current_user там де потрібні права адміна.
    """
    if current_user.role != models.UserRole.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Потрібні права адміністратора"
        )
    return current_user



def _build_user_public(user: models.User, db: Session) -> schemas.UserPublic:
    """Будує UserPublic з ORM-об'єкта, підвантажуючи group_name."""
    group_name = None
    if user.group_id:
        group = db.query(models.Group).filter(models.Group.id == user.group_id).first()
        group_name = group.name if group else None
    return schemas.UserPublic(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        group_id=user.group_id,
        group_name=group_name,
        created_at=user.created_at,
    )

# ============================================
# ЕНДПОІНТИ
# ============================================

@router.post(
    "/register",
    response_model=schemas.TokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Реєстрація нового акаунту"
)
def register(payload: schemas.UserRegister, db: Session = Depends(get_db)):
    """
    Реєструє нового користувача і одразу повертає токен.
    (Щоб не змушувати юзера після реєстрації ще й логінитись окремо.)
    """
    # Перевіряємо чи email вже зайнятий
    existing = db.query(models.User).filter(
        models.User.email == payload.email.lower().strip()
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Користувач з таким email вже існує"
        )

    # Створюємо юзера з хешованим паролем
    # role береться з payload (student/teacher), default — student
    user_role = models.UserRole.teacher if payload.role == "teacher" else models.UserRole.student
    user = models.User(
        email=payload.email.lower().strip(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=user_role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Генеруємо токен одразу після реєстрації
    token = create_access_token(subject=user.id)

    return schemas.TokenResponse(
        access_token=token,
        user=_build_user_public(user, db)
    )


@router.post(
    "/token",
    response_model=schemas.TokenResponse,
    summary="Логін (отримати JWT токен)"
)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db)
):
    """
    Логін через email + пароль, повертає JWT.

    Приймає OAuth2PasswordRequestForm — стандартна форма з полями:
      - username (ми використовуємо як email)
      - password

    Чому OAuth2PasswordRequestForm а не JSON?
    Swagger UI автоматично показує кнопку "Authorize" і форму логіну
    тільки якщо ендпоінт приймає саме цю форму. Дуже зручно для розробки.
    """
    # Шукаємо юзера по email
    # form.username — так називається поле в OAuth2 стандарті
    user = db.query(models.User).filter(
        models.User.email == form.username.lower().strip()
    ).first()

    # Перевіряємо існування юзера і правильність пароля
    # Навмисно не розрізняємо "юзер не існує" і "невірний пароль"
    # — це захист від брутфорсу (зловмисник не знає чи email зареєстрований)
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Невірний email або пароль",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Акаунт деактивовано"
        )

    token = create_access_token(subject=user.id)

    return schemas.TokenResponse(
        access_token=token,
        user=_build_user_public(user, db)
    )


@router.get(
    "/me",
    response_model=schemas.UserPublic,
    summary="Дані поточного авторизованого юзера"
)
def get_me(
    current_user: models.User = Depends(get_current_user),
    db:           Session      = Depends(get_db),
):
    """
    Повертає дані юзера.
    Якщо учень у групі — включає group_id та group_name.
    """
    group_name = None
    if current_user.group_id:
        group = db.query(models.Group).filter(
            models.Group.id == current_user.group_id
        ).first()
        group_name = group.name if group else None

    return schemas.UserPublic(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        group_id=current_user.group_id,
        group_name=group_name,
        created_at=current_user.created_at,
    )


# ============================================
# ОПЦІОНАЛЬНА АВТОРИЗАЦІЯ (для sessions)
# ============================================

from fastapi.security import OAuth2PasswordBearer as _OPB
from fastapi import Request

_optional_bearer = _OPB(tokenUrl="/api/auth/token", auto_error=False)

def get_optional_user(
    token: Optional[str] = Depends(_optional_bearer),
    db:    Session        = Depends(get_db),
) -> Optional[models.User]:
    """
    Залежність яка повертає User якщо токен є і валідний,
    або None якщо токена нема (анонімний запит).

    Використовується там де авторизація бажана, але не обов'язкова
    (наприклад, створення сесії тесту — можна й анонімно).
    """
    if not token:
        return None
    user_id_str = decode_access_token(token)
    if not user_id_str:
        return None
    return db.query(models.User).filter(
        models.User.id == int(user_id_str),
        models.User.is_active == True,
    ).first()
