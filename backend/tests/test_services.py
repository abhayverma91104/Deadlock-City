from __future__ import annotations

import json
import pytest

from app.engine.bridge import EngineBridge
from app.services.export_service import ExportService
from app.services.graph_builder import build_rag_graph
from app.services.session_manager import SessionManager, SessionNotFoundError
from app.websocket.hub import WebSocketHub


@pytest.mark.asyncio
async def test_session_lifecycle_isolation_and_graph_builder():
    bridge = EngineBridge()
    hub = WebSocketHub()
    mgr = SessionManager(bridge, hub)

    s1 = await mgr.create_session(preset="single_instance_deadlock", seed=42)
    s2 = await mgr.create_session(preset="classic_banker_safe", seed=99)

    assert s1["session_id"] != s2["session_id"]
    assert s1["state"]["safety_status"] == "DEADLOCKED"
    assert s2["state"]["safety_status"] == "SAFE"

    rag1 = build_rag_graph(s1["state"])
    assert rag1["deadlock_detected"] is True
    assert set(rag1["deadlocked_processes"]) == {"P0", "P1"}
    assert len(rag1["edges"]) == 4  # 2 alloc + 2 req

    # Step session 2 independently
    stepped = await mgr.execute_session_command(s2["session_id"], "step_simulation")
    assert stepped["state"]["tick"] == 1
    # Session 1 untouched
    s1_again = await mgr.get_state(s1["session_id"])
    assert s1_again["state"]["tick"] == 0

    # Export JSON and CSV
    json_bytes = ExportService.to_json_bytes(s2["session_id"], stepped["state"])
    parsed = json.loads(json_bytes.decode("utf-8"))
    assert parsed["analytics"]["kpis"]["total_processes"] == 5

    csv_text = ExportService.to_csv_bytes(s2["session_id"], stepped["state"]).decode("utf-8")
    assert "session_id,tick,utilization_pct" in csv_text
    assert s2["session_id"] in csv_text

    with pytest.raises(SessionNotFoundError):
        await mgr.get_state("sim_missing")

    await mgr.shutdown()


@pytest.mark.asyncio
async def test_session_manager_lru_idle_eviction_and_active_protection():
    from app.services.session_manager import SessionLimitError

    bridge = EngineBridge()
    hub = WebSocketHub()
    mgr = SessionManager(bridge, hub, max_sessions=2)

    s1 = await mgr.create_session(preset="normal_workload", seed=1)
    s2 = await mgr.create_session(preset="normal_workload", seed=2)
    assert mgr.active_session_count == 2

    # Touch s1 so s2 becomes least-recently-used idle session
    await mgr.get_state(s1["session_id"])

    # Creating s3 evicts idle s2, keeping s1 intact
    s3 = await mgr.create_session(preset="normal_workload", seed=3)
    assert mgr.active_session_count == 2
    assert (await mgr.get_state(s1["session_id"]))["session_id"] == s1["session_id"]
    with pytest.raises(SessionNotFoundError):
        await mgr.get_state(s2["session_id"])

    # Mark both remaining sessions running -> capacity refuses new session instead of killing active runs
    await mgr.start_session(s1["session_id"], speed=1.0)
    await mgr.start_session(s3["session_id"], speed=1.0)
    with pytest.raises(SessionLimitError):
        await mgr.create_session(preset="normal_workload", seed=4)

    await mgr.shutdown()


@pytest.mark.asyncio
async def test_export_service_reports_telemetry_retention_metadata():
    bridge = EngineBridge()
    hub = WebSocketHub()
    mgr = SessionManager(bridge, hub)
    s = await mgr.create_session(preset="normal_workload", seed=42)
    state = dict(s["state"])
    state["total_metric_samples_recorded"] = 310
    state["total_events_recorded"] = 250

    summary = ExportService.build_analytics_summary(s["session_id"], state)
    ret = summary["telemetry_retention"]
    assert ret["metrics_window_cap"] == 240
    assert ret["events_window_cap"] == 200
    assert ret["total_metric_samples_recorded"] == 310
    assert ret["retained_metric_samples"] == len(state["metrics_history"])
    assert ret["discarded_metric_samples"] == 310 - len(state["metrics_history"])
    assert ret["total_events_recorded"] == 250
    assert ret["retained_events"] == len(state["events"])
    assert ret["discarded_events"] == 250 - len(state["events"])

    csv_text = ExportService.to_csv_bytes(s["session_id"], state, scope="metrics").decode("utf-8")
    assert "total_metric_samples_recorded" in csv_text.splitlines()[0]
    await mgr.shutdown()
