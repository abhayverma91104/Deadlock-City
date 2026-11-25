from __future__ import annotations

import re
from typing import Any, Dict, Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.dependencies import get_bridge, get_session_manager
from app.engine.bridge import EngineBridge, EngineBridgeError
from app.schemas import (
    ExperimentCompareRequest,
    ExperimentExportRequest,
    ExperimentRunRequest,
    SchedulingCompareRequest,
    SimulationEnvelope,
    SyncRunRequest,
)
from app.services.export_service import ExportService
from app.services.session_manager import SessionManager

router = APIRouter(prefix="/api", tags=["labs-and-analytics"])


def _safe_filename(raw: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw).strip("-")
    return cleaned or "deadlock-city-experiment"


@router.post("/scheduling/compare")
async def compare_cpu_scheduling(
    body: SchedulingCompareRequest,
    bridge: EngineBridge = Depends(get_bridge),
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    processes_payload: list[Dict[str, Any]] = []
    if body.processes:
        for p in body.processes:
            processes_payload.append({
                "id": p.id,
                "name": p.name or p.id,
                "arrival_time": p.arrival_time,
                "burst_time": p.burst_time,
                "priority": p.priority,
            })
    elif body.session_id:
        env = await sessions.get_state(body.session_id)
        for p in env["state"].get("processes", []):
            processes_payload.append({
                "id": p["id"],
                "name": p["name"],
                "arrival_time": p["arrival_time"],
                "burst_time": max(1, p["burst_time"]),
                "priority": p["priority"],
            })
    else:
        raise HTTPException(
            status_code=422,
            detail="Either 'processes' list or 'session_id' must be provided.",
        )

    if not processes_payload:
        raise HTTPException(
            status_code=400,
            detail="No processes available to schedule.",
        )

    resp = await bridge.execute(
        "compare_scheduling",
        payload={"quantum": body.quantum, "processes": processes_payload},
    )
    return resp["result"]


@router.post("/synchronization/run")
async def run_synchronization_experiment(
    body: SyncRunRequest,
    bridge: EngineBridge = Depends(get_bridge),
) -> Dict[str, Any]:
    resp = await bridge.execute("run_synchronization", payload=body.model_dump())
    return resp["result"]


@router.get("/analytics/{session_id}")
async def get_analytics(
    session_id: str,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    env = await sessions.get_state(session_id)
    return ExportService.build_analytics_summary(session_id, env["state"])


@router.get("/analytics/{session_id}/export")
async def export_analytics(
    session_id: str,
    format: Literal["json", "csv"] = Query(default="json"),
    scope: Literal["snapshot", "metrics", "events"] = Query(default="metrics"),
    sessions: SessionManager = Depends(get_session_manager),
) -> Response:
    env = await sessions.get_state(session_id)
    if format == "csv":
        csv_scope: Literal["metrics", "events"] = "events" if scope == "events" else "metrics"
        data = ExportService.to_csv_bytes(session_id, env["state"], scope=csv_scope)
        suffix = "events" if csv_scope == "events" else "metrics"
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="deadlock-city-{session_id}-{suffix}.csv"'},
        )
    data = ExportService.to_json_bytes(session_id, env["state"])
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="deadlock-city-{session_id}-snapshot.json"'},
    )


@router.get("/experiments/presets")
async def list_experiment_presets(
    bridge: EngineBridge = Depends(get_bridge),
) -> Dict[str, Any]:
    resp = await bridge.execute("list_presets", payload={})
    return resp["result"]


@router.post("/experiments/run", response_model=SimulationEnvelope)
async def run_experiment_preset(
    body: ExperimentRunRequest,
    sessions: SessionManager = Depends(get_session_manager),
) -> Dict[str, Any]:
    return await sessions.run_experiment(body.session_id, preset=body.preset, seed=body.seed)


