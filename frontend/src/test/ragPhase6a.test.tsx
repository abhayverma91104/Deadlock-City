import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ResourceAllocationGraphView } from '../graph/ResourceAllocationGraphView'
import { apiClient } from '../services/api'
import { useSimulationStore } from '../stores/useSimulationStore'
import type { GraphEndpointResponse } from '../types/simulation'

// Mock @xyflow/react lightly for JSDOM unit testing
vi.mock('@xyflow/react', async () => {
  const actual = await vi.importActual<typeof import('@xyflow/react')>('@xyflow/react')
  return {
    ...actual,
    ReactFlow: ({
      nodes,
      edges,
      onNodeClick,
      onEdgeClick,
      children,
    }: {
      nodes: Array<{ id: string; type?: string; data: { name?: string } }>
      edges: Array<{ id: string; source: string; target: string; label?: string; data?: unknown }>
      onNodeClick?: (e: unknown, n: unknown) => void
      onEdgeClick?: (e: unknown, edge: unknown) => void
      children?: React.ReactNode
    }) => (
      <div data-testid="mock-react-flow">
        {nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onNodeClick?.({}, n)}
          >
            {n.id} {n.data.name}
          </button>
        ))}
        {edges.map((ed) => (
          <button
            key={ed.id}
            type="button"
            onClick={() => onEdgeClick?.({}, ed)}
          >
            {ed.source}-&gt;{ed.target} ({ed.label})
          </button>
        ))}
        {children}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
  }
})

describe('Phase 6A Resource Allocation Graph', () => {
  beforeEach(() => {
    useSimulationStore.setState({
      sessionId: 'sim_rag',
      latestSeq: 1,
      selectedEntity: null,
      simState: {
        tick: 0,
        seed: 42,
        preset: 'multi_instance_safe_cycle',
        status: 'IDLE',
        safety_status: 'SAFE',
        processes: [],
        resources: [],
        deadlock_report: {
          detected: false,
          has_cycle_in_rag: true,
          deadlocked_processes: [],
          involved_resources: [],
          cycles: [['P0', 'R1', 'P1', 'R0']],
          wait_for_edges: [{ from: 'P0', to: 'P1', resource_id: 'R1' }],
          steps: [],
          explanation: 'Cycle without deadlock.',
        },
        banker_report: { is_safe: true, safe_sequence: ['P2', 'P1', 'P0'], steps: [], explanation: 'Safe' },
        deadlock_count: 0,
        recovery_count: 0,
        preemption_count: 0,
        events: [],
        metrics_history: [],
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('distinguishes multi-instance RAG cycle from deadlock, switches to Wait-For Graph, and syncs node selection', async () => {
    const graphResp: GraphEndpointResponse = {
      session_id: 'sim_rag',
      state: useSimulationStore.getState().simState!,
      graph: {
        nodes: [
          {
            id: 'P0',
            type: 'process',
            position: { x: 100, y: 0 },
            data: {
              id: 'P0',
              name: 'Worker-0',
              state: 'BLOCKED',
              priority: 2,
              allocated: { R0: 1 },
              pending_request: { R1: 1 },
              need: { R1: 1 },
              is_deadlocked: false,
              in_cycle: true,
            },
          },
          {
            id: 'R1',
            type: 'resource',
            position: { x: 400, y: 0 },
            data: {
              id: 'R1',
              name: 'Mutex Lock',
              category: 'LOCK',
              total_instances: 1,
              available_instances: 0,
              allocated_instances: 1,
              status: 'UNAVAILABLE',
              is_involved_in_deadlock: false,
              in_cycle: true,
            },
          },
        ],
        edges: [
          {
            id: 'req_P0_R1',
            source: 'P0',
            target: 'R1',
            kind: 'request',
            units: 1,
            in_cycle: true,
            is_deadlocked: false,
            label: 'req ×1',
          },
        ],
        has_cycle: true,
        deadlock_detected: false,
        deadlocked_processes: [],
        cycles: [['P0', 'R1']],
        wait_for_edges: [{ from: 'P0', to: 'P1', resource_id: 'R1' }],
      },
    }

    vi.spyOn(apiClient, 'getGraph').mockResolvedValue(graphResp)

    render(<ResourceAllocationGraphView />)

    await waitFor(() => {
      expect(screen.getByText(/Multi-Instance Cycle Present — NOT a Deadlock/i)).toBeInTheDocument()
    })

    // Click node syncs Zustand selectedEntity
    fireEvent.click(screen.getByRole('button', { name: 'P0 Worker-0' }))
    expect(useSimulationStore.getState().selectedEntity).toEqual({ kind: 'process', id: 'P0' })

    // Click edge updates Edge Inspector
    fireEvent.click(screen.getByRole('button', { name: /P0->R1/i }))
    expect(screen.getByText('Deadlock Member: NO')).toBeInTheDocument()

    // Switch to Wait-For Graph tab
    fireEvent.click(screen.getByRole('tab', { name: 'Wait-For Graph' }))
    expect(screen.getByRole('button', { name: /P0->P1 \(waits R1\)/i })).toBeInTheDocument()
  })
})
