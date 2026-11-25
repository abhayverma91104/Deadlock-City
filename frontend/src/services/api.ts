import type {
  AnalyticsSummary,
  BankerCheckResponse,
  ExperimentComparisonResponse,
  GraphEndpointResponse,
  HealthStatus,
  PresetCatalogResponse,
  ResourceCategory,
  ScheduleInputProcess,
  ScheduleResult,
  SimulationEnvelope,
  SyncReport,
} from '../types/simulation'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown>
  readonly sessionId?: string
  readonly state?: SimulationEnvelope['state']
  readonly result?: Record<string, unknown> | null

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown> = {},
    extra?: {
      sessionId?: string
      state?: SimulationEnvelope['state']
      result?: Record<string, unknown> | null
    },
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.sessionId = extra?.sessionId
    this.state = extra?.state
    this.result = extra?.result
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? ''

async function requestJson<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 8000,
): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    })

    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new ApiError(res.status, 'INVALID_JSON', 'Backend returned malformed JSON response.')
      }
    }

    if (!res.ok) {
      const errBody = parsed as {
        error?: { code?: string; message?: string; details?: Record<string, unknown> }
        session_id?: string
        state?: SimulationEnvelope['state']
        result?: Record<string, unknown> | null
      } | null
      throw new ApiError(
        res.status,
        errBody?.error?.code ?? `HTTP_${res.status}`,
        errBody?.error?.message ?? `Request failed with status ${res.status}`,
        errBody?.error?.details ?? {},
        {
          sessionId: errBody?.session_id,
          state: errBody?.state,
          result: errBody?.result,
        },
      )
    }

    return parsed as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(504, 'REQUEST_TIMEOUT', 'Backend request timed out.')
    }
    throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : 'Unable to reach backend.')
  } finally {
    window.clearTimeout(timer)
  }
}

