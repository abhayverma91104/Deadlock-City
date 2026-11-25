from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


ProcessStateLiteral = Literal["NEW", "READY", "RUNNING", "WAITING", "BLOCKED", "TERMINATED"]
ResourceCategoryLiteral = Literal["IO", "LOCK", "COMPUTE", "MEMORY", "STORAGE"]
ResourceStatusLiteral = Literal["AVAILABLE", "ALLOCATED", "REQUESTED", "UNAVAILABLE"]
SafetyStatusLiteral = Literal["SAFE", "UNSAFE", "DEADLOCKED"]
SimStatusLiteral = Literal["IDLE", "RUNNING", "PAUSED"]


class ErrorDetail(BaseModel):
    code: str
    message: str
    details: Dict[str, Any] = Field(default_factory=dict)


class ErrorResponse(BaseModel):
    error: ErrorDetail


class CityPositionModel(BaseModel):
    x: float
    y: float
    z: float
    plot_id: str


class ProcessModel(BaseModel):
    id: str
    name: str
    arrival_time: int = Field(ge=0)
    burst_time: int = Field(ge=1)
    remaining_time: int = Field(ge=0)
    priority: int = Field(ge=1, le=10)
    state: ProcessStateLiteral
    max_demand: Dict[str, int] = Field(default_factory=dict)
    allocated: Dict[str, int] = Field(default_factory=dict)
    need: Dict[str, int] = Field(default_factory=dict)
    pending_request: Dict[str, int] = Field(default_factory=dict)
    city_position: CityPositionModel
    termination_cost: int = Field(ge=1)
    waiting_ticks: int = Field(default=0, ge=0)
    preemption_count: int = Field(default=0, ge=0)


class ResourceTypeModel(BaseModel):
    id: str
    name: str
    category: ResourceCategoryLiteral
    total_instances: int = Field(ge=1)
    available_instances: int = Field(ge=0)
    allocated_instances: int = Field(ge=0)
    preemptible: bool
    status: ResourceStatusLiteral
    city_position: CityPositionModel


class DetectionStepModel(BaseModel):
    step_index: int
    work_before: Dict[str, int] = Field(default_factory=dict)
    work_after: Dict[str, int] = Field(default_factory=dict)
    selected_process: Optional[str] = None
    finish_snapshot: Dict[str, bool] = Field(default_factory=dict)
    note: str = ""


class WaitForEdgeModel(BaseModel):
    from_process: str = Field(alias="from")
    to_process: str = Field(alias="to")
    resource_id: str

    model_config = {"populate_by_name": True}


class DeadlockReportModel(BaseModel):
    detected: bool
    has_cycle_in_rag: bool = False
    deadlocked_processes: List[str] = Field(default_factory=list)
    involved_resources: List[str] = Field(default_factory=list)
    cycles: List[List[str]] = Field(default_factory=list)
    wait_for_edges: List[Dict[str, str]] = Field(default_factory=list)
    steps: List[DetectionStepModel] = Field(default_factory=list)
    explanation: str = ""


class BankerReportModel(BaseModel):
    is_safe: bool
    safe_sequence: List[str] = Field(default_factory=list)
    steps: List[DetectionStepModel] = Field(default_factory=list)
    explanation: str = ""


class SimulationEventModel(BaseModel):
    id: str
    tick: int
    type: str
    severity: Literal["info", "success", "warning", "error"]
    message: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class MetricPointModel(BaseModel):
    tick: int
    utilization_pct: float
    active_count: int
    blocked_count: int
    deadlocked_count: int
    allocation_count: int
    available_count: int = 0
    waiting_count: int = 0
    completed_count: int = 0
    terminated_count: int = 0
    pending_request_units: int = 0
    deadlock_count: int = 0
    recovery_count: int = 0
    safety_status: SafetyStatusLiteral = "SAFE"
    recorded_at: Optional[str] = None


class SimulationStateModel(BaseModel):
    tick: int = Field(ge=0)
    seed: int
    preset: Optional[str] = None
    status: SimStatusLiteral
    safety_status: SafetyStatusLiteral
    processes: List[ProcessModel] = Field(default_factory=list)
    resources: List[ResourceTypeModel] = Field(default_factory=list)
    deadlock_report: DeadlockReportModel
    banker_report: BankerReportModel
    deadlock_count: int = Field(ge=0)
    recovery_count: int = Field(ge=0)
    recovery_terminated_count: int = Field(default=0, ge=0)
    preemption_count: int = Field(ge=0)
    completed_count: int = Field(default=0, ge=0)
    granted_request_count: int = Field(default=0, ge=0)
    rejected_request_count: int = Field(default=0, ge=0)
    events: List[SimulationEventModel] = Field(default_factory=list)
    metrics_history: List[MetricPointModel] = Field(default_factory=list)
    checkpoints: List[Dict[str, Any]] = Field(default_factory=list)


