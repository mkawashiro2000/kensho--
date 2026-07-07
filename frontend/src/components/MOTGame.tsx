import { useEffect, useRef, useState } from 'react'

interface Props {
  difficulty: number
  sendEvent: (event: Record<string, unknown>) => void
  zenMode: boolean
}

interface Sphere {
  x: number; y: number
  vx: number; vy: number
  r: number
  isTarget: boolean
  targetSince: number | null // timestamp cuando se volvió objetivo
}

const W = 800
const H = 500
const RADIUS = 26

/**
 * MOT + Tarea Dual (paridad).
 * - Esferas colisionan elásticamente; una se ilumina como objetivo → clic (mide RTT).
 * - Simultáneamente aparece un número en el centro → tecla P (par) / I (impar).
 * - Estímulos procedurales: números 1-100 sin repetir en la sesión.
 */
export default function MOTGame({ difficulty, sendEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spheresRef = useRef<Sphere[]>([])
  const difficultyRef = useRef(difficulty)
  const usedNumbersRef = useRef<Set<number>>(new Set())
  const currentNumberRef = useRef<{ value: number; shownAt: number } | null>(null)
  const [currentNumber, setCurrentNumber] = useState<number | null>(null)
  const [feedback, setFeedback] = useState<'ok' | 'fail' | null>(null)

  difficultyRef.current = difficulty

  // Inicializar esferas
  useEffect(() => {
    const count = 4 + Math.floor(difficulty / 2) // 4-6 esferas
    const spheres: Sphere[] = []
    for (let i = 0; i < count; i++) {
      spheres.push({
        x: RADIUS + Math.random() * (W - 2 * RADIUS),
        y: RADIUS + Math.random() * (H - 2 * RADIUS),
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        r: RADIUS,
        isTarget: false,
        targetSince: null,
      })
    }
    spheresRef.current = spheres
  }, [difficulty])

  // Loop de física y renderizado
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0

    function step() {
      const spheres = spheresRef.current
      const speed = 1 + difficultyRef.current * 0.8 // velocidad escala con dificultad

      // Movimiento + rebote en paredes
      for (const s of spheres) {
        s.x += s.vx * speed
        s.y += s.vy * speed
        if (s.x - s.r < 0 || s.x + s.r > W) { s.vx *= -1; s.x = Math.max(s.r, Math.min(W - s.r, s.x)) }
        if (s.y - s.r < 0 || s.y + s.r > H) { s.vy *= -1; s.y = Math.max(s.r, Math.min(H - s.r, s.y)) }
      }

      // Colisiones elásticas entre pares (masas iguales → intercambio de velocidades)
      for (let i = 0; i < spheres.length; i++) {
        for (let j = i + 1; j < spheres.length; j++) {
          const a = spheres[i], b = spheres[j]
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.hypot(dx, dy)
          if (dist < a.r + b.r && dist > 0) {
            const nx = dx / dist, ny = dy / dist
            // Separar solapamiento
            const overlap = (a.r + b.r - dist) / 2
            a.x -= nx * overlap; a.y -= ny * overlap
            b.x += nx * overlap; b.y += ny * overlap
            // Intercambiar componentes normales de velocidad
            const va = a.vx * nx + a.vy * ny
            const vb = b.vx * nx + b.vy * ny
            a.vx += (vb - va) * nx; a.vy += (vb - va) * ny
            b.vx += (va - vb) * nx; b.vy += (va - vb) * ny
          }
        }
      }

      // Render
      ctx.clearRect(0, 0, W, H)
      for (const s of spheres) {
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = s.isTarget ? '#4f9cff' : '#2a2a3a'
        ctx.fill()
        ctx.strokeStyle = s.isTarget ? '#8fc4ff' : '#3a3a4a'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Número central (tarea dual)
      const num = currentNumberRef.current
      if (num) {
        ctx.font = 'bold 52px monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#e8e8f0'
        ctx.fillText(String(num.value), W / 2, H / 2)
      }

      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  // Activar objetivo MOT cada 2-4s
  useEffect(() => {
    const interval = setInterval(() => {
      const spheres = spheresRef.current
      if (spheres.some((s) => s.isTarget)) return // ya hay objetivo activo
      const idx = Math.floor(Math.random() * spheres.length)
      spheres[idx].isTarget = true
      spheres[idx].targetSince = performance.now()
      // Timeout: si no hace clic en 3s → fallo
      setTimeout(() => {
        if (spheres[idx]?.isTarget) {
          spheres[idx].isTarget = false
          spheres[idx].targetSince = null
          sendEvent({ type: 'mot_click', correct: false, rtt_ms: 3000, timeout: true })
        }
      }, 3000)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  // Mostrar número de paridad cada 2-3s (sin repetir en sesión)
  useEffect(() => {
    const interval = setInterval(() => {
      if (currentNumberRef.current) {
        // Número anterior expiró sin respuesta → fallo
        const prev = currentNumberRef.current
        sendEvent({
          type: 'semantic_response',
          number: prev.value,
          correct: false,
          latency_ms: Math.round(performance.now() - prev.shownAt),
          timeout: true,
        })
      }
      const used = usedNumbersRef.current
      if (used.size >= 100) used.clear() // agotados: reiniciar pool
      let value: number
      do {
        value = 1 + Math.floor(Math.random() * 100)
      } while (used.has(value))
      used.add(value)
      currentNumberRef.current = { value, shownAt: performance.now() }
      setCurrentNumber(value)
    }, 3000 - difficulty * 200) // más rápido con dificultad
    return () => clearInterval(interval)
  }, [difficulty])

  // Teclado: P = par, I = impar
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const key = e.key.toLowerCase()
      if (key !== 'p' && key !== 'i') return
      const num = currentNumberRef.current
      if (!num) return
      const isEven = num.value % 2 === 0
      const correct = (key === 'p' && isEven) || (key === 'i' && !isEven)
      sendEvent({
        type: 'semantic_response',
        number: num.value,
        response: key === 'p' ? 'par' : 'impar',
        correct,
        latency_ms: Math.round(performance.now() - num.shownAt),
      })
      currentNumberRef.current = null
      setCurrentNumber(null)
      flashFeedback(correct)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function flashFeedback(ok: boolean) {
    setFeedback(ok ? 'ok' : 'fail')
    setTimeout(() => setFeedback(null), 300)
  }

  // Clic en canvas → verificar si acertó al objetivo
  function onCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    const scaleX = W / rect.width
    const scaleY = H / rect.height
    const x = (e.clientX - rect.left) * scaleX
    const y = (e.clientY - rect.top) * scaleY

    const target = spheresRef.current.find((s) => s.isTarget)
    if (!target) {
      sendEvent({ type: 'mot_click', correct: false, rtt_ms: null, premature: true })
      flashFeedback(false)
      return
    }
    const hit = Math.hypot(x - target.x, y - target.y) <= target.r + 6
    const rtt = Math.round(performance.now() - (target.targetSince || performance.now()))
    target.isTarget = false
    target.targetSince = null
    sendEvent({ type: 'mot_click', correct: hit, rtt_ms: rtt })
    flashFeedback(hit)
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="game-canvas"
        style={{
          width: '100%',
          maxWidth: W,
          boxShadow: feedback === 'ok' ? '0 0 0 3px var(--success)'
            : feedback === 'fail' ? '0 0 0 3px var(--error)' : 'none',
        }}
        onClick={onCanvasClick}
      />
      <p className="center mt" style={{ color: 'var(--text-dim)', fontSize: 14 }}>
        Haz clic en la esfera <span style={{ color: 'var(--accent)' }}>azul</span> cuando se ilumine ·
        Número central: tecla <strong>P</strong> (par) / <strong>I</strong> (impar)
        {currentNumber !== null && <span className="mono"> · Actual: {currentNumber}</span>}
      </p>
    </div>
  )
}
