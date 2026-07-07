import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearAuth, getUsername } from '../services/api'

interface HistoryEntry { session_id: string; points: number; date: string }
interface RankEntry { username: string; total_points: number }

export default function DashboardPage() {
  const [totalPoints, setTotalPoints] = useState(0)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [rankings, setRankings] = useState<RankEntry[]>([])
  const [mode, setMode] = useState<'competitive' | 'zen'>('competitive')
  const navigate = useNavigate()
  const username = getUsername()

  useEffect(() => {
    api.myHistory().then((res) => {
      setTotalPoints(res.total_points)
      setHistory(res.history)
    }).catch(() => {})
    api.rankings().then((res) => setRankings(res.rankings)).catch(() => {})
  }, [])

  function logout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="container">
      <div className="hud">
        <h2>Hola, {username}</h2>
        <button className="secondary" onClick={logout}>Salir</button>
      </div>

      <div className="panel center">
        <p style={{ color: 'var(--text-dim)' }}>Puntos acumulados</p>
        <h1 className="mono" style={{ fontSize: 48, color: 'var(--success)' }}>{totalPoints}</h1>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 16 }}>
          <button
            className={mode === 'competitive' ? '' : 'secondary'}
            onClick={() => setMode('competitive')}
          >
            Competitivo
          </button>
          <button
            className={mode === 'zen' ? '' : 'secondary'}
            onClick={() => setMode('zen')}
          >
            Zen
          </button>
        </div>
        <div className="mt">
          <button
            style={{ fontSize: 18, padding: '16px 48px' }}
            onClick={() => navigate('/game', { state: { mode } })}
          >
            ▶ Iniciar Sesión de Entrenamiento
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="panel">
          <h3>🏆 Ranking Familiar</h3>
          {rankings.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin datos aún</p>}
          {rankings.map((r, i) => (
            <div className="ranking-row" key={r.username}>
              <span className="pos">#{i + 1}</span>
              <span>{r.username}</span>
              <span className="pts mono">{r.total_points}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>📈 Últimas sesiones</h3>
          {history.length === 0 && <p style={{ color: 'var(--text-dim)' }}>Sin sesiones aún</p>}
          {history.map((h) => (
            <div className="ranking-row" key={h.session_id}>
              <span style={{ color: 'var(--text-dim)', fontSize: 13 }}>
                {new Date(h.date).toLocaleDateString()}
              </span>
              <span className="pts mono">+{h.points}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
