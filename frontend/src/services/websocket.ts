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
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = import.meta.env.VITE_API_URL
      ? new URL(import.meta.env.VITE_API_URL).host
      : window.location.host
    const token = getToken() || ''
    this.ws = new WebSocket(`${proto}://${host}/ws/telemetry/${this.sessionId}?token=${token}`)

    this.ws.onopen = () => {
      this.retryDelay = 1000
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
      this.ws.send(JSON.stringify(event))
    }
  }

  close() {
    this.closed = true
    this.ws?.close()
  }
}
