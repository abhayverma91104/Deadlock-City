export type ProcessState =
  | 'NEW'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'BLOCKED'
  | 'TERMINATED'

export type ResourceCategory = 'IO' | 'LOCK' | 'COMPUTE' | 'MEMORY' | 'STORAGE'

export type ResourceStatus = 'AVAILABLE' | 'ALLOCATED' | 'REQUESTED' | 'UNAVAILABLE'

export type SafetyStatus = 'SAFE' | 'UNSAFE' | 'DEADLOCKED'

export type SimStatus = 'IDLE' | 'RUNNING' | 'PAUSED'

export interface CityPosition {
  x: number
  y: number
  z: number
  plot_id: string
}

export interface ProcessEntity {
  id: string
  name: string
  arrival_time: number
  burst_time: number
  remaining_time: number
  priority: number
  state: ProcessState
  max_demand: Record<string, number>
  allocated: Record<string, number>
  need: Record<string, number>
  pending_request: Record<string, number>
  city_position: CityPosition
  termination_cost: number
  waiting_ticks: number
  preemption_count: number
}

export interface ResourceEntity {
  id: string
  name: string
  category: ResourceCategory
  total_instances: number
  available_instances: number
  allocated_instances: number
  preemptible: boolean
  status: ResourceStatus
  city_position: CityPosition
}

export interface DetectionStep {
  step_index: number
  work_before: Record<string, number>
  work_after: Record<string, number>
  selected_process: string | null
  finish_snapshot: Record<string, boolean>
  note: string
}

export interface WaitForEdge {
  from: string
  to: string
  resource_id: string
}

export interface DeadlockReport {
  detected: boolean
  has_cycle_in_rag: boolean
  deadlocked_processes: string[]
  involved_resources: string[]
  cycles: string[][]
  wait_for_edges: WaitForEdge[]
  steps: DetectionStep[]
  explanation: string
}

export interface BankerReport {
  is_safe: boolean
  safe_sequence: string[]
  steps: DetectionStep[]
  explanation: string
}

export interface SimulationEvent {
  id: string
  tick: number
  type: string
  severity: 'info' | 'success' | 'warning' | 'error'
  message: string
  metadata: Record<string, unknown>
  recorded_at?: string
}

export interface MetricPoint {
  tick: number
  utilization_pct: number
  active_count: number
  blocked_count: number
  deadlocked_count: number
  allocation_count: number
  available_count?: number
  waiting_count?: number
  completed_count?: number
  terminated_count?: number
  pending_request_units?: number
  deadlock_count?: number
  recovery_count?: number
  safety_status?: SafetyStatus
  recorded_at?: string
}

export interface SimulationState {
  tick: number
  seed: number
  preset: string | null
  status: SimStatus
  safety_status: SafetyStatus
  processes: ProcessEntity[]
  resources: ResourceEntity[]
  deadlock_report: DeadlockReport
  banker_report: BankerReport
  deadlock_count: number
  recovery_count: number
  recovery_terminated_count?: number
  preemption_count: number
  completed_count?: number
  granted_request_count?: number
  rejected_request_count?: number
  events: SimulationEvent[]
  total_events_recorded?: number
  metrics_history: MetricPoint[]
  total_metric_samples_recorded?: number
  checkpoints?: unknown[]
}

export interface RuntimeMeta {
  is_running: boolean
  speed: number
  seq: number
}

export interface SimulationEnvelope {
  session_id: string
  state: SimulationState
  result?: {
    runtime?: RuntimeMeta
    [key: string]: unknown
  } | null
}

export interface RagProcessNodeData {
  id: string
  name: string
  state: ProcessState
  priority: number
  allocated: Record<string, number>
  pending_request: Record<string, number>
  need: Record<string, number>
  is_deadlocked: boolean
  in_cycle: boolean
}

export interface RagResourceNodeData {
  id: string
  name: string
  category: ResourceCategory
  total_instances: number
  available_instances: number
  allocated_instances: number
  status: ResourceStatus
  is_involved_in_deadlock: boolean
  in_cycle: boolean
}

