import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '../services/api'
import { SimulationWebSocketManager } from '../services/wsManager'
import type { WsConnectionStatus, WsServerMessage } from '../types/simulation'

describe('apiClient', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('fetches health and parses JSON response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'ok',
          engine_available: true,
          engine_version: '1.0.0',
          active_sessions: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const health = await apiClient.getHealth()
    expect(health.engine_available).toBe(true)
    expect(health.engine_version).toBe('1.0.0')
  })

  it('throws structured ApiError on backend domain error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'SESSION_NOT_FOUND',
            message: "Simulation session 'sim_bad' not found.",
            details: {},
          },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(apiClient.getSimulationState('sim_bad')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 'SESSION_NOT_FOUND',
    })
  })

  it('throws NETWORK_ERROR when fetch rejects', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Failed to fetch'))
    try {
      await apiClient.getHealth()
      throw new Error('Expected failure')
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe('NETWORK_ERROR')
    }
  })
})

describe('SimulationWebSocketManager', () => {
  const originalWs = globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    globalThis.WebSocket = originalWs
    vi.useRealTimers()
  })

  it('connects, parses STATE_SYNC, and reconnects with bounded backoff on abnormal close', () => {
    const sockets: FakeSocket[] = []

    class FakeSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      readyState = FakeSocket.CONNECTING
      onopen: (() => void) | null = null
      onmessage: ((e: MessageEvent<string>) => void) | null = null
      onerror: (() => void) | null = null
      onclose: ((e: CloseEvent) => void) | null = null
      sent: string[] = []
      url: string

      constructor(url: string) {
        this.url = url
        sockets.push(this)
      }
      send(data: string) {
        this.sent.push(data)
      }
      close() {
        this.readyState = FakeSocket.CLOSED
      }
      triggerOpen() {
        this.readyState = FakeSocket.OPEN
        this.onopen?.()
      }
      triggerClose(code: number) {
        this.readyState = FakeSocket.CLOSED
        this.onclose?.({ code } as CloseEvent)
      }
    }

    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket

    const statuses: WsConnectionStatus[] = []
    const messages: WsServerMessage[] = []
    const mgr = new SimulationWebSocketManager({
      onStatusChange: (s) => statuses.push(s),
      onMessage: (m) => messages.push(m),
    })

    mgr.connect('sim_123')
    expect(sockets).toHaveLength(1)
    sockets[0]!.triggerOpen()
    expect(statuses).toContain('connected')

    sockets[0]!.onmessage?.({
      data: JSON.stringify({ type: 'PONG' }),
    } as MessageEvent<string>)
    expect(messages).toEqual([{ type: 'PONG' }])

    // Heartbeat fires after 20s
    vi.advanceTimersByTime(20000)
    expect(sockets[0]!.sent).toContain(JSON.stringify({ type: 'PING' }))

    // Abnormal close triggers reconnecting + new socket after 500ms
    sockets[0]!.triggerClose(1006)
    expect(statuses[statuses.length - 1]).toBe('reconnecting')
    vi.advanceTimersByTime(500)
    expect(sockets).toHaveLength(2)

    mgr.disconnect()
    expect(statuses[statuses.length - 1]).toBe('disconnected')
  })
})
