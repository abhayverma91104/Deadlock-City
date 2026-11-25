import type { WsConnectionStatus, WsServerMessage } from '../types/simulation'

export interface WsCallbacks {
  onStatusChange: (status: WsConnectionStatus) => void
  onMessage: (message: WsServerMessage) => void
}

function buildWsUrl(sessionId: string): string {
  const configured = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.replace(/\/$/, '')
  if (configured) {
    return `${configured}/ws/simulation/${encodeURIComponent(sessionId)}`
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws/simulation/${encodeURIComponent(sessionId)}`
}

export class SimulationWebSocketManager {
  private socket: WebSocket | null = null
  private sessionId: string | null = null
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 8
  private reconnectTimer: number | null = null
  private heartbeatTimer: number | null = null
  private intentionallyClosed = false
  private readonly callbacks: WsCallbacks

  constructor(callbacks: WsCallbacks) {
    this.callbacks = callbacks
  }

  connect(sessionId: string): void {
    if (this.sessionId === sessionId && this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return
    }
    this.disconnect()
    this.sessionId = sessionId
    this.intentionallyClosed = false
    this.reconnectAttempts = 0
    this.openSocket(sessionId)
  }

  disconnect(): void {
    this.intentionallyClosed = true
    this.clearTimers()
    this.sessionId = null
    if (this.socket) {
      try {
        this.socket.onopen = null
        this.socket.onmessage = null
        this.socket.onerror = null
        this.socket.onclose = null
        this.socket.close(1000, 'Client disconnect')
      } catch {
        // Ignore close errors
      }
      this.socket = null
    }
    this.callbacks.onStatusChange('disconnected')
  }

  private openSocket(sessionId: string): void {
    if (this.intentionallyClosed) return
    this.callbacks.onStatusChange(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(buildWsUrl(sessionId))
    } catch {
      this.scheduleReconnect(sessionId)
      return
    }
    this.socket = ws

    ws.onopen = () => {
      if (this.intentionallyClosed || this.sessionId !== sessionId) return
      this.reconnectAttempts = 0
      this.callbacks.onStatusChange('connected')
      this.startHeartbeat()
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (this.intentionallyClosed || this.sessionId !== sessionId) return
      try {
        const msg = JSON.parse(event.data) as WsServerMessage
        this.callbacks.onMessage(msg)
      } catch {
        // Ignore non-JSON frames
      }
    }

    ws.onerror = () => {
      if (this.intentionallyClosed) return
      this.callbacks.onStatusChange('error')
    }

    ws.onclose = (ev: CloseEvent) => {
      this.stopHeartbeat()
      if (this.intentionallyClosed || this.sessionId !== sessionId) {
        this.callbacks.onStatusChange('disconnected')
        return
      }
      // 4404 = session not found; do not endlessly reconnect to an invalid session
      if (ev.code === 4404) {
        this.callbacks.onStatusChange('disconnected')
        return
      }
      this.scheduleReconnect(sessionId)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: 'PING' }))
        } catch {
          // Handled by onclose
        }
      }
    }, 20000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect(sessionId: string): void {
    if (this.intentionallyClosed || this.sessionId !== sessionId) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.callbacks.onStatusChange('disconnected')
      return
    }
    const delayMs = Math.min(8000, 500 * Math.pow(2, this.reconnectAttempts))
    this.reconnectAttempts += 1
    this.callbacks.onStatusChange('reconnecting')
    this.reconnectTimer = window.setTimeout(() => {
      if (!this.intentionallyClosed && this.sessionId === sessionId) {
        this.openSocket(sessionId)
      }
    }, delayMs)
  }
}
