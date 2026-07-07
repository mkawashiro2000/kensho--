import asyncio
import time

from fastapi import WebSocket

from app.config import settings


class ConnectionManager:
    """Gestiona sockets activos con heartbeat ping/pong.

    Cada 30s envía ping; si el cliente no responde pong en 60s
    se considera zombi y se purga la conexión.
    """

    def __init__(self):
        self.active: dict[str, WebSocket] = {}       # session_id → socket
        self.last_pong: dict[str, float] = {}        # session_id → timestamp
        self._task: asyncio.Task | None = None

    async def connect(self, session_id: str, ws: WebSocket):
        await ws.accept()
        self.active[session_id] = ws
        self.last_pong[session_id] = time.monotonic()

    def disconnect(self, session_id: str):
        self.active.pop(session_id, None)
        self.last_pong.pop(session_id, None)

    def register_pong(self, session_id: str):
        self.last_pong[session_id] = time.monotonic()

    async def send(self, session_id: str, message: dict):
        ws = self.active.get(session_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(session_id)

    def start_heartbeat(self):
        if self._task is None:
            self._task = asyncio.create_task(self._heartbeat_loop())

    async def stop_heartbeat(self):
        if self._task:
            self._task.cancel()
            self._task = None

    async def _heartbeat_loop(self):
        while True:
            await asyncio.sleep(settings.heartbeat_interval_s)
            now = time.monotonic()
            for session_id in list(self.active.keys()):
                # Purgar zombis
                if now - self.last_pong.get(session_id, now) > settings.heartbeat_timeout_s:
                    ws = self.active.get(session_id)
                    self.disconnect(session_id)
                    if ws:
                        try:
                            await ws.close(code=4000, reason="heartbeat timeout")
                        except Exception:
                            pass
                    continue
                await self.send(session_id, {"type": "ping", "ts": time.time()})


manager = ConnectionManager()
