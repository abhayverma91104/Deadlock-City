from __future__ import annotations

from typing import Any, Dict
from fastapi import APIRouter, Depends, status

from app.dependencies import get_session_manager
from app.schemas import (
    BankerCheckRequest,
    CreateSimulationRequest,
    ModifyResourceRequest,
    ProcessCreateRequest,
    RandomWorkloadRequest,
    RecoveryRequestModel,
    ResetSimulationRequest,
    ResourceCreateRequest,
    ResourceReleasePayload,
    ResourceRequestPayload,
    SimulationEnvelope,
    StartSimulationRequest,
)
from app.services.graph_builder import build_rag_graph
from app.services.session_manager import SessionManager

router = APIRouter(prefix="/api/simulation", tags=["simulation"])


@router.post("/create", response_model=SimulationEnvelope, status_code=status.HTTP_201_CREATED)
async def create_simulation(
    body: CreateSimulationRequest = CreateSimulationRequest(),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.create_session(preset=body.preset, seed=body.seed, speed=body.speed)


@router.get("/{session_id}/state", response_model=SimulationEnvelope)
async def get_simulation_state(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.get_state(session_id)


@router.post("/{session_id}/start", response_model=SimulationEnvelope)
async def start_simulation(
    session_id: str,
    body: StartSimulationRequest = StartSimulationRequest(),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.start_session(session_id, speed=body.speed)


@router.post("/{session_id}/pause", response_model=SimulationEnvelope)
async def pause_simulation(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.pause_session(session_id)


@router.post("/{session_id}/resume", response_model=SimulationEnvelope)
async def resume_simulation(
    session_id: str,
    body: StartSimulationRequest = StartSimulationRequest(),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.start_session(session_id, speed=body.speed)


@router.post("/{session_id}/stop", response_model=SimulationEnvelope)
async def stop_simulation(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.stop_session(session_id)


@router.post("/{session_id}/step", response_model=SimulationEnvelope)
async def step_simulation(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "step_simulation")


@router.post("/{session_id}/reset", response_model=SimulationEnvelope)
async def reset_simulation(
    session_id: str,
    body: ResetSimulationRequest = ResetSimulationRequest(),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.reset_session(session_id, preset=body.preset, seed=body.seed)


@router.post("/{session_id}/workload/random", response_model=SimulationEnvelope)
async def generate_random_workload(
    session_id: str,
    body: RandomWorkloadRequest,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.load_random_workload(
        session_id,
        process_count=body.process_count,
        resource_count=body.resource_count,
        seed=body.seed,
    )


@router.post("/{session_id}/checkpoint", response_model=SimulationEnvelope)
async def create_checkpoint(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "create_checkpoint")


# --- Processes & Resources ---

@router.post("/{session_id}/process", response_model=SimulationEnvelope, status_code=status.HTTP_201_CREATED)
async def add_process(
    session_id: str,
    body: ProcessCreateRequest,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    return await sessions.execute_session_command(session_id, "add_process", payload)


@router.delete("/{session_id}/process/{pid}", response_model=SimulationEnvelope)
async def terminate_process(
    session_id: str,
    pid: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "remove_process", {"process_id": pid})


@router.post("/{session_id}/process/{pid}/suspend", response_model=SimulationEnvelope)
async def suspend_process(
    session_id: str,
    pid: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "suspend_process", {"process_id": pid})


@router.post("/{session_id}/process/{pid}/resume", response_model=SimulationEnvelope)
async def resume_process(
    session_id: str,
    pid: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "resume_process", {"process_id": pid})


@router.post("/{session_id}/resource", response_model=SimulationEnvelope, status_code=status.HTTP_201_CREATED)
async def add_resource(
    session_id: str,
    body: ResourceCreateRequest,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    return await sessions.execute_session_command(session_id, "add_resource", payload)


@router.patch("/{session_id}/resource/{rid}", response_model=SimulationEnvelope)
async def modify_resource(
    session_id: str,
    rid: str,
    body: ModifyResourceRequest,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    payload["resource_id"] = rid
    return await sessions.execute_session_command(session_id, "modify_resource", payload)


@router.post("/{session_id}/request", response_model=SimulationEnvelope)
async def request_resources(
    session_id: str,
    body: ResourceRequestPayload,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "request_resources", body.model_dump())


@router.post("/{session_id}/release", response_model=SimulationEnvelope)
async def release_resources(
    session_id: str,
    body: ResourceReleasePayload,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "release_resources", body.model_dump())


# --- Graph, Detection, Banker's & Recovery ---

@router.get("/{session_id}/graph")
async def get_resource_allocation_graph(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    env = await sessions.get_state(session_id)
    return {
        "session_id": session_id,
        "graph": build_rag_graph(env["state"]),
        "state": env["state"],
    }


@router.get("/{session_id}/deadlock", response_model=SimulationEnvelope)
async def detect_deadlock(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(session_id, "detect_deadlock")


@router.post("/{session_id}/banker/check", response_model=SimulationEnvelope)
async def check_banker_safety(
    session_id: str,
    body: BankerCheckRequest = BankerCheckRequest(),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    payload = body.model_dump(exclude_none=True)
    return await sessions.execute_session_command(session_id, "check_banker_safety", payload)


@router.post("/{session_id}/recovery", response_model=SimulationEnvelope)
async def recover_deadlock(
    session_id: str,
    body: RecoveryRequestModel,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.execute_session_command(
        session_id,
        "recover_deadlock",
        body.model_dump(exclude_none=True),
    )
