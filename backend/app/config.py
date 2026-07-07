from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://kensho:kensho@localhost:5432/kensho"
    redis_url: str = "redis://localhost:6379/0"
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_hours: int = 168  # 7 días

    # Scoring
    base_points: int = 1000
    mot_click_points: int = 10
    semantic_points: int = 5
    fatigue_penalty: int = 50

    # Heartbeat
    heartbeat_interval_s: int = 30
    heartbeat_timeout_s: int = 60

    # Adaptativo
    adaptive_window: int = 3          # recalcular cada 3 scores
    adaptive_high_threshold: float = 0.8   # accuracy > 80% → sube dificultad
    adaptive_low_threshold: float = 0.5    # accuracy < 50% → baja dificultad
    max_same_type_streak: int = 3     # máx 3 sesiones seguidas del mismo tipo

    class Config:
        env_file = ".env"


settings = Settings()
