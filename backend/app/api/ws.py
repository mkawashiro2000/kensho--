import json
import statistics

import redis.asyncio as aioredis
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from app.config import settings
from app.database import SessionLocal
from app.models import Session, Telemetry
from app.services.auth_service import decode_token
from app.services.connection_manager import manager
from app.services.exercise_service import adjust_difficulty

router = APIRouter()

redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)

RESPONSE_EVENTS = {"mot_click", "semantic_response", "rotation_attempt"}


@router.websocket("/ws/telemetry/{session_id}")
async def telemetry_ws(ws: WebSocket, session_id: str, token: str = ""):
    # Autenticación por query param: /ws/telemetry/{id}?token=...
    try:
        user_id = decode_token(token)
    except Exception:
        await ws.close(code=4401, reason="token inválido")
        return

    # Validar que la sesión existe y pertenece al usuario
    async with SessionLocal() as db:
        result = await db.execute(
            select(Session).where(Session.id == session_id, Session.user_id == user_id)
        )
        session = result.scalar_one_or_none()
        if not session or session.ended_at:
            await ws.close(code=4404, reason="sesión inválida")
            return
        difficulty = session.difficulty_start

    await manager.connect(session_id, ws)
    live_key = f"session:{session_id}:live"
    rtt_key = f"session:{session_id}:rtts"
    recent_results: list[bool] = []  # ventana para dificultad adaptativa

    try:
        while True:
            raw = await ws.receive_text()
            event = json.loads(raw)
            etype = event.get("type")

            if etype == "pong":
                manager.register_pong(session_id)
                continue

            if etype in RESPONSE_EVENTS or etype == "fatigue_alert":
                rtt = event.get("rtt_ms") or event.get("latency_ms")
                correct = event.get("correct")

                # 1. Redis primero (latencia mínima)
                await redis_client.set(live_key, raw, ex=3600)
                if rtt is not None:
                    await redis_client.rpush(rtt_key, rtt)
                    await redis_client.expire(rtt_key, 3600)

                # 2. PostgreSQL (permanente)
                async with SessionLocal() as db:
                    db.add(Telemetry(
                        session_id=session_id,
                        event_type=etype,
                        rtt_ms=int(rtt) if rtt is not None else None,
                        correct=correct,
                        payload=event,
                    ))
                    await db.commit()

                # 3. Detección simple de fatiga: RTT actual > p90 de la sesión
                if rtt is not None:
                    rtts = [float(x) for x in await redis_client.lrange(rtt_key, 0, -1)]
                    if len(rtts) >= 10:
                        sorted_rtts = sorted(rtts[:-1])
                        p90 = sorted_rtts[int(len(sorted_rtts) * 0.9)]
                        median = statistics.median(sorted_rtts)
                        if rtt > p90 and rtt > median * 1.5:
                            async with SessionLocal() as db:
                                db.add(Telemetry(
                                    session_id=session_id,
                                    event_type="fatigue_alert",
                                    rtt_ms=int(rtt),
                                    payload={"p90": p90, "median": median},
                                ))
                                await db.commit()
                            await manager.send(session_id, {"type": "fatigue_alert", "rtt_ms": rtt})

                # 4. Dificultad adaptativa cada N respuestas
                if etype in RESPONSE_EVENTS and correct is not None:
                    recent_results.append(bool(correct))
                    if len(recent_results) >= settings.adaptive_window:
                        accuracy = sum(recent_results) / len(recent_results)
                        new_difficulty = adjust_difficulty(difficulty, accuracy)
                        recent_results.clear()
                        if new_difficulty != difficulty:
                            difficulty = new_difficulty
                            await manager.send(session_id, {
                                "type": "difficulty_change",
                                "difficulty": difficulty,
                            })

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(session_id)
