import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import {
  buildConduitLinks,
  computeBuildingHeight,
  getProcessColorScheme,
  resolveEntityPosition,
} from '../city/citySceneUtils'
import { WebGLErrorBoundary } from '../city/WebGLErrorBoundary'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SimulationEnvelope, SimulationState } from '../types/simulation'

function makeMultiState(options: {
  tick?: number
  safety?: 'SAFE' | 'UNSAFE' | 'DEADLOCKED'
  detected?: boolean
  hasCycle?: boolean
  extraProcess?: boolean
  terminatedP0?: boolean
}): SimulationState {
  const safety = options.safety ?? 'SAFE'
  const detected = options.detected ?? safety === 'DEADLOCKED'
  const hasCycle = options.hasCycle ?? detected

  const processes: SimulationState['processes'] = [
    {
      id: 'P0',
      name: 'BillingJob',
      arrival_time: 0,
      burst_time: 6,
      remaining_time: options.terminatedP0 ? 0 : 4,
      priority: 2,
      state: options.terminatedP0 ? 'TERMINATED' : detected ? 'BLOCKED' : 'RUNNING',
      max_demand: { R0: 1, R1: 1 },
      allocated: options.terminatedP0 ? { R0: 0, R1: 0 } : { R0: 1, R1: 0 },
      need: options.terminatedP0 ? { R0: 0, R1: 0 } : { R0: 0, R1: 1 },
      pending_request: options.terminatedP0 ? { R0: 0, R1: 0 } : { R0: 0, R1: 1 },
      city_position: { x: -6.75, y: 0, z: -4.5, plot_id: 'PROC-PLOT-0' },
      termination_cost: 4,
      waiting_ticks: detected ? 2 : 0,
      preemption_count: 0,
    },
    {
      id: 'P1',
      name: 'LedgerSync',
      arrival_time: 0,
      burst_time: 5,
      remaining_time: 5,
      priority: 3,
      state: detected ? 'BLOCKED' : 'READY',
      max_demand: { R0: 1, R1: 1 },
      allocated: { R0: 0, R1: 1 },
      need: { R0: 1, R1: 0 },
      pending_request: { R0: 1, R1: 0 },
      city_position: { x: -2.25, y: 0, z: -4.5, plot_id: 'PROC-PLOT-1' },
      termination_cost: 2,
      waiting_ticks: 0,
      preemption_count: 0,
    },
  ]

  if (options.extraProcess) {
    processes.push({
      id: 'P2',
      name: 'DynamicWorker',
      arrival_time: 1,
      burst_time: 4,
      remaining_time: 4,
      priority: 1,
      state: 'NEW',
      max_demand: { R0: 1, R1: 0 },
      allocated: { R0: 0, R1: 0 },
      need: { R0: 1, R1: 0 },
      pending_request: { R0: 0, R1: 0 },
      city_position: { x: 2.25, y: 0, z: -4.5, plot_id: 'PROC-PLOT-2' },
      termination_cost: 3,
      waiting_ticks: 0,
      preemption_count: 0,
    })
  }

  return {
    tick: options.tick ?? 0,
    seed: 42,
    preset: detected ? 'single_instance_deadlock' : 'normal_workload',
    status: 'IDLE',
    safety_status: safety,
    processes,
    resources: [
      {
        id: 'R0',
        name: 'Printer A',
        category: 'IO',
        total_instances: 2,
        available_instances: 1,
        allocated_instances: 1,
        preemptible: false,
        status: 'REQUESTED',
        city_position: { x: 12.93, y: 0, z: 5.36, plot_id: 'RES-PLOT-0' },
      },
      {
        id: 'R1',
        name: 'DB Lock B',
        category: 'LOCK',
        total_instances: 1,
        available_instances: 0,
        allocated_instances: 1,
        preemptible: false,
        status: 'UNAVAILABLE',
        city_position: { x: 5.36, y: 0, z: 12.93, plot_id: 'RES-PLOT-1' },
      },
    ],
    deadlock_report: {
      detected,
      has_cycle_in_rag: hasCycle,
      deadlocked_processes: detected ? ['P0', 'P1'] : [],
      involved_resources: detected ? ['R0', 'R1'] : [],
      cycles: hasCycle ? [['P0', 'R1', 'P1', 'R0']] : [],
      wait_for_edges: [],
      steps: [],
      explanation: detected ? 'Circular wait detected.' : 'No deadlock.',
    },
    banker_report: {
      is_safe: safety === 'SAFE',
      safe_sequence: safety === 'SAFE' ? ['P0', 'P1'] : [],
      steps: [],
      explanation: 'Evaluated.',
    },
    deadlock_count: detected ? 1 : 0,
    recovery_count: 0,
    preemption_count: 0,
    events: [],
    metrics_history: [],
  }
}

