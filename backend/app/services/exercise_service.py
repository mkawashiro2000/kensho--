from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Session, Rating

EXERCISE_TYPES = ["mot_dual", "spatial_rotation"]


async def pick_next_exercise(db: AsyncSession, user_id: str) -> str:
    """Selecciona el próximo tipo de ejercicio.

    Regla: máximo 3 sesiones seguidas del mismo tipo, luego cambio obligatorio.
    Además prefiere alternar cuando es posible.
    """
    result = await db.execute(
        select(Session.exercise_type)
        .where(Session.user_id == user_id)
        .order_by(Session.started_at.desc())
        .limit(settings.max_same_type_streak)
    )
    recent = [r[0] for r in result.all()]

    if not recent:
        return EXERCISE_TYPES[0]

    last = recent[0]
    streak = 0
    for t in recent:
        if t == last:
            streak += 1
        else:
            break

    if streak >= settings.max_same_type_streak:
        # Cambio obligatorio
        others = [t for t in EXERCISE_TYPES if t != last]
        return others[0]

    # Alternar por defecto
    others = [t for t in EXERCISE_TYPES if t != last]
    return others[0] if others else last


async def initial_difficulty(db: AsyncSession, user_id: str, exercise_type: str) -> int:
    """Dificultad inicial basada en el rendimiento de la última sesión del mismo tipo."""
    result = await db.execute(
        select(Session)
        .where(Session.user_id == user_id, Session.exercise_type == exercise_type)
        .order_by(Session.started_at.desc())
        .limit(1)
    )
    last_session = result.scalar_one_or_none()
    if not last_session or last_session.final_score is None:
        return 1

    # Si superó la base con margen, arranca donde terminó; si no, un nivel menos
    if last_session.final_score >= settings.base_points:
        return min(5, last_session.difficulty_end)
    return max(1, last_session.difficulty_end - 1)


def adjust_difficulty(current: int, recent_accuracy: float) -> int:
    """Ajuste en tiempo real: se llama cada `adaptive_window` respuestas."""
    if recent_accuracy > settings.adaptive_high_threshold:
        return min(5, current + 1)
    if recent_accuracy < settings.adaptive_low_threshold:
        return max(1, current - 1)
    return current
