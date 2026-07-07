from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.services.auth_service import hash_password, verify_password, create_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class TokenResponse(BaseModel):
    token: str
    user_id: str
    username: str


@router.post("/register", response_model=TokenResponse)
async def register(creds: Credentials, db: AsyncSession = Depends(get_db)):
    """Registro simple para la familia. Sin verificación de email."""
    result = await db.execute(select(User).where(User.username == creds.username))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Usuario ya existe")

    user = User(username=creds.username, password_hash=hash_password(creds.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(token=create_token(user.id), user_id=user.id, username=user.username)


@router.post("/login", response_model=TokenResponse)
async def login(creds: Credentials, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.username == creds.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(creds.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    return TokenResponse(token=create_token(user.id), user_id=user.id, username=user.username)
