import { useEffect, useRef, useState } from 'react'

interface Props {
  difficulty: number
  sendEvent: (event: Record<string, unknown>) => void
}

const W = 800
const H = 500

const COLORS = [
  { name: 'rojo', hex: '#ff5c5c', key: 'r' },
  { name: 'azul', hex: '#4f9cff', key: 'a' },
  { name: 'verde', hex: '#3ddc84', key: 'v' },
] as const

const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'star'] as const

interface Stimulus {
  color: typeof COLORS[number]
  shape: typeof SHAPES[number]
  x: number
  y: number
  size: number
  shownAt: number
  visible: boolean
}

/**
 * Processing Speed — velocidad de procesamiento visual.
 * - Una forma de color aparece en posición aleatoria durante un instante y desaparece.
 * - El usuario responde el COLOR que vio: teclas R/A/V o botones táctiles.
 * - Dificultad 1-5: menor tiempo de exposición y formas más pequeñas.
 * - Procedural: forma, color, posición, tamaño y pausas aleatorios en cada trial.
 */
export default function SpeedGame({ difficulty, sendEvent }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stimulusRef = useRef<Stimulus | null>(null)
  const difficultyRef = useRef(difficulty)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const [feedback, setFeedback] = useState<'ok' | 'fail' | null>(null)
  const [waiting, setWaiting] = useState(true)

  difficultyRef.current = difficulty

  function later(fn: () => void, ms: number) {
    timersRef.current.push(setTimeout(fn, ms))
  }

  function spawnStimulus() {
    if (stimulusRef.current) return
    const d = difficultyRef.current
    const size = Math.max(30, 90 - d * 12)        // más pequeño con dificultad
    const exposure = Math.max(180, 650 - d * 90)  // menos tiempo visible con dificultad
    const margin = 80
    const stim: Stimulus = {
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      shape: SHAPES[Math.floor(Math.random() * SHAPES.length)],
      x: margin + Math.random() * (W - 2 * margin),
      y: margin + Math.random() * (H - 2 * margin),
      size,
      shownAt: performance.now(),
      visible: true,
    }
    stimulusRef.current = stim
    setWaiting(false)

    later(() => {
      if (stimulusRef.current === stim) stim.visible = false
    }, exposure)

    // Sin respuesta en 2.5s → fallo y siguiente trial
    later(() => {
      if (stimulusRef.current === stim) {
        sendEvent({ type: 'speed_response', correct: false, rtt_ms: 2500, timeout: true, shown_color: stim.color.name })
        finishTrial(false)
      }
    }, 2500)
  }

  function finishTrial(correct: boolean) {
    stimulusRef.current = null
    setWaiting(true)
    setFeedback(correct ? 'ok' : 'fail')
    later(() => setFeedback(null), 300)
    // Pausa variable antes del próximo (evita anticipación rítmica)
    later(spawnStimulus, 700 + Math.random() * 1100)
  }

  function answer(colorName: string) {
    const stim = stimulusRef.current
    if (!stim) return
    const correct = stim.color.name === colorName
    sendEvent({
      type: 'speed_response',
      correct,
      rtt_ms: Math.round(performance.now() - stim.shownAt),
      shown_color: stim.color.name,
      answered_color: colorName,
      shape: stim.shape,
    })
    finishTrial(correct)
  }

  // Arranque + limpieza de timers
  useEffect(() => {
    later(spawnStimulus, 1200)
    return () => { timersRef.current.forEach(clearTimeout); timersRef.current = [] }
  }, [])

  // Teclado: R / A / V
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const c = COLORS.find((col) => col.key === e.key.toLowerCase())
      if (c) answer(c.name)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Loop de renderizado
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    let raf = 0

    function drawStimulus(s: Stimulus) {
      ctx.fillStyle = s.color.hex
      const { x, y, size } = s
      ctx.beginPath()
      switch (s.shape) {
        case 'circle':
          ctx.arc(x, y, size / 2, 0, Math.PI * 2)
          break
        case 'square':
          ctx.rect(x - size / 2, y - size / 2, size, size)
          break
        case 'triangle':
          ctx.moveTo(x, y - size / 2)
          ctx.lineTo(x + size / 2, y + size / 2)
          ctx.lineTo(x - size / 2, y + size / 2)
          ctx.closePath()
          break
        case 'diamond':
          ctx.moveTo(x, y - size / 2)
          ctx.lineTo(x + size / 2, y)
          ctx.lineTo(x, y + size / 2)
          ctx.lineTo(x - size / 2, y)
          ctx.closePath()
          break
        case 'star': {
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? size / 2 : size / 4
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2
            const px = x + Math.cos(a) * r
            const py = y + Math.sin(a) * r
            i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
          }
          ctx.closePath()
          break
        }
      }
      ctx.fill()
    }

    function step() {
      ctx.clearRect(0, 0, W, H)
      // Cruz de fijación central
      ctx.strokeStyle = '#3a3a4a'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(W / 2 - 12, H / 2); ctx.lineTo(W / 2 + 12, H / 2)
      ctx.moveTo(W / 2, H / 2 - 12); ctx.lineTo(W / 2, H / 2 + 12)
      ctx.stroke()

      const s = stimulusRef.current
      if (s?.visible) drawStimulus(s)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

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
      />
      <div className="center mt" style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
        {COLORS.map((c) => (
          <button
            key={c.name}
            onClick={() => answer(c.name)}
            style={{ background: c.hex, minWidth: 110 }}
          >
            {c.name.toUpperCase()} ({c.key.toUpperCase()})
          </button>
        ))}
      </div>
      <p className="center" style={{ color: 'var(--text-dim)', fontSize: 14, marginTop: 8 }}>
        {waiting ? 'Mira la cruz central…' : '¡Ahora!'} — Una forma aparecerá un instante: responde su COLOR (tecla o botón)
      </p>
    </div>
  )
}
