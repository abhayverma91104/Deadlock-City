import { create } from 'zustand'
import { ApiError, apiClient } from '../services/api'
import { SimulationWebSocketManager } from '../services/wsManager'
import type {
  HealthStatus,
  NavTabId,
  RuntimeMeta,
  SimulationEnvelope,
  SimulationState,
  WsConnectionStatus,
  WsServerMessage,
} from '../types/simulation'

const SESSION_STORAGE_KEY = 'deadlock_city_session_id'

export type SelectedEntity =
  | { kind: 'process'; id: string }
  | { kind: 'resource'; id: string }
  | null

export type GraphicsQuality = 'low' | 'medium' | 'high'
export type CityViewMode = '3d' | '2d'
export type CameraActionType = 'isometric' | 'top' | 'focus'

export interface CameraCommand {
  type: CameraActionType
  nonce: number
}

export interface ToastItem {
  id: string
  severity: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
}

interface SimulationStore {
  health: HealthStatus | null
  backendConnected: boolean
  wsStatus: WsConnectionStatus
  sessionId: string | null
  simState: SimulationState | null
  runtime: RuntimeMeta
  latestSeq: number
  activeTab: NavTabId
  selectedEntity: SelectedEntity
  hoveredEntity: SelectedEntity
  graphicsQuality: GraphicsQuality
  viewMode: CityViewMode
  cameraCommand: CameraCommand
  isLoading: boolean
  isMutating: boolean
  errorMessage: string | null
  toasts: ToastItem[]

  setActiveTab: (tab: NavTabId) => void
  setSelectedEntity: (entity: SelectedEntity) => void
  setHoveredEntity: (entity: SelectedEntity) => void
  setGraphicsQuality: (quality: GraphicsQuality) => void
  setViewMode: (mode: CityViewMode) => void
  triggerCamera: (type: CameraActionType) => void
  clearError: () => void
  pushToast: (toast: Omit<ToastItem, 'id'>) => void
  dismissToast: (id: string) => void

  refreshHealth: () => Promise<boolean>
  bootstrapSession: () => Promise<void>
  createSession: (preset?: string, seed?: number, speed?: number) => Promise<void>
  selectPreset: (preset: string, seed?: number) => Promise<void>
  loadRandomWorkload: (processCount: number, resourceCount: number, seed: number) => Promise<void>
  start: () => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
  step: () => Promise<void>
  reset: () => Promise<void>
  setSpeed: (speed: number) => Promise<void>
  applyEnvelope: (envelope: SimulationEnvelope, forceReplaceSession?: boolean) => void
  handleWsMessage: (msg: WsServerMessage) => void
  disconnectWs: () => void
}

let wsManagerInstance: SimulationWebSocketManager | null = null
let activeBootstrapPromise: Promise<void> | null = null

function getWsManager(): SimulationWebSocketManager {
  if (!wsManagerInstance) {
    wsManagerInstance = new SimulationWebSocketManager({
      onStatusChange: (status) => {
        useSimulationStore.setState({ wsStatus: status })
      },
      onMessage: (msg) => {
        useSimulationStore.getState().handleWsMessage(msg)
      },
    })
  }
  return wsManagerInstance
}

function formatError(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Unexpected backend communication error.'
}

