import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { TelemetrySocket, ServerMessage } from '../services/websocket'
import MOTGame from '../components/MOTGame'
import SpatialGame from '../components/SpatialGame'

const SESSION_DURATION_S = 5 * 60 // 1 sesión = 1 ejercicio de 5 min

export default function GamePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const mode = (location.state as { mode?: string })?.mode || 'competitive'

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exerciseType, setExerciseType] = useState<string>('')
  const [difficulty, setDifficulty] = useState(1)
  const [score, setScore] = useState(0)
  const [timeLeft, setTimeLeft] = useState(SESSION_DURATION_S)
  const [fatigueAlert, setFatigueAlert] = useState(false)
  const [result, setResult] = useState<{ points: number; total: number } | null>(null)
  const [error, setError] = useState('')

  const socketRef = useRef<TelemetrySocket | null>(null)
  const difficultyRef = useRef(1)
  const endedRef = useRef(false)

  // Iniciar sesión al montar
  useEffect(() => {
    api.startSession(mode)
      .then((res) => {
        setSessionId(res.session_id)
        setExerciseType(res.exercise_type)
        setDifficulty(res.difficulty)
        difficultyRef.current = res.difficulty

        socketRef.current = new TelemetrySocket(res.session_id, (msg: ServerMessage) => {
          if (msg.type === 'difficulty_change') {
            setDifficulty(msg.difficulty)
            difficultyRef.current = msg.difficulty
          } else if (msg.type === 'fatigue_alert') {
            setFatigueAlert(true)
            setTimeout(() => setFatigueAlert(false), 5000)
          }
        })
      })
      .catch((e) => setError(e.message))

    return () => { socketRef.current?.close() }
  }, [])

  // Cronómetro de sesión
  useEffect(() => {
    if (!sessionId || result) return
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(interval)
          endSession()
          return 0
        }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(interval)
  }, [sessionId, result])

  async function endSession() {
    if (endedRef.current || !sessionId) return
    endedRef.current = true
    socketRef.current?.close()
    try {
      const res = await api.endSession(sessionId, difficultyRef.current)
      setResult({ points: res.points_earned, total: res.total_points })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cerrar sesión')
    }
  }

  function sendEvent(event: Record<string, unknown>) {
    socketRef.current?.send(event)
    if (event.correct === true) setScore((s) => s + 10)
  }

  const mins = Math.floor(timeLeft / 60)
  const secs = timeLeft % 60

  if (error) {
    return (
      <div className="container center" style={{ paddingTop: '20vh' }}>
        <div className="panel">
          <p className="error-msg">{error}</p>
          <button onClick={() => navigate('/')}>Volver</button>
        </div>
      </div>
    )
  }

  if (result) {
    return (
      <div className="container center" style={{ maxWidth: 480, paddingTop: '15vh' }}>
        <div className="panel">
          <h2>Sesión completada</h2>
          <p style={{ color: 'var(--text-dim)' }}>Puntos ganados</p>
          <h1 className="mono" style={{ fontSize: 56, color: 'var(--success)' }}>+{result.points}</h1>
          <p className="mt">Total acumulado: <strong className="mono">{result.total}</strong></p>
          <div className="mt" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <button onClick={() => window.location.reload()}>Otra sesión</button>
            <button className="secondary" onClick={() => navigate('/')}>Dashboard</button>
          </div>
        </div>
      </div>
    )
  }

  if (!sessionId) {
    return <div className="container center" style={{ paddingTop: '20vh' }}>Preparando sesión…</div>
  }

  return (
    <div className="container">
      {fatigueAlert && (
        <div className="fatigue-banner">⚠ Fatiga detectada — considera un descanso</div>
      )}
      <div className="hud">
        <span className="timer mono">{mins}:{secs.toString().padStart(2, '0')}</span>
        <span className="difficulty">Nivel {difficulty}</span>
        {mode === 'competitive' && <span className="score mono">{score} pts</span>}
        <button className="secondary" onClick={endSession}>Terminar</button>
      </div>

      {exerciseType === 'mot_dual' && (
        <MOTGame difficulty={difficulty} sendEvent={sendEvent} zenMode={mode === 'zen'} />
      )}
      {exerciseType === 'spatial_rotation' && (
        <SpatialGame difficulty={difficulty} sendEvent={sendEvent} />
      )}
    </div>
  )
}