export interface RagGraphNode {
  id: string
  type: 'process' | 'resource'
  position: { x: number; y: number }
  data: RagProcessNodeData | RagResourceNodeData
}

export interface RagGraphEdge {
  id: string
  source: string
  target: string
  kind: 'allocation' | 'request'
  units: number
  in_cycle: boolean
  is_deadlocked: boolean
  label: string
}

export interface RagGraphPayload {
  nodes: RagGraphNode[]
  edges: RagGraphEdge[]
  has_cycle: boolean
  deadlock_detected: boolean
  deadlocked_processes: string[]
  cycles: string[][]
  wait_for_edges: WaitForEdge[]
}

export interface GraphEndpointResponse {
  session_id: string
  graph: RagGraphPayload
  state: SimulationState
}

export interface BankerCheckResponse {
  would_approve?: boolean
  waited?: boolean
  error_code?: string
  reason?: string
  banker_report?: BankerReport
  is_safe?: boolean
  safe_sequence?: string[]
  steps?: DetectionStep[]
  explanation?: string
}

export interface RecoveryResultPayload {
  ok: boolean
  error_code: string
  message: string
  terminated_processes: string[]
  preempted_resources: string[]
  recovered_units: Record<string, number>
  surviving_processes: string[]
  unblocked_processes: string[]
  restored_checkpoint_index: number | null
}

export type SchedulingAlgorithm = 'FCFS' | 'SJF' | 'SRTF' | 'PRIORITY' | 'RR'

export interface ScheduleInputProcess {
  id: string
  name: string
  arrival_time: number
  burst_time: number
  priority: number
}

export interface GanttSegment {
  process_id: string
  process_name: string
  start_time: number
  end_time: number
}

export interface ProcessScheduleMetrics {
  id: string
  name: string
  arrival_time: number
  burst_time: number
  priority: number
  completion_time: number
  turnaround_time: number
  waiting_time: number
  response_time: number
}

export interface ScheduleResult {
  algorithm: SchedulingAlgorithm
  quantum: number
  gantt: GanttSegment[]
  process_metrics: ProcessScheduleMetrics[]
  avg_waiting_time: number
  avg_turnaround_time: number
  avg_response_time: number
  context_switches: number
  cpu_utilization_pct: number
  total_time: number
}

export interface SyncEvent {
  seq: number
  thread_id: string
  state: string
  action: string
  resource: string
  detail: string
  buffer_occupancy?: number
  buffer_capacity?: number
  active_readers?: number
  active_writers?: number
  fork_owners?: number[]
}

export interface SyncReport {
  scenario: 'producer_consumer' | 'readers_writers' | 'dining_philosophers'
  mode: 'safe' | 'unsafe'
  completed_cleanly: boolean
  race_or_deadlock_detected: boolean
  produced_count: number
  consumed_count: number
  overflows: number
  underflows: number
  conflicts: number
  completed_meals: number
  events: SyncEvent[]
  logs: string[]
  summary: string
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | string
  engine_available: boolean
  engine_version: string | null
  active_sessions: number
}

export interface AnalyticsKpis {
  total_processes: number
  active_processes: number
  completed_processes: number
  waiting_processes: number
  blocked_processes: number
  terminated_processes: number
  deadlocked_processes: number
  total_resource_types: number
  total_resource_instances: number
  available_resource_instances: number
  allocated_instances: number
  resource_utilization_pct: number
  pending_request_units: number
  pending_request_processes: number
  granted_request_count: number
  rejected_request_count: number
  deadlock_count: number
  recovery_count: number
  recovery_terminated_count: number
  preemption_count: number
  avg_waiting_ticks: number
}

export interface AnalyticsSummary {
  session_id: string
  tick: number
  preset: string | null
  seed: number
  safety_status: SafetyStatus
  kpis: AnalyticsKpis
  metrics_history: MetricPoint[]
  events: SimulationEvent[]
  process_state_distribution: Record<ProcessState, number>
}