describe('Phase 5 3D City Scene Logic, Fallback & Store Sync', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useSimulationStore.setState({
      health: null,
      backendConnected: false,
      wsStatus: 'disconnected',
      sessionId: null,
      simState: null,
      runtime: { is_running: false, speed: 1, seq: 0 },
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
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('builds allocation and request conduits and distinguishes RAG cycles from confirmed deadlocks', () => {
    const cycleNoDeadlock = makeMultiState({ safety: 'SAFE', detected: false, hasCycle: true })
    const cycleLinks = buildConduitLinks(
      cycleNoDeadlock.processes,
      cycleNoDeadlock.resources,
      cycleNoDeadlock.deadlock_report,
    )
    expect(cycleLinks).toHaveLength(4)
    expect(cycleLinks.every((l) => !l.isDeadlocked)).toBe(true)
    expect(cycleLinks.some((l) => l.isCycleOnly)).toBe(true)

    const confirmedDeadlock = makeMultiState({ safety: 'DEADLOCKED', detected: true, hasCycle: true })
    const deadLinks = buildConduitLinks(
      confirmedDeadlock.processes,
      confirmedDeadlock.resources,
      confirmedDeadlock.deadlock_report,
    )
    expect(deadLinks.every((l) => l.isDeadlocked)).toBe(true)
    expect(deadLinks.some((l) => l.isCycleOnly)).toBe(false)
  })

  it('computes deterministic positions, heights, and state schemes including TERMINATED', () => {
    const st = makeMultiState({ terminatedP0: true })
    expect(computeBuildingHeight(6, 'TERMINATED')).toBe(1.5)
    expect(computeBuildingHeight(6, 'RUNNING')).toBeGreaterThan(2.5)
    expect(getProcessColorScheme('TERMINATED', false).badge).toBe('OFFLINE')
    expect(resolveEntityPosition({ kind: 'resource', id: 'R0' }, st.processes, st.resources)).toEqual([
      12.93, 0, 5.36,
    ])
  })

  it('renders 2D fallback in non-WebGL environments, supports selection/camera/quality controls, and reacts to WS updates', async () => {
    const initialEnv: SimulationEnvelope = {
      session_id: 'sim_city',
      state: makeMultiState({ safety: 'UNSAFE', detected: false, hasCycle: false }),
      result: { runtime: { is_running: false, speed: 1, seq: 1 } },
    }
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      engine_available: true,
      engine_version: '1.0.0',
      active_sessions: 1,
    })
    vi.spyOn(apiClient, 'createSimulation').mockResolvedValue(initialEnv)

    render(<App />)

    // In JSDOM (no WebGL), fallback 2D Tactical City Map renders cleanly
    await waitFor(() => {
      expect(screen.getByRole('region', { name: '2D Tactical City Map' })).toBeInTheDocument()
    })
    expect(screen.getAllByText('Unsafe (No Deadlock)').length).toBeGreaterThanOrEqual(1)

    // Select Resource R0 from fallback map button and check LeftInspectorRail sync
    fireEvent.click(screen.getAllByRole('button', { name: 'R0' })[0]!)
    expect(screen.getByText('Facility • R0')).toBeInTheDocument()
    expect(screen.getByText('Printer A')).toBeInTheDocument()

    // Focus camera increments cameraCommand nonce; Clear selection clears selectedEntity
    const prevNonce = useSimulationStore.getState().cameraCommand.nonce
    fireEvent.click(screen.getAllByRole('button', { name: 'Focus camera on selected entity' })[0]!)
    expect(useSimulationStore.getState().cameraCommand.nonce).toBe(prevNonce + 1)
    expect(useSimulationStore.getState().cameraCommand.type).toBe('focus')

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(useSimulationStore.getState().selectedEntity).toBeNull()

    // Switch Graphics Quality to High
    fireEvent.click(screen.getByRole('button', { name: 'high' }))
    expect(useSimulationStore.getState().graphicsQuality).toBe('high')

    // Live WebSocket STATE_SYNC adds P2 and marks deadlock
    useSimulationStore.getState().handleWsMessage({
      type: 'STATE_SYNC',
      session_id: 'sim_city',
      state: makeMultiState({ tick: 2, safety: 'DEADLOCKED', detected: true, extraProcess: true }),
      runtime: { is_running: false, speed: 1, seq: 2 },
    })

    await waitFor(() => {
      expect(screen.getByText('2 Deadlocked')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'P2' }).length).toBeGreaterThanOrEqual(1)
    })
  })

  it('catches WebGL rendering errors cleanly via WebGLErrorBoundary', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ExplodingChild = () => {
      throw new Error('Simulated WebGL failure')
    }
    render(
      <WebGLErrorBoundary fallback={<div>Fallback Active</div>}>
        <ExplodingChild />
      </WebGLErrorBoundary>,
    )
    expect(screen.getByText('Fallback Active')).toBeInTheDocument()
    consoleSpy.mockRestore()
  })
})
