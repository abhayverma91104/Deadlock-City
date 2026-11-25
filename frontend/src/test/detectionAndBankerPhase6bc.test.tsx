import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BankersAlgorithmLab } from '../simulation/BankersAlgorithmLab'
import { DeadlockDetectionLab } from '../simulation/DeadlockDetectionLab'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SimulationEnvelope, SimulationState } from '../types/simulation'

function makeBankerState(): SimulationState {
  return {
    tick: 0,
    seed: 42,
    preset: 'classic_banker_safe',
    status: 'IDLE',
    safety_status: 'SAFE',
    processes: [
      {
        id: 'P0',
        name: 'Proc-0',
        arrival_time: 0,
        burst_time: 7,
        remaining_time: 7,
        priority: 3,
        state: 'READY',
        max_demand: { R0: 7, R1: 5, R2: 3 },
        allocated: { R0: 0, R1: 1, R2: 0 },
        need: { R0: 7, R1: 4, R2: 3 },
        pending_request: { R0: 0, R1: 0, R2: 0 },
        city_position: { x: 0, y: 0, z: 0, plot_id: 'PROC-PLOT-0' },
        termination_cost: 5,
        waiting_ticks: 0,
        preemption_count: 0,
      },
      {
        id: 'P1',
        name: 'Proc-1',
        arrival_time: 0,
        burst_time: 4,
        remaining_time: 4,
        priority: 2,
        state: 'READY',
        max_demand: { R0: 3, R1: 2, R2: 2 },
        allocated: { R0: 2, R1: 0, R2: 0 },
        need: { R0: 1, R1: 2, R2: 2 },
        pending_request: { R0: 0, R1: 0, R2: 0 },
        city_position: { x: 4, y: 0, z: 0, plot_id: 'PROC-PLOT-1' },
        termination_cost: 3,
        waiting_ticks: 0,
        preemption_count: 0,
      },
    ],
    resources: [
      {
        id: 'R0',
        name: 'CPU',
        category: 'COMPUTE',
        total_instances: 10,
        available_instances: 3,
        allocated_instances: 7,
        preemptible: true,
        status: 'ALLOCATED',
        city_position: { x: 12, y: 0, z: 0, plot_id: 'RES-PLOT-0' },
      },
      {
        id: 'R1',
        name: 'RAM',
        category: 'MEMORY',
        total_instances: 5,
        available_instances: 3,
        allocated_instances: 2,
        preemptible: false,
        status: 'ALLOCATED',
        city_position: { x: 0, y: 0, z: 12, plot_id: 'RES-PLOT-1' },
      },
      {
        id: 'R2',
        name: 'IO',
        category: 'IO',
        total_instances: 7,
        available_instances: 2,
        allocated_instances: 5,
        preemptible: false,
        status: 'ALLOCATED',
        city_position: { x: -12, y: 0, z: 0, plot_id: 'RES-PLOT-2' },
      },
    ],
    deadlock_report: {
      detected: false,
      has_cycle_in_rag: false,
      deadlocked_processes: [],
      involved_resources: [],
      cycles: [],
      wait_for_edges: [{ from: 'P0', to: 'P1', resource_id: 'R1' }],
      steps: [
        {
          step_index: 0,
          work_before: { R0: 3, R1: 3, R2: 2 },
          work_after: { R0: 5, R1: 3, R2: 2 },
          selected_process: 'P1',
          finish_snapshot: { P0: false, P1: true },
          note: 'Request(P1) <= Work; process can finish.',
        },
        {
          step_index: 1,
          work_before: { R0: 5, R1: 3, R2: 2 },
          work_after: { R0: 5, R1: 4, R2: 2 },
          selected_process: 'P0',
          finish_snapshot: { P0: true, P1: true },
          note: 'Request(P0) <= Work; process can finish.',
        },
      ],
      explanation: 'No deadlock detected.',
    },
    banker_report: {
      is_safe: true,
      safe_sequence: ['P1', 'P0'],
      steps: [
        {
          step_index: 0,
          work_before: { R0: 3, R1: 3, R2: 2 },
          work_after: { R0: 5, R1: 3, R2: 2 },
          selected_process: 'P1',
          finish_snapshot: { P0: false, P1: true },
          note: 'Need(P1) <= Work; simulated completion.',
        },
        {
          step_index: 1,
          work_before: { R0: 5, R1: 3, R2: 2 },
          work_after: { R0: 5, R1: 4, R2: 2 },
          selected_process: 'P0',
          finish_snapshot: { P0: true, P1: true },
          note: 'Need(P0) <= Work; simulated completion.',
        },
      ],
      explanation: 'System is SAFE. Valid safe execution sequence: P1 -> P0.',
    },
    deadlock_count: 0,
    recovery_count: 0,
    preemption_count: 0,
    events: [],
    metrics_history: [],
  }
}

describe('Phase 6B Detection Lab & 6C Banker Lab', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      sessionId: 'sim_6bc',
      latestSeq: 1,
      simState: makeBankerState(),
      toasts: [],
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('plays back Deadlock Detection trace steps and invokes Run Detection API', async () => {
    const detectSpy = vi.spyOn(apiClient, 'detectDeadlock').mockResolvedValue({
      session_id: 'sim_6bc',
      state: makeBankerState(),
      result: { runtime: { is_running: false, speed: 1, seq: 2 } },
    })

    render(<DeadlockDetectionLab />)

    expect(screen.getByText('Step 1 / 2')).toBeInTheDocument()
    expect(screen.getByText(/Request\(P1\) <= Work/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next step' }))
    expect(screen.getByText('Step 2 / 2')).toBeInTheDocument()
    expect(screen.getByText(/Request\(P0\) <= Work/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }))
    expect(screen.getByText('Step 1 / 2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Run Detection/i }))
    await waitFor(() => {
      expect(detectSpy).toHaveBeenCalledWith('sim_6bc')
    })
  })

  it('evaluates hypothetical Banker request without mutating canonical state and executes safe request', async () => {
    const checkSpy = vi.spyOn(apiClient, 'checkBanker').mockResolvedValue({
      session_id: 'sim_6bc',
      state: makeBankerState(),
      result: {
        would_approve: false,
        error_code: 'UNSAFE_STATE_REJECTED',
        reason: 'Resulting state would be UNSAFE.',
        banker_report: {
          is_safe: false,
          safe_sequence: [],
          steps: [],
          explanation: 'Unsafe.',
        },
      },
    } as SimulationEnvelope)

    const reqSpy = vi.spyOn(apiClient, 'requestResources').mockResolvedValue({
      session_id: 'sim_6bc',
      state: makeBankerState(),
      result: { granted: true, reason: 'Approved', runtime: { is_running: false, speed: 1, seq: 3 } },
    })

    render(<BankersAlgorithmLab />)

    expect(screen.getByText('SAFE STATE')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/R0 \(Avail 3\)/i), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check Hypothetical' }))

    await waitFor(() => {
      expect(checkSpy).toHaveBeenCalledWith('sim_6bc', {
        process_id: 'P0',
        hypothetical_request: { R0: 1, R1: 0, R2: 0 },
      })
      expect(screen.getByText(/Rejected \(UNSAFE_STATE_REJECTED\)/i)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Execute Safe' }))
    await waitFor(() => {
      expect(reqSpy).toHaveBeenCalledWith('sim_6bc', {
        process_id: 'P0',
        request: { R0: 1, R1: 0, R2: 0 },
        use_banker: true,
      })
    })
  })
})
