from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Telemetry, Rating


async def compute_session_score(db: AsyncSession, session_id: str) -> int:
    """Puntuación lineal simple (placeholder Glicko-2).

    base + clicks_mot_correctos*10 + respuestas_semánticas_correctas*5
    + intentos_rotación_correctos*10 - alertas_fatiga*50
    """
    result = await db.execute(
        select(Telemetry.event_type, Telemetry.correct, func.count())
        .where(Telemetry.session_id == session_id)
        .group_by(Telemetry.event_type, Telemetry.correct)
    )
    counts: dict[tuple[str, bool | None], int] = {(r[0], r[1]): r[2] for r in result.all()}

    points = settings.base_points
    points += counts.get(("mot_click", True), 0) * settings.mot_click_points
    points += counts.get(("semantic_response", True), 0) * settings.semantic_points
    points += counts.get(("rotation_attempt", True), 0) * settings.mot_click_points
    # Errores restan la mitad de lo que suma un acierto
    points -= counts.get(("mot_click", False), 0) * (settings.mot_click_points // 2)
    points -= counts.get(("semantic_response", False), 0) * (settings.semantic_points // 2)
    points -= counts.get(("rotation_attempt", False), 0) * (settings.mot_click_points // 2)
    # Fatiga
    fatigue = sum(v for (etype, _), v in counts.items() if etype == "fatigue_alert")
    points -= fatigue * settings.fatigue_penalty

    return max(0, points)


async def save_rating(db: AsyncSession, user_id: str, session_id: str, points: int) -> Rating:
    result = await db.execute(
        select(func.coalesce(func.max(Rating.total_points), 0)).where(Rating.user_id == user_id)
    )
    previous_total = result.scalar_one()

    rating = Rating(
        user_id=user_id,
        session_id=session_id,
        points_earned=points,
        total_points=previous_total + points,
    )
    db.add(rating)
    await db.commit()
    await db.refresh(rating)
    return rating