@router.post("/experiments/compare")
async def compare_experiments(
    body: ExperimentCompareRequest,
    bridge: EngineBridge = Depends(get_bridge),
) -> Dict[str, Any]:
    """Run isolated deterministic C++ comparative experiments without mutating any active session."""
    if body.mode == "scheduling":
        proc_list = (
            [
                {
                    "id": p.id,
                    "name": p.name or p.id,
                    "arrival_time": p.arrival_time,
                    "burst_time": p.burst_time,
                    "priority": p.priority,
                }
                for p in body.processes
            ]
            if body.processes
            else [
                {"id": "P1", "name": "KernelBoot", "arrival_time": 0, "burst_time": 6, "priority": 2},
                {"id": "P2", "name": "GridSync", "arrival_time": 1, "burst_time": 3, "priority": 1},
                {"id": "P3", "name": "Telemetry", "arrival_time": 2, "burst_time": 2, "priority": 4},
                {"id": "P4", "name": "BatchAudit", "arrival_time": 4, "burst_time": 4, "priority": 3},
            ]
        )
        sched = await bridge.execute("compare_scheduling", payload={"quantum": body.quantum, "processes": proc_list})
        comparisons = sched["result"]["comparisons"]
        arms = [
            {
                "label": item["algorithm"],
                "safety_status": "N/A",
                "tick": item["total_time"],
                "utilization_pct": item["cpu_utilization_pct"],
                "deadlock_count": 0,
                "recovery_count": 0,
                "primary_metric": f"Avg WT {item['avg_waiting_time']:.2f} / Avg TAT {item['avg_turnaround_time']:.2f}",
                "summary": f"CS={item['context_switches']}, Avg Resp={item['avg_response_time']:.2f}",
                "raw": item,
            }
            for item in comparisons
        ]
        return {
            "mode": "scheduling",
            "preset": body.preset,
            "seed": body.seed,
            "parameters": {"quantum": body.quantum, "process_count": len(proc_list)},
            "expectation": "SRTF minimizes average waiting time on overlapping arrivals; RR bounds response time via time quantum.",
            "arms": arms,
            "comparisons": comparisons,
        }

    if body.mode == "synchronization":
        safe_resp = await bridge.execute(
            "run_synchronization",
            payload={
                "scenario": body.sync_scenario,
                "mode": "safe",
                "iterations": body.sync_iterations,
                "buffer_size": body.sync_buffer_size,
                "seed": body.seed,
            },
        )
        unsafe_resp = await bridge.execute(
            "run_synchronization",
            payload={
                "scenario": body.sync_scenario,
                "mode": "unsafe",
                "iterations": body.sync_iterations,
                "buffer_size": body.sync_buffer_size,
                "seed": body.seed,
            },
        )
        safe_r = safe_resp["result"]
        unsafe_r = unsafe_resp["result"]
        arms = [
            {
                "label": "Safe (Synchronized)",
                "safety_status": "CLEAN" if safe_r["completed_cleanly"] else "VIOLATION",
                "tick": len(safe_r.get("events") or []),
                "utilization_pct": 100.0 if safe_r["completed_cleanly"] else 0.0,
                "deadlock_count": 1 if safe_r.get("race_or_deadlock_detected") else 0,
                "recovery_count": 0,
                "primary_metric": f"Conflicts {safe_r['conflicts']} / Overflows {safe_r['overflows']} / Meals {safe_r['completed_meals']}",
                "summary": safe_r["summary"],
                "raw": safe_r,
            },
            {
                "label": "Unsafe (Unsynchronized)",
                "safety_status": "CLEAN" if unsafe_r["completed_cleanly"] else "RACE / DEADLOCK",
                "tick": len(unsafe_r.get("events") or []),
                "utilization_pct": 100.0 if unsafe_r["completed_cleanly"] else 0.0,
                "deadlock_count": 1 if unsafe_r.get("race_or_deadlock_detected") else 0,
                "recovery_count": 0,
                "primary_metric": f"Conflicts {unsafe_r['conflicts']} / Overflows {unsafe_r['overflows']} / Meals {unsafe_r['completed_meals']}",
                "summary": unsafe_r["summary"],
                "raw": unsafe_r,
            },
        ]
        return {
            "mode": "synchronization",
            "preset": body.sync_scenario,
            "seed": body.seed,
            "parameters": {
                "scenario": body.sync_scenario,
                "iterations": body.sync_iterations,
                "buffer_size": body.sync_buffer_size,
            },
            "expectation": "Safe mode uses C++ mutex/condition variables or asymmetric lock ordering to eliminate races/deadlocks.",
            "arms": arms,
        }

    # Stateful OS workload comparisons (avoidance or recovery) starting from identical C++ preset+seed
    init_resp = await bridge.execute("load_preset", payload={"preset": body.preset, "seed": body.seed})
    base_state = init_resp["state"]
    initial_summary = ExportService.build_analytics_summary("isolated_init", base_state)

    if body.mode == "avoidance":
        if body.preset == "classic_banker_safe" and not body.process_id and not body.request_vector:
            target_pid = "P4"
            req_vec = {"R0": 3, "R1": 3, "R2": 0}
        else:
            target_pid = body.process_id or (base_state["processes"][0]["id"] if base_state.get("processes") else "P0")
            req_vec = body.request_vector
            if not req_vec:
                target_proc = next((p for p in base_state.get("processes", []) if p["id"] == target_pid), None)
                avail_map = {r["id"]: int(r.get("available_instances", 0)) for r in base_state.get("resources", [])}
                if target_proc:
                    req_vec = {
                        rid: min(int(qty), avail_map.get(rid, 0))
                        for rid, qty in (target_proc.get("need") or {}).items()
                        if min(int(qty), avail_map.get(rid, 0)) > 0
                    }
                if not req_vec and base_state.get("resources"):
                    req_vec = {base_state["resources"][0]["id"]: 1}

        async def run_avoidance_arm(use_banker: bool, label: str) -> Dict[str, Any]:
            st = base_state
            granted = False
            waited = False
            reason = ""
            try:
                req_resp = await bridge.execute(
                    "request_resources",
                    state=st,
                    payload={"process_id": target_pid, "request": req_vec, "use_banker": use_banker},
                )
                st = req_resp["state"] or st
                granted = bool((req_resp.get("result") or {}).get("granted"))
                waited = bool((req_resp.get("result") or {}).get("waited"))
                reason = str((req_resp.get("result") or {}).get("reason", ""))
            except EngineBridgeError as exc:
                reason = f"{exc.code}: {exc.message}"
                if exc.state is not None:
                    st = exc.state

            for _ in range(body.steps_after):
                if st.get("safety_status") == "DEADLOCKED":
                    break
                step_resp = await bridge.execute("step_simulation", state=st, payload={})
                st = step_resp["state"]

            summary = ExportService.build_analytics_summary(f"isolated_{label}", st)
            kpis = summary["kpis"]
            return {
                "label": label,
                "safety_status": st["safety_status"],
                "tick": st["tick"],
                "utilization_pct": kpis["resource_utilization_pct"],
                "deadlock_count": kpis["deadlock_count"],
                "recovery_count": kpis["recovery_count"],
                "primary_metric": f"Granted={granted}, Waited={waited}, Rejected={kpis['rejected_request_count']}",
                "summary": reason or f"Completed {body.steps_after} post-request tick(s) in {st['safety_status']} state.",
                "kpis": kpis,
                "events": st.get("events", []),
            }

        arm_banker_on = await run_avoidance_arm(True, "Banker's Avoidance ON")
        arm_banker_off = await run_avoidance_arm(False, "Banker's Avoidance OFF")
        return {
            "mode": "avoidance",
            "preset": body.preset,
            "seed": body.seed,
            "parameters": {
                "process_id": target_pid,
                "request_vector": req_vec,
                "steps_after": body.steps_after,
            },
            "initial_kpis": initial_summary["kpis"],
            "initial_safety_status": base_state["safety_status"],
            "expectation": "With Banker ON, unsafe requests are rejected before allocation to preserve a safe sequence; with Banker OFF, immediate allocation can enter UNSAFE or DEADLOCKED states.",
            "arms": [arm_banker_on, arm_banker_off],
        }

    # mode == "recovery"
    strategies = [
        ("Terminate All Deadlocked", {"strategy": "terminate_all", "victim_criteria": "lowest_cost"}),
        ("Terminate Lowest-Cost Victim", {"strategy": "terminate_victim", "victim_criteria": "lowest_cost"}),
        ("Preempt Resource", {"strategy": "preempt_resource", "victim_criteria": "lowest_cost"}),
        ("Checkpoint Rollback (#0)", {"strategy": "rollback", "checkpoint_index": 0}),
    ]
    arms = []
    for label, strat_payload in strategies:
        st = base_state
        ok = False
        msg = ""
        terminated: list[str] = []
        preempted: list[str] = []
        unblocked: list[str] = []
        try:
            rresp = await bridge.execute("recover_deadlock", state=st, payload=strat_payload)
            st = rresp["state"] or st
            res = rresp.get("result") or {}
            ok = bool(res.get("ok"))
            msg = str(res.get("message", ""))
            terminated = list(res.get("terminated_processes") or [])
            preempted = list(res.get("preempted_resources") or [])
            unblocked = list(res.get("unblocked_processes") or [])
        except EngineBridgeError as exc:
            msg = f"{exc.code}: {exc.message}"
            if exc.state is not None:
                st = exc.state

        summary = ExportService.build_analytics_summary(f"isolated_{label}", st)
        kpis = summary["kpis"]
        arms.append({
            "label": label,
            "ok": ok,
            "safety_status": st["safety_status"],
            "tick": st["tick"],
            "utilization_pct": kpis["resource_utilization_pct"],
            "deadlock_count": kpis["deadlock_count"],
            "recovery_count": kpis["recovery_count"],
            "primary_metric": (
                f"Term={','.join(terminated) or '0'} | Preempt={','.join(preempted) or '0'} | Unblocked={len(unblocked)}"
                if ok
                else msg
            ),
            "summary": msg,
            "kpis": kpis,
        })

    return {
        "mode": "recovery",
        "preset": body.preset,
        "seed": body.seed,
        "parameters": {"strategies_tested": len(strategies)},
        "initial_kpis": initial_summary["kpis"],
        "initial_safety_status": base_state["safety_status"],
        "expectation": "Terminate All removes every cyclic process; Terminate Victim minimizes lost work via victim criteria; Preempt reclaims preemptible units; Rollback restores the clean checkpoint.",
        "arms": arms,
    }


@router.post("/experiments/export")
async def export_experiment_data(body: ExperimentExportRequest) -> Response:
    fname = _safe_filename(body.title)
    if body.format == "csv":
        data = ExportService.experiment_to_csv_bytes(body.kind, body.title, body.data)
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{fname}-{body.kind}.csv"'},
        )
    data = ExportService.experiment_to_json_bytes(body.kind, body.title, body.data)
    return Response(
        content=data,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{fname}-{body.kind}.json"'},
    )
