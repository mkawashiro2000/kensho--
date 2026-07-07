"""KENSHO — Análisis ex-gaussiano de tiempos de reacción.

Ajusta una distribución ex-gaussiana (Normal + Exponencial) sobre los RTTs
de cada sesión terminada y extrae los biomarcadores:

  μ (mu)    — velocidad motora base
  σ (sigma) — variabilidad mecánica
  τ (tau)   — control ejecutivo/atención; alto τ ⇒ fatiga

Uso (dentro del contenedor backend o con venv que tenga scipy + asyncpg):
    python scripts/analytics.py            # procesa sesiones pendientes
    python scripts/analytics.py --all      # reprocesa todas
"""

import argparse
import asyncio
import sys
import uuid
from datetime import datetime, timezone

import asyncpg
import numpy as np
from scipy.stats import exponnorm

DATABASE_URL = "postgresql://kensho:kensho@localhost:55432/kensho"

MIN_SAMPLES = 10          # mínimo de RTTs para un ajuste fiable
TAU_ALERT_RATIO = 0.5     # alerta si τ > 50% de μ (cola exponencial dominante)


def fit_exgaussian(rtts: np.ndarray) -> tuple[float, float, float]:
    """Ajusta ex-gaussiana. scipy parametriza exponnorm con K = τ/σ.

    Retorna (mu, sigma, tau) en milisegundos.
    """
    k, loc, scale = exponnorm.fit(rtts)
    mu = loc          # componente gaussiana: media
    sigma = scale     # componente gaussiana: desviación
    tau = k * scale   # componente exponencial: media de la cola
    return float(mu), float(sigma), float(tau)


async def process(reprocess_all: bool = False):
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        if reprocess_all:
            await conn.execute("DELETE FROM analytics")

        sessions = await conn.fetch(
            """
            SELECT s.id FROM sessions s
            WHERE s.ended_at IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM analytics a WHERE a.session_id = s.id)
            """
        )
        print(f"Sesiones pendientes de análisis: {len(sessions)}")

        for row in sessions:
            session_id = row["id"]
            rtt_rows = await conn.fetch(
                """
                SELECT rtt_ms FROM telemetry
                WHERE session_id = $1
                  AND event_type IN ('mot_click', 'semantic_response', 'rotation_attempt')
                  AND rtt_ms IS NOT NULL AND rtt_ms > 0
                """,
                session_id,
            )
            rtts = np.array([r["rtt_ms"] for r in rtt_rows], dtype=float)

            if len(rtts) < MIN_SAMPLES:
                print(f"  {session_id}: solo {len(rtts)} muestras (<{MIN_SAMPLES}), omitida")
                await conn.execute(
                    """
                    INSERT INTO analytics (id, session_id, mu, sigma, tau, tau_alert, n_samples, created_at)
                    VALUES ($1, $2, NULL, NULL, NULL, FALSE, $3, $4)
                    """,
                    str(uuid.uuid4()), session_id, len(rtts), datetime.now(timezone.utc),
                )
                continue

            try:
                mu, sigma, tau = fit_exgaussian(rtts)
            except Exception as e:
                print(f"  {session_id}: fallo en ajuste ({e}), omitida", file=sys.stderr)
                continue

            tau_alert = tau > mu * TAU_ALERT_RATIO
            await conn.execute(
                """
                INSERT INTO analytics (id, session_id, mu, sigma, tau, tau_alert, n_samples, created_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                str(uuid.uuid4()), session_id, mu, sigma, tau, tau_alert,
                len(rtts), datetime.now(timezone.utc),
            )
            flag = " ⚠ ALERTA FATIGA" if tau_alert else ""
            print(f"  {session_id}: μ={mu:.0f}ms σ={sigma:.0f}ms τ={tau:.0f}ms (n={len(rtts)}){flag}")
    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Análisis ex-gaussiano KENSHO")
    parser.add_argument("--all", action="store_true", help="reprocesar todas las sesiones")
    args = parser.parse_args()
    asyncio.run(process(reprocess_all=args.all))
