from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User, Session, Rating, Analytics
from app.services.auth_service import get_current_user
from app.services.exercise_service import pick_next_exercise, initial_difficulty
from app.services.scoring_service import compute_session_score, save_rating

router = APIRouter(prefix="/api", tags=["sessions"])


class SessionStartRequest(BaseModel):
    mode: str = "competitive"  # 'competitive' | 'zen'


class SessionStartResponse(BaseModel):
    session_id: str
    exercise_type: str
    difficulty: int
    mode: str


class SessionEndRequest(BaseModel):
    session_id: str
    difficulty_end: int = 1


class SessionEndResponse(BaseModel):
    session_id: str
    points_earned: int
    total_points: int


@router.post("/session/start", response_model=SessionStartResponse)
async def start_session(
    req: SessionStartRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    exercise_type = await pick_next_exercise(db, user.id)
    difficulty = await initial_difficulty(db, user.id, exercise_type)

    session = Session(
        user_id=user.id,
        exercise_type=exercise_type,
        mode=req.mode,
        difficulty_start=difficulty,
        difficulty_end=difficulty,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SessionStartResponse(
        session_id=session.id,
        exercise_type=exercise_type,
        difficulty=difficulty,
        mode=req.mode,
    )


@router.post("/session/end", response_model=SessionEndResponse)
async def end_session(
    req: SessionEndRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == req.session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    if session.ended_at:
        raise HTTPException(status_code=409, detail="Sesión ya cerrada")

    points = await compute_session_score(db, session.id)
    session.ended_at = datetime.now(timezone.utc)
    session.final_score = points
    session.difficulty_end = max(1, min(5, req.difficulty_end))
    await db.commit()

    rating = await save_rating(db, user.id, session.id, points)
    return SessionEndResponse(
        session_id=session.id,
        points_earned=rating.points_earned,
        total_points=rating.total_points,
    )


@router.get("/session/{session_id}/stats")
async def session_stats(
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Session).where(Session.id == session_id, Session.user_id == user.id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")

    analytics_result = await db.execute(
        select(Analytics).where(Analytics.session_id == session_id)
    )
    analytics = analytics_result.scalar_one_or_none()

    return {
        "session_id": session.id,
        "exercise_type": session.exercise_type,
        "mode": session.mode,
        "difficulty_start": session.difficulty_start,
        "difficulty_end": session.difficulty_end,
        "final_score": session.final_score,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "analytics": {
            "mu": analytics.mu,
            "sigma": analytics.sigma,
            "tau": analytics.tau,
            "tau_alert": analytics.tau_alert,
        } if analytics else None,
    }


@router.get("/user/me/history")
async def my_history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Rating)
        .where(Rating.user_id == user.id)
        .order_by(desc(Rating.created_at))
        .limit(10)
    )
    ratings = result.scalars().all()
    total = ratings[0].total_points if ratings else 0
    return {
        "user_id": user.id,
        "username": user.username,
        "total_points": total,
        "history": [
            {"session_id": r.session_id, "points": r.points_earned, "date": r.created_at}
            for r in ratings
        ],
    }


@router.get("/rankings")
async def rankings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Top 5 de la familia por puntos acumulados."""
    users_result = await db.execute(select(User))
    users = users_result.scalars().all()

    board = []
    for u in users:
        r = await db.execute(
            select(Rating.total_points)
            .where(Rating.user_id == u.id)
            .order_by(desc(Rating.created_at))
            .limit(1)
        )
        total = r.scalar_one_or_none() or 0
        board.append({"username": u.username, "total_points": total})

    board.sort(key=lambda x: x["total_points"], reverse=True)
    return {"rankings": board[:5]}
