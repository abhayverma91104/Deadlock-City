import type {
  DeadlockReport,
  ProcessEntity,
  ProcessState,
  ResourceEntity,
  ResourceStatus,
  SafetyStatus,
} from '../types/simulation'
import type { GraphicsQuality, SelectedEntity } from '../stores/useSimulationStore'

export interface ConduitLink {
  id: string
  kind: 'allocation' | 'request'
  processId: string
  resourceId: string
  units: number
  from: [number, number, number]
  to: [number, number, number]
  isDeadlocked: boolean
  isCycleOnly: boolean
}

export interface QualityProfile {
  dpr: [number, number]
  shadows: boolean
  shadowMapSize: number
  backgroundBlockCount: number
  showRooftopLabels: boolean
  animatePackets: boolean
}

export const QUALITY_PROFILES: Record<GraphicsQuality, QualityProfile> = {
  low: {
    dpr: [1, 1],
    shadows: false,
    shadowMapSize: 512,
    backgroundBlockCount: 36,
    showRooftopLabels: false,
    animatePackets: false,
  },
  medium: {
    dpr: [1, 1.5],
    shadows: true,
    shadowMapSize: 1024,
    backgroundBlockCount: 72,
    showRooftopLabels: true,
    animatePackets: true,
  },
  high: {
    dpr: [1, 2],
    shadows: true,
    shadowMapSize: 2048,
    backgroundBlockCount: 108,
    showRooftopLabels: true,
    animatePackets: true,
  },
}

export function getProcessColorScheme(state: ProcessState, isDeadlocked: boolean): {
  primary: string
  emissive: string
  body: string
  badge: string
} {
  if (isDeadlocked) {
    return {
      primary: '#ef4444',
      emissive: '#dc2626',
      body: '#2a1220',
      badge: 'DEADLOCKED',
    }
  }
  switch (state) {
    case 'NEW':
      return { primary: '#818cf8', emissive: '#6366f1', body: '#131d3a', badge: 'NEW' }
    case 'READY':
      return { primary: '#22d3ee', emissive: '#0891b2', body: '#15223e', badge: 'READY' }
    case 'RUNNING':
      return { primary: '#ec4899', emissive: '#db2777', body: '#271738', badge: 'RUNNING' }
    case 'WAITING':
      return { primary: '#f59e0b', emissive: '#d97706', body: '#231f2e', badge: 'WAITING' }
    case 'BLOCKED':
      return { primary: '#fb7185', emissive: '#e11d48', body: '#281526', badge: 'BLOCKED' }
    case 'TERMINATED':
      return { primary: '#475569', emissive: '#0f172a', body: '#0f1522', badge: 'OFFLINE' }
  }
}

export function getResourceColorScheme(status: ResourceStatus, isInvolvedInDeadlock: boolean): {
  accent: string
  emissive: string
} {
  if (isInvolvedInDeadlock) {
    return { accent: '#ef4444', emissive: '#b91c1c' }
  }
  switch (status) {
    case 'AVAILABLE':
      return { accent: '#10b981', emissive: '#059669' }
    case 'ALLOCATED':
      return { accent: '#22d3ee', emissive: '#0284c7' }
    case 'REQUESTED':
      return { accent: '#f59e0b', emissive: '#d97706' }
    case 'UNAVAILABLE':
      return { accent: '#f43f5e', emissive: '#be123c' }
  }
}

export function getSafetyRingColor(status: SafetyStatus): string {
  switch (status) {
    case 'SAFE':
      return '#10b981'
    case 'UNSAFE':
      return '#f59e0b'
    case 'DEADLOCKED':
      return '#ef4444'
  }
}

export function computeBuildingHeight(burstTime: number, state: ProcessState): number {
  if (state === 'TERMINATED') return 1.5
  return Math.min(5.8, Math.max(2.4, 2.0 + burstTime * 0.34))
}

export function buildConduitLinks(
  processes: ProcessEntity[],
  resources: ResourceEntity[],
  deadlockReport: DeadlockReport,
): ConduitLink[] {
  const resMap = new Map<string, ResourceEntity>()
  for (const r of resources) resMap.set(r.id, r)

  const deadlockedSet = new Set(deadlockReport.deadlocked_processes)
  const involvedResSet = new Set(deadlockReport.involved_resources)

  // Directed cycle edge pairs from RAG cycles (for distinguishing cycle-without-deadlock)
  const cyclePairs = new Set<string>()
  for (const cyc of deadlockReport.cycles) {
    for (let i = 0; i < cyc.length; i += 1) {
      const a = cyc[i]
      const b = cyc[(i + 1) % cyc.length]
      if (a && b) cyclePairs.add(`${a}->${b}`)
    }
  }

  const links: ConduitLink[] = []

  for (const proc of processes) {
    if (proc.state === 'TERMINATED') continue
    const px = proc.city_position.x
    const pz = proc.city_position.z

    for (const [rid, qty] of Object.entries(proc.allocated)) {
      if (qty <= 0) continue
      const res = resMap.get(rid)
      if (!res) continue
      const isDead = deadlockedSet.has(proc.id) && involvedResSet.has(rid)
      const inCycle = cyclePairs.has(`${rid}->${proc.id}`)
      links.push({
        id: `alloc_${rid}_${proc.id}`,
        kind: 'allocation',
        processId: proc.id,
        resourceId: rid,
        units: qty,
        from: [res.city_position.x, 0.75, res.city_position.z],
        to: [px, 0.75, pz],
        isDeadlocked: isDead,
        isCycleOnly: !deadlockReport.detected && inCycle,
      })
    }

    for (const [rid, qty] of Object.entries(proc.pending_request)) {
      if (qty <= 0) continue
      const res = resMap.get(rid)
      if (!res) continue
      const isDead = deadlockedSet.has(proc.id) && involvedResSet.has(rid)
      const inCycle = cyclePairs.has(`${proc.id}->${rid}`)
      links.push({
        id: `req_${proc.id}_${rid}`,
        kind: 'request',
        processId: proc.id,
        resourceId: rid,
        units: qty,
        from: [px, 1.15, pz],
        to: [res.city_position.x, 1.15, res.city_position.z],
        isDeadlocked: isDead,
        isCycleOnly: !deadlockReport.detected && inCycle,
      })
    }
  }

  return links
}

export function resolveEntityPosition(
  entity: SelectedEntity,
  processes: ProcessEntity[],
  resources: ResourceEntity[],
): [number, number, number] | null {
  if (!entity) return null
  if (entity.kind === 'process') {
    const p = processes.find((item) => item.id === entity.id)
    return p ? [p.city_position.x, 0, p.city_position.z] : null
  }
  const r = resources.find((item) => item.id === entity.id)
  return r ? [r.city_position.x, 0, r.city_position.z] : null
}

export function detectWebGLSupport(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    return Boolean(gl)
  } catch {
    return false
  }
}
