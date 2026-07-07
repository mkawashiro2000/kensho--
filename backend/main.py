from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.api import auth, sessions, ws
from app.services.connection_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    manager.start_heartbeat()
    yield
    await manager.stop_heartbeat()


app = FastAPI(title="KENSHO", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Red familiar privada tras Tailscale
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sessions.router)
app.include_router(ws.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
