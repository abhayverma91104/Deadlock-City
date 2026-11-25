import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AnalyticsCommandCenter } from '../analytics/AnalyticsCommandCenter'
import {
  deriveCanonicalAnalytics,
  filterHistoryRange,
  filterTimelineEvents,
  normalizeAndBoundHistory,
} from '../analytics/analyticsHelpers'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { SimulationState } from '../types/simulation'

function buildSampleState(overrides: Partial<SimulationState> = {}): SimulationState {
  return {
    tick: 3,
    seed: 42,
    preset: 'classic_banker_safe',
    status: 'PAUSED',
    safety_status: 'SAFE',
    processes: [
      {
        id: 'P0',
        name: 'AuthDaemon',
        arrival_time: 0,
        burst_time: 6,
        remaining_time: 4,
        priority: 2,
        state: 'RUNNING',
        max_demand: { R0: 3, R1: 2 },
        allocated: { R0: 2, R1: 1 },
        need: { R0: 1, R1: 1 },
        pending_request: { R0: 0, R1: 0 },
        city_position: { x: 0, y: 0, z: 0, plot_id: 'P0' },
        termination_cost: 4,
        waiting_ticks: 2,
        preemption_count: 1,
      },
      {
        id: 'P1',
        name: 'BatchTask',
        arrival_time: 0,
        burst_time: 5,
        remaining_time: 5,
        priority: 8,
        state: 'BLOCKED',
        max_demand: { R0: 2, R1: 2 },
        allocated: { R0: 0, R1: 1 },
        need: { R0: 2, R1: 1 },
        pending_request: { R0: 2, R1: 0 },
        city_position: { x: 4, y: 0, z: 0, plot_id: 'P1' },
        termination_cost: 2,
        waiting_ticks: 4,
        preemption_count: 0,
      },
      {
        id: 'P2',
        name: 'DoneWorker',
        arrival_time: 0,
        burst_time: 3,
        remaining_time: 0,
        priority: 3,
        state: 'TERMINATED',
        max_demand: { R0: 1, R1: 0 },
        allocated: { R0: 0, R1: 0 },
        need: { R0: 1, R1: 0 },
        pending_request: {},
        city_position: { x: 8, y: 0, z: 0, plot_id: 'P2' },
        termination_cost: 1,
        waiting_ticks: 0,
        preemption_count: 0,
      },
    ],
    resources: [
      {
        id: 'R0',
        name: 'Compute',
        category: 'COMPUTE',
        total_instances: 4,
        available_instances: 2,
        allocated_instances: 2,
        preemptible: true,
        status: 'ALLOCATED',
        city_position: { x: -4, y: 0, z: 0, plot_id: 'R0' },
      },
      {
        id: 'R1',
        name: 'Lock',
        category: 'LOCK',
        total_instances: 4,
        available_instances: 2,
        allocated_instances: 2,
        preemptible: false,
        status: 'ALLOCATED',
        city_position: { x: -8, y: 0, z: 0, plot_id: 'R1' },
      },
    ],
    deadlock_report: {
      detected: false,
      has_cycle_in_rag: false,
      deadlocked_processes: [],
      involved_resources: [],
      cycles: [],
      wait_for_edges: [],
      steps: [],
      explanation: 'No deadlock detected.',
    },
    banker_report: {
      is_safe: true,
      safe_sequence: ['P0', 'P1'],
      steps: [],
      explanation: 'Safe sequence exists.',
    },
    deadlock_count: 0,
    recovery_count: 1,
    recovery_terminated_count: 0,
    preemption_count: 1,
    completed_count: 1,
    granted_request_count: 3,
    rejected_request_count: 1,
    events: [
      {
        id: 'ev_1',
        tick: 1,
        type: 'ALLOCATION',
        severity: 'success',
        message: 'Granted R0 to P0.',
        metadata: { process_id: 'P0', resource_id: 'R0' },
        recorded_at: '2026-11-24T12:00:01Z',
      },
      {
        id: 'ev_2',
        tick: 2,
        type: 'REJECTION',
        severity: 'warning',
        message: 'Banker rejected unsafe request for P1.',
        metadata: { process_id: 'P1' },
        recorded_at: '2026-11-24T12:00:02Z',
      },
    ],
    metrics_history: [
      {
        tick: 0,
        utilization_pct: 50,
        active_count: 3,
        blocked_count: 0,
        deadlocked_count: 0,
        allocation_count: 4,
        available_count: 4,
        waiting_count: 0,
        completed_count: 0,
        terminated_count: 0,
        pending_request_units: 0,
        deadlock_count: 0,
        recovery_count: 0,
        safety_status: 'SAFE',
        recorded_at: '2026-11-24T12:00:00Z',
      },
      {
        tick: 3,
        utilization_pct: 50,
        active_count: 2,
        blocked_count: 1,
        deadlocked_count: 0,
        allocation_count: 4,
        available_count: 4,
        waiting_count: 0,
        completed_count: 1,
        terminated_count: 1,
        pending_request_units: 2,
        deadlock_count: 0,
        recovery_count: 1,
        safety_status: 'SAFE',
        recorded_at: '2026-11-24T12:00:03Z',
      },
    ],
    checkpoints: [],
    ...overrides,
  }
}

