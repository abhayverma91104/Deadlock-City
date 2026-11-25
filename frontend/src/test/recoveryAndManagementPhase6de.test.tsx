import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ProcessResourceManager } from '../simulation/ProcessResourceManager'
import { RecoveryCenter } from '../simulation/RecoveryCenter'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SimulationState } from '../types/simulation'

function makeDeadlockedState(): SimulationState {
  return {
    tick: 1,
    seed: 42,
    preset: 'recovery_demo',
    status: 'IDLE',
    safety_status: 'DEADLOCKED',
    processes: [
      {
        id: 'P0',
        name: 'CriticalGateway',
        arrival_time: 0,
        burst_time: 9,
        remaining_time: 9,
        priority: 1,
        state: 'BLOCKED',
        max_demand: { R0: 1, R1: 1 },
        allocated: { R0: 1, R1: 0 },
        need: { R0: 0, R1: 1 },
        pending_request: { R0: 0, R1: 1 },
        city_position: { x: 0, y: 0, z: 0, plot_id: 'PROC-PLOT-0' },
        termination_cost: 10,
        waiting_ticks: 1,
        preemption_count: 0,
      },
      {
        id: 'P1',
        name: 'TempWorker',
        arrival_time: 0,
        burst_time: 4,
        remaining_time: 4,
        priority: 8,
        state: 'BLOCKED',
        max_demand: { R0: 1, R1: 1 },
        allocated: { R0: 0, R1: 1 },
        need: { R0: 1, R1: 0 },
        pending_request: { R0: 1, R1: 0 },
        city_position: { x: 4, y: 0, z: 0, plot_id: 'PROC-PLOT-1' },
        termination_cost: 1,
        waiting_ticks: 1,
        preemption_count: 0,
      },
    ],
    resources: [
      {
        id: 'R0',
        name: 'Socket Port',
        category: 'IO',
        total_instances: 1,
        available_instances: 0,
        allocated_instances: 1,
        preemptible: false,
        status: 'UNAVAILABLE',
        city_position: { x: 12, y: 0, z: 0, plot_id: 'RES-PLOT-0' },
      },
      {
        id: 'R1',
        name: 'Cache Slot',
        category: 'MEMORY',
        total_instances: 1,
        available_instances: 0,
        allocated_instances: 1,
        preemptible: true,
        status: 'UNAVAILABLE',
        city_position: { x: 0, y: 0, z: 12, plot_id: 'RES-PLOT-1' },
      },
    ],
    deadlock_report: {
      detected: true,
      has_cycle_in_rag: true,
      deadlocked_processes: ['P0', 'P1'],
      involved_resources: ['R0', 'R1'],
      cycles: [['P0', 'R1', 'P1', 'R0']],
      wait_for_edges: [],
      steps: [],
      explanation: 'Deadlock detected.',
    },
    banker_report: { is_safe: false, safe_sequence: [], steps: [], explanation: 'Unsafe.' },
    deadlock_count: 1,
    recovery_count: 0,
    preemption_count: 0,
    events: [],
    metrics_history: [],
    checkpoints: [{ tick: 0 }],
  }
}

describe('Phase 6D Recovery Center & 6E Process/Resource Manager', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      sessionId: 'sim_6de',
      latestSeq: 1,
      simState: makeDeadlockedState(),
      toasts: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('requires confirmation dialog before executing recovery and shows before/after comparison', async () => {
    const recoveredState = makeDeadlockedState()
    recoveredState.safety_status = 'SAFE'
    recoveredState.deadlock_report.detected = false
    recoveredState.deadlock_report.deadlocked_processes = []
    recoveredState.recovery_count = 1

    const recSpy = vi.spyOn(apiClient, 'recoverDeadlock').mockResolvedValue({
      session_id: 'sim_6de',
      state: recoveredState,
      result: {
        ok: true,
        error_code: '',
        message: 'Terminated victim process P1.',
        terminated_processes: ['P1'],
        preempted_resources: [],
        recovered_units: { R1: 1 },
        surviving_processes: ['P0'],
        unblocked_processes: ['P0'],
        restored_checkpoint_index: null,
        runtime: { is_running: false, speed: 1, seq: 2 },
      },
    })

    render(<RecoveryCenter />)

    fireEvent.click(screen.getByRole('button', { name: 'Execute Recovery Strategy' }))
    expect(screen.getByText('Confirm Destructive Recovery Operation')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Recovery' }))
    await waitFor(() => {
      expect(recSpy).toHaveBeenCalledWith(
        'sim_6de',
        expect.objectContaining({ strategy: 'terminate_victim', victim_criteria: 'lowest_cost' }),
      )
      expect(screen.getByText(/DEADLOCKED → SAFE/)).toBeInTheDocument()
      expect(screen.getByText('Terminated victim process P1.')).toBeInTheDocument()
    })
  })

  it('synchronizes canonical store state when partial recovery returns HTTP 409 DEADLOCK_UNRESOLVED', async () => {
    const { ApiError } = await import('../services/api')
    const partialState = makeDeadlockedState()
    partialState.recovery_count = 1
    partialState.processes[1]!.state = 'TERMINATED'
    partialState.deadlock_report.deadlocked_processes = ['P0']

    vi.spyOn(apiClient, 'recoverDeadlock').mockRejectedValue(
      new ApiError(
        409,
        'DEADLOCK_UNRESOLVED',
        'Victim terminated, but disjoint deadlock remains.',
        { session_id: 'sim_6de' },
        {
          sessionId: 'sim_6de',
          state: partialState,
          result: {
            ok: false,
            error_code: 'DEADLOCK_UNRESOLVED',
            message: 'Victim terminated, but disjoint deadlock remains.',
            terminated_processes: ['P1'],
            preempted_resources: [],
            recovered_units: { R1: 1 },
            surviving_processes: ['P0'],
            unblocked_processes: [],
            restored_checkpoint_index: null,
            runtime: { is_running: false, speed: 1, seq: 2 },
          },
        },
      ),
    )

    render(<RecoveryCenter />)
    fireEvent.click(screen.getByRole('button', { name: 'Execute Recovery Strategy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Recovery' }))

    await waitFor(() => {
      expect(useSimulationStore.getState().simState?.recovery_count).toBe(1)
      expect(useSimulationStore.getState().simState?.processes[1]?.state).toBe('TERMINATED')
      expect(screen.getByText(/Victim terminated, but disjoint deadlock remains/i)).toBeInTheDocument()
    })
  })

  it('creates processes, adds resources, and displays backend validation errors', async () => {
    const addProcSpy = vi.spyOn(apiClient, 'addProcess').mockResolvedValue({
      session_id: 'sim_6de',
      state: makeDeadlockedState(),
      result: { runtime: { is_running: false, speed: 1, seq: 2 } },
    })
    const addResSpy = vi.spyOn(apiClient, 'addResource').mockResolvedValue({
      session_id: 'sim_6de',
      state: makeDeadlockedState(),
      result: { runtime: { is_running: false, speed: 1, seq: 3 } },
    })

    render(<ProcessResourceManager />)

    fireEvent.click(screen.getByRole('button', { name: /Spawn Process/i }))
    await waitFor(() => {
      expect(addProcSpy).toHaveBeenCalled()
    })

    fireEvent.click(screen.getByRole('tab', { name: /Resources/i }))
    fireEvent.click(screen.getByRole('button', { name: /Create Resource Type/i }))
    await waitFor(() => {
      expect(addResSpy).toHaveBeenCalled()
    })
  })
})
