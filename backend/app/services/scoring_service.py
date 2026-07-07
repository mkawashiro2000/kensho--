from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Telemetry, Rating

RESPONSE_EVENTS = ("mot_click", "semantic_response", "rotation_attempt", "speed_response")


async def compute_session_score(db: AsyncSession, session_id: str, difficulty_end: int = 1) -> dict:
    """Scoring dinámico (placeholder Glicko-2).

    puntos_base   = Σ aciertos × 10 × (1 + 0.3·(dificultad−1))
    bono_racha    = racha_máxima × 15  (rachas ≥3 valen; rachas ≥8 doblan)
    mult_precisión = 0.5 + accuracy    (rango 0.5–1.5)
    malus_fatiga  = ×0.8 si hubo alertas de fatiga
    respuesta_rápida = +2 por acierto con RTT < 600ms

    Devuelve dict con desglose para que el frontend lo muestre.
    """
    result = await db.execute(
        select(Telemetry.event_type, Telemetry.correct, Telemetry.rtt_ms)
        .where(Telemetry.session_id == session_id)
        .order_by(Telemetry.timestamp)
    )
    rows = result.all()

    correct = 0
    wrong = 0
    fast_hits = 0
    fatigue_alerts = 0
    streak = 0
    max_streak = 0

    for etype, is_correct, rtt in rows:
        if etype == "fatigue_alert":
            fatigue_alerts += 1
            continue
        if etype not in RESPONSE_EVENTS or is_correct is None:
            continue
        if is_correct:
            correct += 1
            streak += 1
            max_streak = max(max_streak, streak)
            if rtt is not None and rtt < 600:
                fast_hits += 1
        else:
            wrong += 1
            streak = 0

    total_responses = correct + wrong
    if total_responses == 0:
        return {
            "points": 0, "correct": 0, "wrong": 0, "accuracy": 0.0,
            "max_streak": 0, "fast_hits": 0, "fatigue_alerts": fatigue_alerts,
            "base": 0, "streak_bonus": 0, "speed_bonus": 0,
        }

    accuracy = correct / total_responses
    difficulty_mult = 1 + 0.3 * (max(1, difficulty_end) - 1)

    base = round(correct * 10 * difficulty_mult)
    streak_bonus = max_streak * 15 if max_streak >= 3 else 0
    if max_streak >= 8:
        streak_bonus *= 2
    speed_bonus = fast_hits * 2

    subtotal = (base + streak_bonus + speed_bonus) * (0.5 + accuracy)
    if fatigue_alerts > 0:
        subtotal *= 0.8

    points = max(0, round(subtotal))
    return {
        "points": points,
        "correct": correct,
        "wrong": wrong,
        "accuracy": round(accuracy, 3),
        "max_streak": max_streak,
        "fast_hits": fast_hits,
        "fatigue_alerts": fatigue_alerts,
        "base": base,
        "streak_bonus": streak_bonus,
        "speed_bonus": speed_bonus,
    }


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
