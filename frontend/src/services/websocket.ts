import { getToken } from './api'

export type ServerMessage =
  | { type: 'ping'; ts: number }
  | { type: 'difficulty_change'; difficulty: number }
  | { type: 'fatigue_alert'; rtt_ms: number }

type MessageHandler = (msg: ServerMessage) => void

/**
 * Cliente WebSocket de telemetría con reconexión automática
 * y respuesta automática al heartbeat ping/pong.
 */
export class TelemetrySocket {
  private ws: WebSocket | null = null
  private sessionId: string
  private handler: MessageHandler
  private closed = false
  private retryDelay = 1000

  constructor(sessionId: string, handler: MessageHandler) {
    this.sessionId = sessionId
    this.handler = handler
    this.connect()
  }

  private connect() {
    const token = getToken() || ''
    // En desarrollo: conectar directamente a localhost:8000
    // En producción: usar el mismo host que sirvió la página
    const isDev = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = isDev ? 'localhost:8000' : window.location.host
    const url = `${proto}://${host}/ws/telemetry/${this.sessionId}?token=${token}`
    console.log('[WebSocket] Conectando a:', url)
    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('[WebSocket] Conectado')
      this.retryDelay = 1000
    }

    this.ws.onerror = (err) => {
      console.error('[WebSocket] Error:', err)
    }

    this.ws.onmessage = (e) => {
      const msg: ServerMessage = JSON.parse(e.data)
      if (msg.type === 'ping') {
        this.send({ type: 'pong', ts: msg.ts })
        return
      }
      this.handler(msg)
    }

    this.ws.onclose = () => {
      if (this.closed) return
      // Reconexión con backoff exponencial (máx 10s)
      setTimeout(() => this.connect(), this.retryDelay)
      this.retryDelay = Math.min(this.retryDelay * 2, 10000)
    }
  }

  send(event: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] Enviando:', event)
      this.ws.send(JSON.stringify(event))
    } else {
      console.warn('[WebSocket] No conectado, evento perdido:', event, 'Estado:', this.ws?.readyState)
    }
  }

  close() {
    this.closed = true
    this.ws?.close()
  }
}