export interface PresetCatalogItem {
  id: string
  name: string
  category: 'Safe' | 'Unsafe' | 'Deadlock' | 'Contention'
  description: string
  os_concept: string
  initial_process_count: number
  initial_resource_config: Record<string, number>
  expected_behavior: string
  learning_objective: string
  recommended_actions: string[]
  default_seed: number
}

export interface PresetCatalogResponse {
  presets: PresetCatalogItem[]
  random_workload: {
    min_processes: number
    max_processes: number
    min_resources: number
    max_resources: number
    default_seed: number
  }
}

export interface ExperimentComparisonArm {
  label: string
  ok?: boolean
  safety_status: string
  tick: number
  utilization_pct: number
  deadlock_count: number
  recovery_count: number
  primary_metric: string
  summary: string
  kpis?: AnalyticsKpis
  events?: SimulationEvent[]
  raw?: unknown
}

export interface ExperimentComparisonResponse {
  mode: 'avoidance' | 'recovery' | 'scheduling' | 'synchronization'
  preset: string
  seed: number
  parameters: Record<string, unknown>
  initial_kpis?: AnalyticsKpis
  initial_safety_status?: SafetyStatus
  expectation: string
  arms: ExperimentComparisonArm[]
  comparisons?: ScheduleResult[]
}

export type WsConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'

export type WsServerMessage =
  | {
      type: 'STATE_SYNC'
      session_id: string
      state: SimulationState
      runtime?: RuntimeMeta
    }
  | {
      type: 'SIMULATION_EVENT'
      session_id: string
      event: SimulationEvent
    }
  | {
      type: 'ERROR'
      session_id?: string
      error: { code: string; message: string }
    }
  | {
      type: 'PONG'
    }

export type NavTabId =
  | 'city'
  | 'graph'
  | 'detection'
  | 'banker'
  | 'recovery'
  | 'processes'
  | 'scheduling'
  | 'sync'
  | 'analytics'
  | 'docs'

export interface PresetDefinition {
  id: string
  label: string
  category: 'Safe' | 'Unsafe' | 'Deadlock' | 'Contention'
  description: string
}

export const EXPERIMENT_PRESETS: PresetDefinition[] = [
  {
    id: 'normal_workload',
    label: 'Normal Workload',
    category: 'Safe',
    description: 'Balanced 4-process city workload with healthy resource headroom.',
  },
  {
    id: 'classic_banker_safe',
    label: "Classic Banker's Safe",
    category: 'Safe',
    description: 'Textbook 5-process, 3-resource safe state (P1 → P3 → P4 → P0 → P2).',
  },
  {
    id: 'single_instance_deadlock',
    label: 'Single-Instance Deadlock',
    category: 'Deadlock',
    description: 'Classic P0 ↔ P1 circular wait over Printer A and DB Lock B.',
  },
  {
    id: 'multiple_instance_deadlock',
    label: 'Multi-Instance Deadlock',
    category: 'Deadlock',
    description: 'Saturated multi-unit resource pools where neither trainer can finish.',
  },
  {
    id: 'multi_instance_safe_cycle',
    label: 'Multi-Instance Cycle (Safe)',
    category: 'Safe',
    description: 'Demonstrates a RAG cycle that resolves without deadlock via extra units.',
  },
  {
    id: 'unsafe_no_deadlock',
    label: 'Unsafe (No Deadlock)',
    category: 'Unsafe',
    description: 'No safe completion sequence guaranteed, yet zero processes deadlocked.',
  },
  {
    id: 'resource_starvation',
    label: 'Resource Starvation',
    category: 'Contention',
    description: 'Low-priority batch task indefinitely blocked behind high-priority holders.',
  },
  {
    id: 'high_contention',
    label: 'High Contention',
    category: 'Contention',
    description: 'Near-saturated city pools with multiple waiting processes.',
  },
  {
    id: 'recovery_demo',
    label: 'Recovery Experiment',
    category: 'Deadlock',
    description: '3-process circular wait pre-loaded with a clean recovery checkpoint.',
  },
]