export const useSimulationStore = create<SimulationStore>((set, get) => ({
  health: null,
  backendConnected: false,
  wsStatus: 'disconnected',
  sessionId: null,
  simState: null,
  runtime: { is_running: false, speed: 1.0, seq: 0 },
  latestSeq: 0,
  activeTab: 'city',
  selectedEntity: null,
  hoveredEntity: null,
  graphicsQuality: 'medium',
  viewMode: '3d',
  cameraCommand: { type: 'isometric', nonce: 0 },
  isLoading: false,
  isMutating: false,
  errorMessage: null,
  toasts: [],

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedEntity: (entity) => set({ selectedEntity: entity }),
  setHoveredEntity: (entity) => set({ hoveredEntity: entity }),
  setGraphicsQuality: (quality) => set({ graphicsQuality: quality }),
  setViewMode: (mode) => set({ viewMode: mode }),
  triggerCamera: (type) =>
    set((s) => ({ cameraCommand: { type, nonce: s.cameraCommand.nonce + 1 } })),
  clearError: () => set({ errorMessage: null }),

  pushToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    set((s) => ({
      toasts: [...s.toasts.slice(-3), { ...toast, id }],
    }))
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        get().dismissToast(id)
      }, 4500)
    }
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  applyEnvelope: (envelope, forceReplaceSession = false) => {
    const { sessionId: currentSessionId, latestSeq } = get()
    const incomingRuntime = envelope.result?.runtime ?? { is_running: false, speed: 1.0, seq: 1 }
    const incomingSeq = incomingRuntime.seq ?? 0

    // Stale snapshot protection within the same session
    if (
      !forceReplaceSession &&
      currentSessionId === envelope.session_id &&
      incomingSeq > 0 &&
      incomingSeq < latestSeq
    ) {
      return
    }

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(SESSION_STORAGE_KEY, envelope.session_id)
      } catch {
        // Ignore storage restrictions
      }
    }

    // Keep selected entity valid across state changes
    const prevSelected = get().selectedEntity
    let nextSelected = prevSelected
    if (prevSelected) {
      const stillExists =
        prevSelected.kind === 'process'
          ? envelope.state.processes.some((p) => p.id === prevSelected.id)
          : envelope.state.resources.some((r) => r.id === prevSelected.id)
      if (!stillExists) nextSelected = null
    }
    if (!nextSelected && envelope.state.processes.length > 0) {
      nextSelected = { kind: 'process', id: envelope.state.processes[0]!.id }
    }

    set({
      sessionId: envelope.session_id,
      simState: envelope.state,
      runtime: incomingRuntime,
      latestSeq: incomingSeq,
      selectedEntity: nextSelected,
      errorMessage: null,
      backendConnected: true,
    })
  },

  handleWsMessage: (msg) => {
    if (msg.type === 'STATE_SYNC') {
      const { sessionId, latestSeq } = get()
      if (sessionId && msg.session_id !== sessionId) return
      const incomingSeq = msg.runtime?.seq ?? latestSeq
      if (incomingSeq < latestSeq) return

      set({
        simState: msg.state,
        runtime: msg.runtime ?? get().runtime,
        latestSeq: incomingSeq,
        backendConnected: true,
      })
      return
    }
    if (msg.type === 'ERROR') {
      get().pushToast({
        severity: 'error',
        title: msg.error.code,
        message: msg.error.message,
      })
    }
  },

  refreshHealth: async () => {
    try {
      const health = await apiClient.getHealth()
      set({ health, backendConnected: health.engine_available })
      return health.engine_available
    } catch (err) {
      set({
        health: null,
        backendConnected: false,
        errorMessage: formatError(err),
      })
      return false
    }
  },

  bootstrapSession: async () => {
    if (activeBootstrapPromise) {
      return activeBootstrapPromise
    }
    activeBootstrapPromise = (async () => {
      set({ isLoading: true, errorMessage: null })
      await get().refreshHealth()

      let savedId: string | null = null
      if (typeof window !== 'undefined') {
        try {
          savedId = window.localStorage.getItem(SESSION_STORAGE_KEY)
        } catch {
          savedId = null
        }
      }

      if (savedId) {
        try {
          const restored = await apiClient.getSimulationState(savedId)
          get().applyEnvelope(restored, true)
          getWsManager().connect(restored.session_id)
          set({ isLoading: false })
          return
        } catch {
          // Saved session expired on server restart; fall through to create a fresh session
        }
      }

      await get().createSession('normal_workload', 42, 1.0)
      set({ isLoading: false })
    })().finally(() => {
      activeBootstrapPromise = null
    })
    return activeBootstrapPromise
  },

  createSession: async (preset = 'normal_workload', seed = 42, speed = 1.0) => {
    set({ isMutating: true, errorMessage: null })
    try {
      const env = await apiClient.createSimulation({ preset, seed, speed })
      get().applyEnvelope(env, true)
      getWsManager().connect(env.session_id)
      get().pushToast({
        severity: 'success',
        title: 'Session Active',
        message: `Initialized ${env.session_id} (${preset}).`,
      })
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Create Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  selectPreset: async (preset, seed = 42) => {
    const sid = get().sessionId
    if (!sid) {
      await get().createSession(preset, seed, get().runtime.speed)
      return
    }
    set({ isMutating: true, errorMessage: null })
    try {
      const env = await apiClient.runExperimentPreset(sid, preset, seed)
      get().applyEnvelope(env)
      get().pushToast({
        severity: 'info',
        title: 'Preset Loaded',
        message: `Loaded scenario "${preset}".`,
      })
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Preset Error', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  loadRandomWorkload: async (processCount, resourceCount, seed) => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true, errorMessage: null })
    try {
      const env = await apiClient.generateRandomWorkload(sid, {
        process_count: processCount,
        resource_count: resourceCount,
        seed,
      })
      get().applyEnvelope(env)
      get().pushToast({
        severity: 'info',
        title: 'Random Workload',
        message: `Generated ${processCount} processes × ${resourceCount} resources (seed ${seed}).`,
      })
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Random Generation Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  start: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.startSimulation(sid, get().runtime.speed)
      get().applyEnvelope(env)
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Start Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  pause: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.pauseSimulation(sid)
      get().applyEnvelope(env)
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Pause Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  resume: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.resumeSimulation(sid, get().runtime.speed)
      get().applyEnvelope(env)
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Resume Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  stop: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.stopSimulation(sid)
      get().applyEnvelope(env)
      get().pushToast({ severity: 'info', title: 'Stopped', message: 'Simulation loop stopped.' })
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Stop Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  step: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.stepSimulation(sid)
      get().applyEnvelope(env)
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Step Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  reset: async () => {
    const sid = get().sessionId
    if (!sid) return
    set({ isMutating: true })
    try {
      const env = await apiClient.resetSimulation(sid, {
        preset: get().simState?.preset ?? 'normal_workload',
        seed: get().simState?.seed ?? 42,
      })
      get().applyEnvelope(env)
      get().pushToast({ severity: 'info', title: 'Reset', message: 'Simulation reset to tick 0.' })
    } catch (err) {
      const msg = formatError(err)
      set({ errorMessage: msg })
      get().pushToast({ severity: 'error', title: 'Reset Failed', message: msg })
    } finally {
      set({ isMutating: false })
    }
  },

  setSpeed: async (speed) => {
    const sid = get().sessionId
    set((s) => ({ runtime: { ...s.runtime, speed } }))
    if (!sid) return
    // Sync speed via documented /start or /resume contract when running; otherwise stored for next start
    if (get().runtime.is_running) {
      try {
        const env = await apiClient.resumeSimulation(sid, speed)
        get().applyEnvelope(env)
      } catch (err) {
        get().pushToast({ severity: 'error', title: 'Speed Update Failed', message: formatError(err) })
      }
    }
  },

  disconnectWs: () => {
    getWsManager().disconnect()
  },
}))
