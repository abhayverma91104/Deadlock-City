import type {
  AnalyticsKpis,
  MetricPoint,
  ProcessState,
  SafetyStatus,
  SimulationEvent,
  SimulationState,
} from '../types/simulation'

export type HistoryRangeMode = 'all' | 'last20' | 'last10' | 'custom'
export type TimeAxisMode = 'tick' | 'timestamp'

export interface EnrichedHistoryPoint {
  index: number
  tick: number
  tickLabel: string
  timeLabel: string
  recordedAt: string
  utilization_pct: number
  available_count: number
  allocation_count: number
  active_count: number
  waiting_count: number
  blocked_count: number
  completed_count: number
  terminated_count: number
  deadlocked_count: number
  pending_request_units: number
  deadlock_count: number
  recovery_count: number
  safety_status: SafetyStatus
  safety_numeric: number
}

export type EventCategoryFilter =
  | 'ALL'
  | 'PROCESS'
  | 'RESOURCE'
  | 'REQUEST_ALLOC'
  | 'REJECTION'
  | 'DEADLOCK_SAFETY'
  | 'RECOVERY_CHECKPOINT'

export function safetyScoreFromStatus(status: SafetyStatus | string | undefined): number {
  if (status === 'DEADLOCKED') return 0
  if (status === 'UNSAFE') return 1
  return 2
}

export function deriveCanonicalAnalytics(state: SimulationState): {
  kpis: AnalyticsKpis
  distribution: Record<ProcessState, number>
} {
  const distribution: Record<ProcessState, number> = {
    NEW: 0,
    READY: 0,
    RUNNING: 0,
    WAITING: 0,
    BLOCKED: 0,
    TERMINATED: 0,
  }

  let activeProcesses = 0
  let waitingProcesses = 0
  let blockedProcesses = 0
  let terminatedProcesses = 0
  let derivedCompleted = 0
  let pendingUnits = 0
  let pendingProcessCount = 0
  let waitingTicksSum = 0

  for (const p of state.processes) {
    distribution[p.state] = (distribution[p.state] ?? 0) + 1
    waitingTicksSum += p.waiting_ticks ?? 0
    if (p.state !== 'TERMINATED') {
      activeProcesses += 1
      let procPending = 0
      for (const qty of Object.values(p.pending_request ?? {})) {
        if (qty > 0) procPending += qty
      }
      if (procPending > 0) {
        pendingUnits += procPending
        pendingProcessCount += 1
      }
    } else {
      terminatedProcesses += 1
      if (p.remaining_time === 0) derivedCompleted += 1
    }
    if (p.state === 'WAITING') waitingProcesses += 1
    if (p.state === 'BLOCKED') blockedProcesses += 1
  }

  let totalInstances = 0
  let availableInstances = 0
  let allocatedInstances = 0
  for (const r of state.resources) {
    totalInstances += r.total_instances
    availableInstances += r.available_instances
    allocatedInstances += r.allocated_instances
  }

  const utilPct =
    totalInstances > 0 ? Math.round((allocatedInstances / totalInstances) * 10000) / 100 : 0
  const avgWait =
    state.processes.length > 0
      ? Math.round((waitingTicksSum / state.processes.length) * 100) / 100
      : 0

  return {
    distribution,
    kpis: {
      total_processes: state.processes.length,
      active_processes: activeProcesses,
      completed_processes: state.completed_count ?? derivedCompleted,
      waiting_processes: waitingProcesses,
      blocked_processes: blockedProcesses,
      terminated_processes: terminatedProcesses,
      deadlocked_processes: state.deadlock_report?.deadlocked_processes?.length ?? 0,
      total_resource_types: state.resources.length,
      total_resource_instances: totalInstances,
      available_resource_instances: availableInstances,
      allocated_instances: allocatedInstances,
      resource_utilization_pct: utilPct,
      pending_request_units: pendingUnits,
      pending_request_processes: pendingProcessCount,
      granted_request_count: state.granted_request_count ?? 0,
      rejected_request_count: state.rejected_request_count ?? 0,
      deadlock_count: state.deadlock_count ?? 0,
      recovery_count: state.recovery_count ?? 0,
      recovery_terminated_count: state.recovery_terminated_count ?? 0,
      preemption_count: state.preemption_count ?? 0,
      avg_waiting_ticks: avgWait,
    },
  }
}