export const apiClient = {
  getHealth(): Promise<HealthStatus> {
    return requestJson<HealthStatus>('/api/health', { method: 'GET' })
  },

  createSimulation(params: { preset?: string | null; seed?: number; speed?: number } = {}): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>('/api/simulation/create', {
      method: 'POST',
      body: JSON.stringify({
        preset: params.preset ?? 'normal_workload',
        seed: params.seed ?? 42,
        speed: params.speed ?? 1.0,
      }),
    })
  },

  getSimulationState(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/state`, {
      method: 'GET',
    })
  },

  startSimulation(sessionId: string, speed?: number): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/start`, {
      method: 'POST',
      body: JSON.stringify(speed !== undefined ? { speed } : {}),
    })
  },

  pauseSimulation(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/pause`, {
      method: 'POST',
    })
  },

  resumeSimulation(sessionId: string, speed?: number): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/resume`, {
      method: 'POST',
      body: JSON.stringify(speed !== undefined ? { speed } : {}),
    })
  },

  stopSimulation(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/stop`, {
      method: 'POST',
    })
  },

  stepSimulation(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/step`, {
      method: 'POST',
    })
  },

  resetSimulation(
    sessionId: string,
    params: { preset?: string | null; seed?: number } = {},
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/reset`, {
      method: 'POST',
      body: JSON.stringify(params),
    })
  },

  runExperimentPreset(sessionId: string, preset: string, seed = 42): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>('/api/experiments/run', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, preset, seed }),
    })
  },

  getGraph(sessionId: string): Promise<GraphEndpointResponse> {
    return requestJson<GraphEndpointResponse>(`/api/simulation/${encodeURIComponent(sessionId)}/graph`, {
      method: 'GET',
    })
  },

  detectDeadlock(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/deadlock`, {
      method: 'GET',
    })
  },

  checkBanker(
    sessionId: string,
    payload: { process_id?: string; hypothetical_request?: Record<string, number> } = {},
  ): Promise<SimulationEnvelope & { result?: BankerCheckResponse | null }> {
    return requestJson<SimulationEnvelope & { result?: BankerCheckResponse | null }>(
      `/api/simulation/${encodeURIComponent(sessionId)}/banker/check`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  },

  recoverDeadlock(
    sessionId: string,
    payload: {
      strategy: 'terminate_all' | 'terminate_victim' | 'preempt_resource' | 'rollback'
      victim_criteria?: 'lowest_priority' | 'lowest_cost' | 'least_allocated' | 'lowest_remaining_work'
      target_process_id?: string
      target_resource_id?: string
      checkpoint_index?: number
    },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/recovery`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  createCheckpoint(sessionId: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/checkpoint`, {
      method: 'POST',
    })
  },

  addProcess(
    sessionId: string,
    payload: {
      name: string
      arrival_time: number
      burst_time: number
      priority: number
      max_demand: Record<string, number>
      termination_cost?: number
    },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/process`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  terminateProcess(sessionId: string, pid: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(
      `/api/simulation/${encodeURIComponent(sessionId)}/process/${encodeURIComponent(pid)}`,
      { method: 'DELETE' },
    )
  },

  suspendProcess(sessionId: string, pid: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(
      `/api/simulation/${encodeURIComponent(sessionId)}/process/${encodeURIComponent(pid)}/suspend`,
      { method: 'POST' },
    )
  },

  resumeProcess(sessionId: string, pid: string): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(
      `/api/simulation/${encodeURIComponent(sessionId)}/process/${encodeURIComponent(pid)}/resume`,
      { method: 'POST' },
    )
  },

  addResource(
    sessionId: string,
    payload: {
      name: string
      category: ResourceCategory
      total_instances: number
      preemptible: boolean
    },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/resource`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  modifyResource(
    sessionId: string,
    rid: string,
    payload: { total_instances?: number; preemptible?: boolean },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(
      `/api/simulation/${encodeURIComponent(sessionId)}/resource/${encodeURIComponent(rid)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      },
    )
  },

  requestResources(
    sessionId: string,
    payload: { process_id: string; request: Record<string, number>; use_banker: boolean },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/request`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  releaseResources(
    sessionId: string,
    payload: { process_id: string; release: Record<string, number> },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(`/api/simulation/${encodeURIComponent(sessionId)}/release`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  compareScheduling(payload: {
    session_id?: string
    quantum: number
    processes?: ScheduleInputProcess[]
  }): Promise<{ comparisons: ScheduleResult[] }> {
    return requestJson<{ comparisons: ScheduleResult[] }>('/api/scheduling/compare', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  },

  runSynchronization(payload: {
    scenario: 'producer_consumer' | 'readers_writers' | 'dining_philosophers'
    mode: 'safe' | 'unsafe'
    iterations: number
    buffer_size: number
    seed?: number
  }): Promise<SyncReport> {
    return requestJson<SyncReport>(
      '/api/synchronization/run',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      16000,
    )
  },

  generateRandomWorkload(
    sessionId: string,
    payload: { process_count: number; resource_count: number; seed: number },
  ): Promise<SimulationEnvelope> {
    return requestJson<SimulationEnvelope>(
      `/api/simulation/${encodeURIComponent(sessionId)}/workload/random`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  },

  getAnalytics(sessionId: string): Promise<AnalyticsSummary> {
    return requestJson<AnalyticsSummary>(`/api/analytics/${encodeURIComponent(sessionId)}`, {
      method: 'GET',
    })
  },

  getExperimentPresets(): Promise<PresetCatalogResponse> {
    return requestJson<PresetCatalogResponse>('/api/experiments/presets', {
      method: 'GET',
    })
  },

  compareExperiments(payload: {
    mode: 'avoidance' | 'recovery' | 'scheduling' | 'synchronization'
    preset?: string
    seed?: number
    process_id?: string
    request_vector?: Record<string, number>
    steps_after?: number
    quantum?: number
    processes?: ScheduleInputProcess[]
    sync_scenario?: 'producer_consumer' | 'readers_writers' | 'dining_philosophers'
    sync_iterations?: number
    sync_buffer_size?: number
  }): Promise<ExperimentComparisonResponse> {
    return requestJson<ExperimentComparisonResponse>(
      '/api/experiments/compare',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      18000,
    )
  },

  async downloadAnalyticsExport(
    sessionId: string,
    format: 'json' | 'csv',
    scope: 'snapshot' | 'metrics' | 'events' = 'metrics',
  ): Promise<{ filename: string; blob: Blob }> {
    const res = await fetch(
      `${API_BASE}/api/analytics/${encodeURIComponent(sessionId)}/export?format=${format}&scope=${scope}`,
    )
    if (!res.ok) {
      throw new ApiError(res.status, 'EXPORT_FAILED', `Export failed (${res.status})`)
    }
    const blob = await res.blob()
    const ext = format
    const suffix = format === 'json' ? 'snapshot' : scope === 'events' ? 'events' : 'metrics'
    return { filename: `deadlock-city-${sessionId}-${suffix}.${ext}`, blob }
  },

  async downloadExperimentExport(payload: {
    kind: 'comparison' | 'scheduling' | 'synchronization'
    format: 'csv' | 'json'
    title: string
    data: Record<string, unknown>
  }): Promise<{ filename: string; blob: Blob }> {
    const res = await fetch(`${API_BASE}/api/experiments/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      throw new ApiError(res.status, 'EXPORT_FAILED', `Experiment export failed (${res.status})`)
    }
    const blob = await res.blob()
    const clean = payload.title.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'experiment'
    return { filename: `${clean}-${payload.kind}.${payload.format}`, blob }
  },
}
