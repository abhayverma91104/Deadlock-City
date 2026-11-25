import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CpuSchedulingLab } from '../simulation/CpuSchedulingLab'
import { SyncLabView } from '../simulation/SyncLabView'
import { apiClient } from '../services/api'

describe('Phase 6F CPU Scheduling Lab & 6G Sync Lab', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('compares CPU scheduling algorithms and renders Gantt idle intervals', async () => {
    const compareSpy = vi.spyOn(apiClient, 'compareScheduling').mockResolvedValue({
      comparisons: [
        {
          algorithm: 'FCFS',
          quantum: 2,
          gantt: [
            { process_id: 'P1', process_name: 'P1', start_time: 2, end_time: 5 },
            { process_id: 'P2', process_name: 'P2', start_time: 7, end_time: 9 },
          ],
          process_metrics: [
            {
              id: 'P1',
              name: 'P1',
              arrival_time: 2,
              burst_time: 3,
              priority: 1,
              completion_time: 5,
              turnaround_time: 3,
              waiting_time: 0,
              response_time: 0,
            },
          ],
          avg_waiting_time: 0,
          avg_turnaround_time: 2.5,
          avg_response_time: 0,
          context_switches: 1,
          cpu_utilization_pct: 55.6,
          total_time: 9,
        },
      ],
    })

    render(<CpuSchedulingLab />)
    fireEvent.click(screen.getByRole('button', { name: 'Compare All 5' }))

    await waitFor(() => {
      expect(compareSpy).toHaveBeenCalled()
      expect(screen.getAllByText('IDLE').length).toBeGreaterThanOrEqual(2)
    })
  })

  it('executes C++ SyncLab and plays back Producer-Consumer & Dining Philosophers events', async () => {
    const syncSpy = vi.spyOn(apiClient, 'runSynchronization').mockResolvedValue({
      scenario: 'producer_consumer',
      mode: 'safe',
      completed_cleanly: true,
      race_or_deadlock_detected: false,
      produced_count: 12,
      consumed_count: 12,
      overflows: 0,
      underflows: 0,
      conflicts: 0,
      completed_meals: 0,
      events: [
        {
          seq: 0,
          thread_id: 'Producer-1',
          state: 'RUNNING',
          action: 'PRODUCE',
          resource: 'Buffer',
          detail: 'Item queued; occupancy 1/4',
          buffer_occupancy: 1,
          buffer_capacity: 4,
        },
      ],
      logs: ['[Producer-1] PRODUCE (Buffer): Item queued'],
      summary: 'SAFE Producer-Consumer completed.',
    })

    render(<SyncLabView />)
    fireEvent.click(screen.getByRole('button', { name: /Execute C\+\+ Experiment/i }))

    await waitFor(() => {
      expect(syncSpy).toHaveBeenCalled()
      expect(screen.getByText('SAFE Producer-Consumer completed.')).toBeInTheDocument()
      expect(screen.getByText('SLOT 0')).toBeInTheDocument()
    })
  })
})