class SimulationEnvelope(BaseModel):
    session_id: str
    state: Dict[str, Any]
    result: Optional[Dict[str, Any]] = None


class HealthResponse(BaseModel):
    status: str
    engine_available: bool
    engine_version: Optional[str] = None
    active_sessions: int


# --- Request Payloads ---

class CreateSimulationRequest(BaseModel):
    preset: Optional[str] = None
    seed: int = Field(default=42, ge=0)
    speed: float = Field(default=1.0, ge=0.25, le=4.0)


class StartSimulationRequest(BaseModel):
    speed: Optional[float] = Field(default=None, ge=0.25, le=4.0)


class ResetSimulationRequest(BaseModel):
    preset: Optional[str] = None
    seed: Optional[int] = Field(default=None, ge=0)


class RandomWorkloadRequest(BaseModel):
    process_count: int = Field(default=5, ge=2, le=12)
    resource_count: int = Field(default=3, ge=2, le=6)
    seed: int = Field(default=42, ge=0)


class ProcessCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=64)
    arrival_time: Optional[int] = Field(default=None, ge=0)
    burst_time: int = Field(default=5, ge=1, le=500)
    priority: int = Field(default=5, ge=1, le=10)
    max_demand: Dict[str, int] = Field(default_factory=dict)
    termination_cost: int = Field(default=3, ge=1, le=100)


class ResourceCreateRequest(BaseModel):
    id: Optional[str] = None
    name: str = Field(min_length=1, max_length=64)
    category: ResourceCategoryLiteral = "COMPUTE"
    total_instances: int = Field(ge=1, le=64)
    preemptible: bool = False


class ModifyResourceRequest(BaseModel):
    total_instances: Optional[int] = Field(default=None, ge=1, le=64)
    preemptible: Optional[bool] = None


class ResourceRequestPayload(BaseModel):
    process_id: str = Field(min_length=1)
    request: Dict[str, int]
    use_banker: bool = True


class ResourceReleasePayload(BaseModel):
    process_id: str = Field(min_length=1)
    release: Dict[str, int]


class BankerCheckRequest(BaseModel):
    process_id: Optional[str] = None
    hypothetical_request: Optional[Dict[str, int]] = None


class RecoveryRequestModel(BaseModel):
    strategy: Literal["terminate_all", "terminate_victim", "preempt_resource", "rollback"]
    victim_criteria: Literal[
        "lowest_priority", "lowest_cost", "least_allocated", "lowest_remaining_work"
    ] = "lowest_cost"
    target_process_id: Optional[str] = None
    target_resource_id: Optional[str] = None
    checkpoint_index: Optional[int] = Field(default=None, ge=0)


class ScheduleInputProcessModel(BaseModel):
    id: str = Field(min_length=1)
    name: Optional[str] = None
    arrival_time: int = Field(default=0, ge=0)
    burst_time: int = Field(ge=1, le=1000)
    priority: int = Field(default=5, ge=1, le=10)


class SchedulingCompareRequest(BaseModel):
    session_id: Optional[str] = None
    quantum: int = Field(default=2, ge=1, le=100)
    processes: Optional[List[ScheduleInputProcessModel]] = None


class SyncRunRequest(BaseModel):
    scenario: Literal["producer_consumer", "readers_writers", "dining_philosophers"] = "producer_consumer"
    mode: Literal["safe", "unsafe"] = "safe"
    iterations: int = Field(default=10, ge=1, le=50)
    buffer_size: int = Field(default=4, ge=1, le=32)
    seed: int = Field(default=42, ge=0)


class ExperimentRunRequest(BaseModel):
    session_id: str = Field(min_length=1)
    preset: str = Field(min_length=1)
    seed: int = Field(default=42, ge=0)


class ExperimentCompareRequest(BaseModel):
    mode: Literal["avoidance", "recovery", "scheduling", "synchronization"]
    preset: str = Field(default="classic_banker_safe", min_length=1)
    seed: int = Field(default=42, ge=0)
    process_id: Optional[str] = None
    request_vector: Optional[Dict[str, int]] = None
    steps_after: int = Field(default=3, ge=0, le=20)
    quantum: int = Field(default=2, ge=1, le=50)
    processes: Optional[List[ScheduleInputProcessModel]] = None
    sync_scenario: Literal["producer_consumer", "readers_writers", "dining_philosophers"] = "dining_philosophers"
    sync_iterations: int = Field(default=8, ge=1, le=40)
    sync_buffer_size: int = Field(default=4, ge=1, le=16)


class ExperimentExportRequest(BaseModel):
    kind: Literal["comparison", "scheduling", "synchronization"]
    format: Literal["csv", "json"] = "csv"
    title: str = Field(default="deadlock-city-experiment", min_length=1, max_length=120)
    data: Dict[str, Any]
