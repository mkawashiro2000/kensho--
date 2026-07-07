import { useEffect, useRef, useState } from 'react'

interface Props {
  difficulty: number
  sendEvent: (event: Record<string, unknown>) => void
}

const W = 800
const H = 500
const TOLERANCE = 5 // ±5° del objetivo

/**
 * Rotación Espacial.
 * - Se muestra una figura poligonal a la izquierda con rotación aleatoria (estímulo)
 *   y la misma figura a la derecha en rotación 0 (manipulable).
 * - El usuario arrastra para rotar la figura derecha hasta igualar la izquierda (±5°).
 * - Dificultad: figuras más complejas y ángulos más finos.
 * - Estímulos procedurales: cada trial genera figura y ángulo nuevos.
 */
export default function SpatialGame({ difficulty, sendEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [trial, setTrial] = useState(0)
  const shapeRef = useRef<[number, number][]>([])
  const targetAngleRef = useRef(0)
  const userAngleRef = useRef(0)
  const trialStartRef = useRef(0)
  const draggingRef = useRef(false)
  const lastPointerAngleRef = useRef(0)
  const [feedback, setFeedback] = useState<'ok' | 'fail' | null>(null)

  // Generar nuevo trial (figura + ángulo procedurales, nunca idénticos)
  useEffect(() => {
    const vertices = 5 + Math.min(4, difficulty) // 6-9 vértices según dificultad
    const shape: [number, number][] = []
    for (let i = 0; i < vertices; i++) {
      const angle = (i / vertices) * Math.PI * 2
      const radius = 40 + Math.random() * 70 // radio irregular → figura única
      shape.push([Math.cos(angle) * radius, Math.sin(angle) * radius])
    }
    shapeRef.current = shape
    // Ángulo objetivo: evitar 0±15 para que siempre haya rotación real
    let target = Math.random() * 360
    if (target < 15 || target > 345) target = 90 + Math.random() * 180
    targetAngleRef.current = target
    userAngleRef.current = 0
    trialStartRef.current = performance.now()
  }, [trial, difficulty])

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0

    function drawShape(cx: number, cy: number, angleDeg: number, color: string) {
      const shape = shapeRef.current
      if (shape.length === 0) return
      const rad = (angleDeg * Math.PI) / 180
      ctx.beginPath()
      shape.forEach(([px, py], i) => {
        const x = cx + px * Math.cos(rad) - py * Math.sin(rad)
        const y = cy + px * Math.sin(rad) + py * Math.cos(rad)
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      })
      ctx.closePath()
      ctx.fillStyle = color + '22'
      ctx.fill()
      ctx.strokeStyle = color
      ctx.lineWidth = 2.5
      ctx.stroke()
      // Marca de orientación (línea del centro al primer vértice)
      const [fx, fy] = shape[0]
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(
        cx + fx * Math.cos(rad) - fy * Math.sin(rad),
        cy + fx * Math.sin(rad) + fy * Math.cos(rad),
      )
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    function step() {
      ctx.clearRect(0, 0, W, H)
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#8888a0'
      ctx.fillText('OBJETIVO', W * 0.27, 40)
      ctx.fillText('ROTA ESTA (arrastra)', W * 0.73, 40)
      drawShape(W * 0.27, H / 2, targetAngleRef.current, '#ffb340')
      drawShape(W * 0.73, H / 2, userAngleRef.current, '#4f9cff')
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  function pointerAngle(e: React.PointerEvent): number {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (W / rect.width) - W * 0.73
    const y = (e.clientY - rect.top) * (H / rect.height) - H / 2
    return (Math.atan2(y, x) * 180) / Math.PI
  }

  function onPointerDown(e: React.PointerEvent) {
    draggingRef.current = true
    lastPointerAngleRef.current = pointerAngle(e)
    canvasRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!draggingRef.current) return
    const angle = pointerAngle(e)
    let delta = angle - lastPointerAngleRef.current
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    userAngleRef.current = (userAngleRef.current + delta + 360) % 360
    lastPointerAngleRef.current = angle
  }

  function onPointerUp() {
    draggingRef.current = false
  }

  function checkAnswer() {
    const diff = Math.abs(((userAngleRef.current - targetAngleRef.current + 540) % 360) - 180)
    const correct = diff <= TOLERANCE
    const timeMs = Math.round(performance.now() - trialStartRef.current)
    sendEvent({
      type: 'rotation_attempt',
      angle_attempted: Math.round(userAngleRef.current),
      angle_target: Math.round(targetAngleRef.current),
      angular_error: Math.round(diff),
      correct,
      rtt_ms: timeMs,
    })
    setFeedback(correct ? 'ok' : 'fail')
    setTimeout(() => {
      setFeedback(null)
      if (correct) setTrial((t) => t + 1) // nuevo trial procedural
    }, 400)
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
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />
      <div className="center mt">
        <button onClick={checkAnswer}>Comprobar rotación</button>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 8 }}>
          Arrastra la figura azul hasta igualar la orientación de la naranja (±{TOLERANCE}°)
        </p>
      </div>
    </div>
  )
}
