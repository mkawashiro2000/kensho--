import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../services/api'
import { TelemetrySocket, ServerMessage } from '../services/websocket'
import MOTGame from '../components/MOTGame'
import SpatialGame from '../components/SpatialGame'
import SpeedGame from '../components/SpeedGame'

const SESSION_DURATION_S = 5 * 60 // 1 sesión = 1 ejercicio de 5 min

const EXERCISE_NAMES: Record<string, string> = {
  mot_dual: 'Seguimiento + Paridad',
  spatial_rotation: 'Rotación Espacial',
  processing_speed: 'Velocidad de Procesamiento',
}

interface Popup { id: number; text: string; x: number; color: string }

interface Breakdown {
  points: number; correct: number; wrong: number; accuracy: number
  max_streak: number; fast_hits: number; fatigue_alerts: number
  base: number; streak_bonus: number; speed_bonus: number
}

export default function GamePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const mode = (location.state as { mode?: string })?.mode || 'competitive'

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [exerciseType, setExerciseType] = useState<string>('')
  const [difficulty, setDifficulty] = useState(1)
  const [score, setScore] = useState(0)
  const [combo, setCombo] = useState(0)
  const [timeLeft, setTimeLeft] = useState(SESSION_DURATION_S)
  const [fatigueAlert, setFatigueAlert] = useState(false)
  const [levelUp, setLevelUp] = useState<number | null>(null)
  const [popups, setPopups] = useState<Popup[]>([])
  const [result, setResult] = useState<{ points: number; total: number; breakdown: Breakdown } | null>(null)
  const [error, setError] = useState('')

  const socketRef = useRef<TelemetrySocket | null>(null)
  const difficultyRef = useRef(1)
  const comboRef = useRef(0)
  const endedRef = useRef(false)
  const popupIdRef = useRef(0)

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
            const up = msg.difficulty > difficultyRef.current
            setDifficulty(msg.difficulty)
            difficultyRef.current = msg.difficulty
            if (up) {
              setLevelUp(msg.difficulty)
              setTimeout(() => setLevelUp(null), 1800)
            }
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
      setResult({ points: res.points_earned, total: res.total_points, breakdown: res.breakdown })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cerrar sesión')
    }
  }

  function addPopup(text: string, color: string) {
    const id = ++popupIdRef.current
    const x = 20 + Math.random() * 60 // % horizontal aleatorio
    setPopups((p) => [...p, { id, text, x, color }])
    setTimeout(() => setPopups((p) => p.filter((pp) => pp.id !== id)), 1100)
  }

  function sendEvent(event: Record<string, unknown>) {
    socketRef.current?.send(event)
    if (event.correct === true) {
      const newCombo = comboRef.current + 1
      comboRef.current = newCombo
      setCombo(newCombo)
      // Estimación local (el servidor calcula el score real al cierre)
      const comboMult = 1 + 0.1 * Math.min(newCombo, 10)
      const pts = Math.round(10 * (1 + 0.3 * (difficultyRef.current - 1)) * comboMult)
      setScore((s) => s + pts)
      addPopup(`+${pts}`, 'var(--success)')
      if (newCombo === 3 || newCombo === 5 || newCombo === 8 || newCombo % 10 === 0) {
        addPopup(`¡COMBO x${newCombo}!`, 'var(--warning)')
      }
    } else if (event.correct === false) {
      if (comboRef.current >= 3) addPopup('combo perdido', 'var(--error)')
      comboRef.current = 0
      setCombo(0)
    }
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
    const b = result.breakdown
    return (
      <div className="container center" style={{ maxWidth: 520, paddingTop: '8vh' }}>
        <div className="panel">
          <h2>Sesión completada — {EXERCISE_NAMES[exerciseType] || exerciseType}</h2>
          <p style={{ color: 'var(--text-dim)' }}>Puntos ganados</p>
          <h1 className="mono" style={{ fontSize: 56, color: 'var(--success)' }}>+{result.points}</h1>

          <div style={{ textAlign: 'left', margin: '16px 0' }}>
            <div className="ranking-row"><span>Aciertos</span><span className="mono" style={{ color: 'var(--success)' }}>{b.correct}</span></div>
            <div className="ranking-row"><span>Errores</span><span className="mono" style={{ color: 'var(--error)' }}>{b.wrong}</span></div>
            <div className="ranking-row"><span>Precisión</span><span className="mono">{Math.round(b.accuracy * 100)}%</span></div>
            <div className="ranking-row"><span>Mejor racha</span><span className="mono" style={{ color: 'var(--warning)' }}>x{b.max_streak}</span></div>
            <div className="ranking-row"><span>Base (× nivel {difficulty})</span><span className="mono">+{b.base}</span></div>
            {b.streak_bonus > 0 && <div className="ranking-row"><span>Bono racha</span><span className="mono" style={{ color: 'var(--warning)' }}>+{b.streak_bonus}</span></div>}
            {b.speed_bonus > 0 && <div className="ranking-row"><span>Bono velocidad (&lt;600ms)</span><span className="mono" style={{ color: 'var(--accent)' }}>+{b.speed_bonus}</span></div>}
            {b.fatigue_alerts > 0 && <div className="ranking-row"><span>Fatiga detectada</span><span className="mono" style={{ color: 'var(--error)' }}>−20%</span></div>}
          </div>

          <p>Total acumulado: <strong className="mono">{result.total}</strong></p>
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
    <div className="container" style={{ position: 'relative' }}>
      {fatigueAlert && (
        <div className="fatigue-banner">⚠ Fatiga detectada — considera un descanso</div>
      )}
      {levelUp && (
        <div className="levelup-banner">⬆ ¡NIVEL {levelUp}!</div>
      )}

      <div className="hud">
        <span className="timer mono">{mins}:{secs.toString().padStart(2, '0')}</span>
        <span style={{ color: 'var(--text-dim)' }}>{EXERCISE_NAMES[exerciseType]}</span>
        <span className="difficulty">Nivel {difficulty}</span>
        {mode === 'competitive' && (
          <>
            <span className={combo >= 3 ? 'combo-hot mono' : 'mono'} style={{ color: combo >= 3 ? 'var(--warning)' : 'var(--text-dim)' }}>
              {combo > 0 ? `COMBO x${combo}` : '—'}
            </span>
            <span className="score mono">{score} pts</span>
          </>
        )}
        <button className="secondary" onClick={endSession}>Terminar</button>
      </div>

      {/* Pop-ups flotantes de puntos */}
      <div className="popup-layer">
        {popups.map((p) => (
          <span key={p.id} className="point-popup mono" style={{ left: `${p.x}%`, color: p.color }}>
            {p.text}
          </span>
        ))}
      </div>

      {exerciseType === 'mot_dual' && (
        <MOTGame difficulty={difficulty} sendEvent={sendEvent} zenMode={mode === 'zen'} />
      )}
      {exerciseType === 'spatial_rotation' && (
        <SpatialGame difficulty={difficulty} sendEvent={sendEvent} />
      )}
      {exerciseType === 'processing_speed' && (
        <SpeedGame difficulty={difficulty} sendEvent={sendEvent} />
      )}
    </div>
  )
}