export function formatUtcTimestamp(iso: string | undefined): string {
  if (!iso) return 'N/A'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toISOString().slice(11, 19) + 'Z'
}

export function normalizeAndBoundHistory(
  history: MetricPoint[],
  fallbackSafety: SafetyStatus,
  maxSamples = 240,
): EnrichedHistoryPoint[] {
  const deduped: MetricPoint[] = []
  for (const pt of history) {
    const prev = deduped[deduped.length - 1]
    if (
      prev &&
      prev.tick === pt.tick &&
      prev.utilization_pct === pt.utilization_pct &&
      prev.allocation_count === pt.allocation_count &&
      prev.active_count === pt.active_count &&
      prev.blocked_count === pt.blocked_count &&
      prev.deadlocked_count === pt.deadlocked_count &&
      (prev.recovery_count ?? 0) === (pt.recovery_count ?? 0) &&
      (prev.safety_status ?? fallbackSafety) === (pt.safety_status ?? fallbackSafety)
    ) {
      continue
    }
    deduped.push(pt)
  }

  const bounded = deduped.slice(-maxSamples)
  return bounded.map((pt, idx) => {
    const safety = pt.safety_status ?? fallbackSafety
    const rec = pt.recorded_at ?? ''
    const shortTime = rec ? formatUtcTimestamp(rec) : `S${idx + 1}`
    return {
      index: idx + 1,
      tick: pt.tick,
      tickLabel: `T${pt.tick}`,
      timeLabel: shortTime,
      recordedAt: rec || 'Unstamped (local snapshot)',
      utilization_pct: pt.utilization_pct,
      available_count: pt.available_count ?? 0,
      allocation_count: pt.allocation_count,
      active_count: pt.active_count,
      waiting_count: pt.waiting_count ?? 0,
      blocked_count: pt.blocked_count,
      completed_count: pt.completed_count ?? 0,
      terminated_count: pt.terminated_count ?? 0,
      deadlocked_count: pt.deadlocked_count,
      pending_request_units: pt.pending_request_units ?? 0,
      deadlock_count: pt.deadlock_count ?? 0,
      recovery_count: pt.recovery_count ?? 0,
      safety_status: safety,
      safety_numeric: safetyScoreFromStatus(safety),
    }
  })
}

export function filterHistoryRange(
  points: EnrichedHistoryPoint[],
  mode: HistoryRangeMode,
  customMinTick: number,
  customMaxTick: number,
): EnrichedHistoryPoint[] {
  if (mode === 'last10') return points.slice(-10)
  if (mode === 'last20') return points.slice(-20)
  if (mode === 'custom') {
    const lo = Math.min(customMinTick, customMaxTick)
    const hi = Math.max(customMinTick, customMaxTick)
    return points.filter((p) => p.tick >= lo && p.tick <= hi)
  }
  return points
}

export function mapEventCategory(ev: SimulationEvent): EventCategoryFilter {
  const t = ev.type.toUpperCase()
  if (t.includes('PROCESS')) return 'PROCESS'
  if (t.includes('RESOURCE')) return 'RESOURCE'
  if (t === 'REQUEST' || t === 'ALLOCATION' || t === 'RELEASE') return 'REQUEST_ALLOC'
  if (t === 'REJECTION') return 'REJECTION'
  if (t === 'DEADLOCK' || t === 'SAFETY_CHANGE') return 'DEADLOCK_SAFETY'
  if (t === 'RECOVERY' || t === 'CHECKPOINT' || t === 'ROLLBACK') return 'RECOVERY_CHECKPOINT'
  return 'PROCESS'
}

export function filterTimelineEvents(
  events: SimulationEvent[],
  search: string,
  category: EventCategoryFilter,
  severity: 'ALL' | 'info' | 'success' | 'warning' | 'error',
): SimulationEvent[] {
  const q = search.trim().toLowerCase()
  return events.filter((ev) => {
    if (category !== 'ALL' && mapEventCategory(ev) !== category) return false
    if (severity !== 'ALL' && ev.severity !== severity) return false
    if (!q) return true
    const pid = String(ev.metadata?.process_id ?? '').toLowerCase()
    const rid = String(ev.metadata?.resource_id ?? '').toLowerCase()
    return (
      ev.message.toLowerCase().includes(q) ||
      ev.type.toLowerCase().includes(q) ||
      pid.includes(q) ||
      rid.includes(q)
    )
  })
}

export function triggerBlobDownload(filename: string, blob: Blob): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
