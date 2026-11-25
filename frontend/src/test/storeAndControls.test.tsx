import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SimulationEnvelope, SimulationState } from '../types/simulation'

function makeState(tick: number, safety: 'SAFE' | 'UNSAFE' | 'DEADLOCKED' = 'SAFE'): SimulationState {
  return {
    tick,
    seed: 42,
    preset: 'normal_workload',
    status: 'IDLE',
    safety_status: safety,
    processes: [
      {
        id: 'P0',
        name: 'AuthDaemon',
        arrival_time: 0,
        burst_time: 6,
        remaining_time: Math.max(0, 6 - tick),
        priority: 2,
        state: tick === 0 ? 'READY' : 'RUNNING',
        max_demand: { R0: 2 },
        allocated: { R0: 1 },
        need: { R0: 1 },
        pending_request: { R0: 0 },
        city_position: { x: -6, y: 0, z: -4, plot_id: 'PROC-PLOT-0' },
        termination_cost: 4,
        waiting_ticks: 0,
        preemption_count: 0,
      },
    ],
    resources: [
      {
        id: 'R0',
        name: 'Compute Core',
        category: 'COMPUTE',
        total_instances: 4,
        available_instances: 3,
        allocated_instances: 1,
        preemptible: true,
        status: 'ALLOCATED',
        city_position: { x: 12, y: 0, z: 5, plot_id: 'RES-PLOT-0' },
      },
    ],
    deadlock_report: {
      detected: safety === 'DEADLOCKED',
      has_cycle_in_rag: false,
      deadlocked_processes: safety === 'DEADLOCKED' ? ['P0'] : [],
      involved_resources: [],
      cycles: [],
      wait_for_edges: [],
      steps: [],
      explanation: 'All clear.',
    },
    banker_report: {
      is_safe: safety === 'SAFE',
      safe_sequence: safety === 'SAFE' ? ['P0'] : [],
      steps: [],
      explanation: 'System is SAFE.',
    },
    deadlock_count: 0,
    recovery_count: 0,
    preemption_count: 0,
    events: [],
    metrics_history: [],
  }
}

function makeEnvelope(
  sessionId: string,
  tick: number,
  seq: number,
  isRunning = false,
  speed = 1,
): SimulationEnvelope {
  return {
    session_id: sessionId,
    state: makeState(tick),
    result: {
      runtime: { is_running: isRunning, speed, seq },
    },
  }
}

describe('Zustand Store & HUD Controls', () => {
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

  it('prevents stale snapshots with lower seq from overwriting newer state', () => {
    const store = useSimulationStore.getState()
    store.applyEnvelope(makeEnvelope('sim_1', 3, 10), true)
    expect(useSimulationStore.getState().simState?.tick).toBe(3)

    // Stale response with seq 8 < 10 must be ignored
    store.applyEnvelope(makeEnvelope('sim_1', 1, 8))
    expect(useSimulationStore.getState().simState?.tick).toBe(3)
    expect(useSimulationStore.getState().latestSeq).toBe(10)

    // Newer WebSocket STATE_SYNC seq 11 updates state
    store.handleWsMessage({
      type: 'STATE_SYNC',
      session_id: 'sim_1',
      state: makeState(4),
      runtime: { is_running: true, speed: 2, seq: 11 },
    })
    expect(useSimulationStore.getState().simState?.tick).toBe(4)
    expect(useSimulationStore.getState().latestSeq).toBe(11)
  })

  it('renders loading, disconnected error recovery, and wired simulation controls', async () => {
    vi.spyOn(apiClient, 'getHealth').mockResolvedValue({
      status: 'ok',
      engine_available: true,
      engine_version: '1.0.0',
      active_sessions: 1,
    })
    vi.spyOn(apiClient, 'createSimulation').mockResolvedValue(makeEnvelope('sim_live', 0, 1))
    const startSpy = vi
      .spyOn(apiClient, 'startSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 0, 2, true, 1))
    const stopSpy = vi
      .spyOn(apiClient, 'stopSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 0, 3, false, 1))
    const stepSpy = vi
      .spyOn(apiClient, 'stepSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 1, 4))
    const resumeSpy = vi
      .spyOn(apiClient, 'resumeSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 1, 5, true, 1))
    const pauseSpy = vi
      .spyOn(apiClient, 'pauseSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 1, 6, false, 1))
    const resetSpy = vi
      .spyOn(apiClient, 'resetSimulation')
      .mockResolvedValue(makeEnvelope('sim_live', 0, 7, false, 1))
    const presetSpy = vi
      .spyOn(apiClient, 'runExperimentPreset')
      .mockResolvedValue(makeEnvelope('sim_live', 0, 8, false, 1))

    render(<App />)

    // Bootstrapped state appears from backend
    await waitFor(() => {
      expect(screen.getAllByText('AuthDaemon').length).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText('SID: sim_live')).toBeInTheDocument()
    expect(screen.getByText('C++ v1.0.0')).toBeInTheDocument()

    // Start at tick 0, then Stop
    fireEvent.click(screen.getAllByRole('button', { name: 'Start simulation' })[0]!)
    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith('sim_live', 1)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Stop simulation' }))
    await waitFor(() => {
      expect(stopSpy).toHaveBeenCalledWith('sim_live')
    })

    // Step simulation
    fireEvent.click(screen.getAllByRole('button', { name: 'Step forward 1 tick' })[0]!)
    await waitFor(() => {
      expect(stepSpy).toHaveBeenCalledWith('sim_live')
      expect(screen.getByText('T:1')).toBeInTheDocument()
    })

    // Resume (since tick > 0), adjust speed while running, then Pause
    fireEvent.click(screen.getAllByRole('button', { name: 'Resume simulation' })[0]!)
    await waitFor(() => {
      expect(resumeSpy).toHaveBeenCalledWith('sim_live', 1)
    })
    fireEvent.click(screen.getByRole('button', { name: '2x' }))
    await waitFor(() => {
      expect(resumeSpy).toHaveBeenCalledWith('sim_live', 2)
    })

    fireEvent.click(screen.getAllByRole('button', { name: 'Pause simulation' })[0]!)
    await waitFor(() => {
      expect(pauseSpy).toHaveBeenCalledWith('sim_live')
    })

    // Reset simulation
    fireEvent.click(screen.getAllByRole('button', { name: 'Reset simulation' })[0]!)
    await waitFor(() => {
      expect(resetSpy).toHaveBeenCalled()
      expect(screen.getByText('T:0')).toBeInTheDocument()
    })

    // Open Preset/Session modal and load a preset
    fireEvent.click(screen.getByRole('button', { name: /Presets \/ Session/i }))
    fireEvent.click(screen.getByRole('button', { name: /Single-Instance Deadlock/i }))
    fireEvent.click(screen.getByRole('button', { name: /Load in Current/i }))
    await waitFor(() => {
      expect(presetSpy).toHaveBeenCalledWith('sim_live', 'single_instance_deadlock', 42)
    })
  })

  it('shows disconnected recovery UI when backend fails on startup', async () => {
    vi.spyOn(apiClient, 'getHealth').mockRejectedValue(new Error('Network down'))
    vi.spyOn(apiClient, 'createSimulation').mockRejectedValue(new Error('Connection refused'))

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Backend / Engine Disconnected')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /Retry Connection/i })).toBeInTheDocument()
  })
})