describe('Phase 7 Analytics Command Center, Presets, Comparisons & Exports', () => {
  beforeAll(() => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class ResizeObserver {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      }
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('derives exact canonical KPIs, bounds large datasets to 240 points, deduplicates samples, and filters events', () => {
    const state = buildSampleState()
    const { kpis, distribution } = deriveCanonicalAnalytics(state)

    expect(kpis.total_processes).toBe(3)
    expect(kpis.active_processes).toBe(2)
    expect(kpis.completed_processes).toBe(1)
    expect(kpis.blocked_processes).toBe(1)
    expect(kpis.terminated_processes).toBe(1)
    expect(kpis.total_resource_instances).toBe(8)
    expect(kpis.available_resource_instances).toBe(4)
    expect(kpis.allocated_instances).toBe(4)
    expect(kpis.resource_utilization_pct).toBe(50)
    expect(kpis.pending_request_units).toBe(2)
    expect(kpis.granted_request_count).toBe(3)
    expect(kpis.rejected_request_count).toBe(1)
    expect(kpis.avg_waiting_ticks).toBe(2)
    expect(distribution.RUNNING).toBe(1)
    expect(distribution.BLOCKED).toBe(1)

    // Large dataset (400 unique points) + duplicate tail bounded to 240
    const largeHistory = Array.from({ length: 400 }, (_, i) => ({
      tick: i,
      utilization_pct: (i % 80) + 10,
      active_count: 4,
      blocked_count: 0,
      deadlocked_count: 0,
      allocation_count: 4,
    }))
    largeHistory.push(largeHistory[largeHistory.length - 1]!)
    const bounded = normalizeAndBoundHistory(largeHistory, 'SAFE', 240)
    expect(bounded.length).toBe(240)
    expect(bounded[0]!.tick).toBe(160)
    expect(filterHistoryRange(bounded, 'last10', 0, 100).length).toBe(10)
    expect(filterHistoryRange(bounded, 'custom', 390, 399).length).toBe(10)

    // Event filtering
    const rejOnly = filterTimelineEvents(state.events, 'P1', 'REJECTION', 'warning')
    expect(rejOnly).toHaveLength(1)
    expect(rejOnly[0]!.id).toBe('ev_2')
  })

  it('handles empty historical states, renders charts/table, and reacts to WebSocket updates', async () => {
    vi.spyOn(apiClient, 'getExperimentPresets').mockResolvedValue({
      presets: [
        {
          id: 'normal_workload',
          name: 'Normal Workload',
          category: 'Safe',
          description: 'Balanced 4-process workload',
          os_concept: 'Safe sharing',
          initial_process_count: 4,
          initial_resource_config: { R0: 6 },
          expected_behavior: 'Stays SAFE',
          learning_objective: 'Observe balanced execution',
          recommended_actions: ['Step +1 Tick'],
          default_seed: 42,
        },
      ],
      random_workload: {
        min_processes: 2,
        max_processes: 12,
        min_resources: 2,
        max_resources: 6,
        default_seed: 42,
      },
    })

    const emptyHistState = buildSampleState({ tick: 0, metrics_history: [], events: [] })
    useSimulationStore.setState({
      sessionId: 'sim_p7test',
      simState: emptyHistState,
      latestSeq: 1,
      activeTab: 'analytics',
    })

    render(<AnalyticsCommandCenter />)
    expect(screen.getByText('Analytics & Experimentation Command Center')).toBeInTheDocument()

    // Switch to Historical Charts with 0 samples -> empty state prompt visible
    fireEvent.click(screen.getByRole('tab', { name: 'Historical Charts' }))
    expect(screen.getByText('No Historical Samples Recorded')).toBeInTheDocument()

    // Inject WebSocket STATE_SYNC update -> charts and accessible table appear reactively
    act(() => {
      useSimulationStore.getState().handleWsMessage({
        type: 'STATE_SYNC',
        session_id: 'sim_p7test',
        state: buildSampleState(),
        runtime: { is_running: false, speed: 1, seq: 2 },
      })
    })

    await waitFor(() => {
      expect(screen.getByText('1. Resource Utilization (%) Over Time')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Accessible Table' }))
    expect(screen.getByText(/Historical Telemetry Samples/i)).toBeInTheDocument()
  })

  it('supports presets, guided experiments, isolated comparisons, timeline navigation, exports, and error handling', async () => {
    const presetCatalogSpy = vi.spyOn(apiClient, 'getExperimentPresets').mockResolvedValue({
      presets: [
        {
          id: 'classic_banker_safe',
          name: "Classic Banker's Safe State",
          category: 'Safe',
          description: '5-process textbook safe state',
          os_concept: "Banker's Algorithm",
          initial_process_count: 5,
          initial_resource_config: { R0: 10, R1: 5, R2: 7 },
          expected_behavior: 'P1 -> P3 -> P4 -> P0 -> P2',
          learning_objective: 'Verify Need = Max - Alloc',
          recommended_actions: ["Open Banker's Lab"],
          default_seed: 42,
        },
      ],
      random_workload: {
        min_processes: 2,
        max_processes: 12,
        min_resources: 2,
        max_resources: 6,
        default_seed: 42,
      },
    })

    const compareSpy = vi.spyOn(apiClient, 'compareExperiments').mockResolvedValue({
      mode: 'avoidance',
      preset: 'classic_banker_safe',
      seed: 42,
      parameters: { process_id: 'P4', steps_after: 2 },
      initial_safety_status: 'SAFE',
      expectation: 'Banker ON stays SAFE.',
      arms: [
        {
          label: "Banker's Avoidance ON",
          safety_status: 'SAFE',
          tick: 2,
          utilization_pct: 63.6,
          deadlock_count: 0,
          recovery_count: 0,
          primary_metric: 'Rejected=1',
          summary: 'Unsafe request blocked.',
        },
        {
          label: "Banker's Avoidance OFF",
          safety_status: 'UNSAFE',
          tick: 2,
          utilization_pct: 90.9,
          deadlock_count: 0,
          recovery_count: 0,
          primary_metric: 'Granted=true',
          summary: 'Entered unsafe state.',
        },
      ],
    })

    const downloadSpy = vi.spyOn(apiClient, 'downloadAnalyticsExport').mockResolvedValue({
      filename: 'deadlock-city-sim_p7-metrics.csv',
      blob: new Blob(['session_id,tick,utilization_pct\nsim_p7,3,50\n'], { type: 'text/csv' }),
    })

    // Stub URL.createObjectURL in jsdom
    const origCreateUrl = URL.createObjectURL
    const origRevokeUrl = URL.revokeObjectURL
    URL.createObjectURL = vi.fn(() => 'blob:mock-url')
    URL.revokeObjectURL = vi.fn()

    try {
      const initial = buildSampleState()
      useSimulationStore.setState({
        sessionId: 'sim_p7',
        simState: initial,
        latestSeq: 5,
        activeTab: 'analytics',
      })

      render(<AnalyticsCommandCenter />)
      await waitFor(() => expect(presetCatalogSpy).toHaveBeenCalled())

      // Preset Center tab
      fireEvent.click(screen.getByRole('tab', { name: 'Preset Center' }))
      expect(await screen.findByText('classic_banker_safe')).toBeInTheDocument()

      // Guided Labs tab -> run real Experiment A
      fireEvent.click(screen.getByRole('tab', { name: 'Guided Labs' }))
      fireEvent.click(screen.getByRole('button', { name: 'Run Live C++ Experiment' }))
      await waitFor(() => {
        expect(compareSpy).toHaveBeenCalled()
        expect(screen.getAllByText(/Banker's Avoidance ON/i).length).toBeGreaterThanOrEqual(1)
      })

      // Comparative Engine tab -> isolated comparison must NOT mutate active simState
      fireEvent.click(screen.getByRole('tab', { name: 'Comparative Engine' }))
      compareSpy.mockRejectedValueOnce(new Error('Simulated engine timeout'))
      fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
      expect(await screen.findByText('Simulated engine timeout')).toBeInTheDocument()
      expect(useSimulationStore.getState().simState?.tick).toBe(3)

      // Exports & Summary tab -> download Metrics CSV
      fireEvent.click(screen.getByRole('tab', { name: 'Exports & Summary' }))
      fireEvent.click(screen.getByRole('button', { name: 'Download Metrics (.csv)' }))
      await waitFor(() => {
        expect(downloadSpy).toHaveBeenCalledWith('sim_p7', 'csv', 'metrics')
      })

      // Event Timeline tab -> click Inspect navigates to corresponding module & selects P1
      fireEvent.click(screen.getByRole('tab', { name: 'Event Timeline' }))
      fireEvent.click(screen.getByRole('button', { name: 'Inspect event ev_2 in workbench' }))
      expect(useSimulationStore.getState().selectedEntity).toEqual({ kind: 'process', id: 'P1' })
      expect(useSimulationStore.getState().activeTab).toBe('banker')
    } finally {
      URL.createObjectURL = origCreateUrl
      URL.revokeObjectURL = origRevokeUrl
    }
  })

  it('discloses bounded telemetry retention window when recorded counts exceed retained buffer', async () => {
    vi.spyOn(apiClient, 'getExperimentPresets').mockResolvedValue({
      presets: [],
      random_workload: { min_processes: 2, max_processes: 12, min_resources: 2, max_resources: 6, default_seed: 42 },
    })

    const cappedState = buildSampleState({
      total_metric_samples_recorded: 300,
      total_events_recorded: 260,
    })
    useSimulationStore.setState({
      sessionId: 'sim_capped',
      simState: cappedState,
      latestSeq: 10,
      activeTab: 'analytics',
    })

    render(<AnalyticsCommandCenter />)
    fireEvent.click(screen.getByRole('tab', { name: 'Historical Charts' }))
    expect(screen.getByText(/Bounded retention window: displaying latest 2 of 300 recorded samples/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Event Timeline' }))
    expect(screen.getByText(/2 retained of 260 total/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Exports & Summary' }))
    expect(screen.getByText(/Retained window: 2\/300 samples, 2\/260 events/i)).toBeInTheDocument()
  })
})
