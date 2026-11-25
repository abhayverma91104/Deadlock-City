from __future__ import annotations

import json
import time
from pathlib import Path
from fastapi.testclient import TestClient

from app.engine.bridge import EngineBridge
from app.main import create_app


def test_health_endpoint_ok_and_degraded(tmp_path: Path):
    app = create_app()
    with TestClient(app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert body["engine_available"] is True
        assert body["engine_version"] == "1.0.0"

    broken_app = create_app(bridge=EngineBridge(binary_path=tmp_path / "nonexistent"))
    with TestClient(broken_app) as client:
        res = client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "degraded"
        assert body["engine_available"] is False


def test_simulation_lifecycle_and_session_isolation():
    app = create_app()
    with TestClient(app) as client:
        c1 = client.post("/api/simulation/create", json={"preset": "normal_workload", "seed": 42})
        assert c1.status_code == 201
        sid1 = c1.json()["session_id"]

        c2 = client.post("/api/simulation/create", json={"preset": "single_instance_deadlock", "seed": 7})
        assert c2.status_code == 201
        sid2 = c2.json()["session_id"]
        assert sid1 != sid2

        # Step session 1
        step = client.post(f"/api/simulation/{sid1}/step")
        assert step.status_code == 200
        assert step.json()["state"]["tick"] == 1

        # Start, pause, resume, stop
        st = client.post(f"/api/simulation/{sid1}/start", json={"speed": 4.0})
        assert st.status_code == 200
        assert st.json()["result"]["is_running"] is True
        time.sleep(0.35)
        ps = client.post(f"/api/simulation/{sid1}/pause")
        assert ps.status_code == 200
        assert ps.json()["result"]["is_running"] is False

        rs = client.post(f"/api/simulation/{sid1}/resume", json={"speed": 2.0})
        assert rs.status_code == 200
        assert rs.json()["result"]["is_running"] is True
        sp = client.post(f"/api/simulation/{sid1}/stop")
        assert sp.status_code == 200
        assert sp.json()["result"]["is_running"] is False

        # Reset & random workload
        rst = client.post(f"/api/simulation/{sid1}/reset", json={"preset": "classic_banker_safe", "seed": 42})
        assert rst.status_code == 200
        assert rst.json()["state"]["tick"] == 0
        assert rst.json()["state"]["banker_report"]["safe_sequence"] == ["P1", "P3", "P4", "P0", "P2"]

        rnd = client.post(f"/api/simulation/{sid1}/workload/random", json={"process_count": 4, "resource_count": 3, "seed": 99})
        assert rnd.status_code == 200
        assert len(rnd.json()["state"]["processes"]) == 4

        # Session 2 remained untouched at tick 0
        s2_state = client.get(f"/api/simulation/{sid2}/state")
        assert s2_state.status_code == 200
        assert s2_state.json()["state"]["tick"] == 0

        # Unknown session -> 404 structured error
        missing = client.get("/api/simulation/sim_does_not_exist/state")
        assert missing.status_code == 404
        assert missing.json()["error"]["code"] == "SESSION_NOT_FOUND"


def test_process_resource_banker_detection_and_recovery_flow():
    app = create_app()
    with TestClient(app) as client:
        sid = client.post("/api/simulation/create", json={"preset": "classic_banker_safe", "seed": 42}).json()["session_id"]

        # Add resource and process
        add_res = client.post(f"/api/simulation/{sid}/resource", json={
            "name": "Network Adapter",
            "category": "IO",
            "total_instances": 2,
            "preemptible": True,
        })
        assert add_res.status_code == 201
        new_rid = add_res.json()["result"]["resource"]["id"]

        mod_res = client.patch(f"/api/simulation/{sid}/resource/{new_rid}", json={"total_instances": 3})
        assert mod_res.status_code == 200

        add_proc = client.post(f"/api/simulation/{sid}/process", json={
            "name": "LogShipper",
            "burst_time": 4,
            "priority": 3,
            "max_demand": {"R0": 1, new_rid: 1},
            "termination_cost": 2,
        })
        assert add_proc.status_code == 201
        new_pid = add_proc.json()["result"]["process"]["id"]

        # Suspend & resume process
        assert client.post(f"/api/simulation/{sid}/process/{new_pid}/suspend").json()["state"]["processes"][-1]["state"] == "WAITING"
        assert client.post(f"/api/simulation/{sid}/process/{new_pid}/resume").json()["state"]["processes"][-1]["state"] == "READY"

        # Invalid request exceeding Need -> 400
        bad_req = client.post(f"/api/simulation/{sid}/request", json={
            "process_id": new_pid,
            "request": {"R0": 5},
            "use_banker": True,
        })
        assert bad_req.status_code == 400
        assert bad_req.json()["error"]["code"] == "REQUEST_EXCEEDS_NEED"

        # Valid Banker check (hypothetical + current)
        hyp = client.post(f"/api/simulation/{sid}/banker/check", json={
            "process_id": new_pid,
            "hypothetical_request": {"R0": 1},
        })
        assert hyp.status_code == 200
        assert hyp.json()["result"]["would_approve"] is True

        # Actual request & release
        req_ok = client.post(f"/api/simulation/{sid}/request", json={
            "process_id": new_pid,
            "request": {"R0": 1},
            "use_banker": True,
        })
        assert req_ok.status_code == 200
        assert req_ok.json()["result"]["granted"] is True

        rel_ok = client.post(f"/api/simulation/{sid}/release", json={
            "process_id": new_pid,
            "release": {"R0": 1},
        })
        assert rel_ok.status_code == 200

        del_proc = client.delete(f"/api/simulation/{sid}/process/{new_pid}")
        assert del_proc.status_code == 200

        # Switch to recovery_demo preset via experiments endpoint
        exp = client.post("/api/experiments/run", json={
            "session_id": sid,
            "preset": "recovery_demo",
            "seed": 42,
        })
        assert exp.status_code == 200
        assert exp.json()["state"]["safety_status"] == "DEADLOCKED"

        # Check deadlock & graph endpoints
        dl = client.get(f"/api/simulation/{sid}/deadlock")
        assert dl.status_code == 200
        assert dl.json()["result"]["detected"] is True

        graph = client.get(f"/api/simulation/{sid}/graph")
        assert graph.status_code == 200
        assert graph.json()["graph"]["deadlock_detected"] is True

        # Checkpoint + Recovery
        cp = client.post(f"/api/simulation/{sid}/checkpoint")
        assert cp.status_code == 200

        rec = client.post(f"/api/simulation/{sid}/recovery", json={
            "strategy": "terminate_victim",
            "victim_criteria": "lowest_cost",
        })
        assert rec.status_code == 200
        assert rec.json()["state"]["deadlock_report"]["detected"] is False
        assert rec.json()["state"]["recovery_count"] == 1


def test_scheduling_sync_analytics_and_exports():
    app = create_app()
    with TestClient(app) as client:
        sid = client.post("/api/simulation/create", json={"preset": "normal_workload", "seed": 42}).json()["session_id"]

        # Scheduling with explicit processes
        sched1 = client.post("/api/scheduling/compare", json={
            "quantum": 2,
            "processes": [
                {"id": "P1", "name": "Alpha", "arrival_time": 0, "burst_time": 5, "priority": 2},
                {"id": "P2", "name": "Beta", "arrival_time": 1, "burst_time": 3, "priority": 1},
                {"id": "P3", "name": "Gamma", "arrival_time": 2, "burst_time": 1, "priority": 3},
            ],
        })
        assert sched1.status_code == 200
        comparisons = sched1.json()["comparisons"]
        assert len(comparisons) == 5
        srtf = next(c for c in comparisons if c["algorithm"] == "SRTF")
        assert abs(srtf["avg_waiting_time"] - (5.0 / 3.0)) < 1e-4

        # Scheduling from session_id
        sched2 = client.post("/api/scheduling/compare", json={"session_id": sid, "quantum": 2})
        assert sched2.status_code == 200
        assert len(sched2.json()["comparisons"]) == 5

        # Synchronization lab (safe & unsafe)
        sync_safe = client.post("/api/synchronization/run", json={
            "scenario": "producer_consumer",
            "mode": "safe",
            "iterations": 5,
            "buffer_size": 3,
        })
        assert sync_safe.status_code == 200
        assert sync_safe.json()["completed_cleanly"] is True
        assert sync_safe.json()["overflows"] == 0
        assert sync_safe.json()["events"][0]["buffer_capacity"] == 3

        sync_dp = client.post("/api/synchronization/run", json={
            "scenario": "dining_philosophers",
            "mode": "safe",
            "iterations": 2,
        })
        assert sync_dp.status_code == 200
        assert len(sync_dp.json()["events"][0]["fork_owners"]) == 5

        sync_unsafe = client.post("/api/synchronization/run", json={
            "scenario": "dining_philosophers",
            "mode": "unsafe",
            "iterations": 2,
        })
        assert sync_unsafe.status_code == 200
        assert sync_unsafe.json()["completed_cleanly"] is False

        # Analytics & exports
        ana = client.get(f"/api/analytics/{sid}")
        assert ana.status_code == 200
        assert ana.json()["kpis"]["total_processes"] == 4

        exp_json = client.get(f"/api/analytics/{sid}/export?format=json")
        assert exp_json.status_code == 200
        assert exp_json.headers["content-type"].startswith("application/json")
        assert "state" in json.loads(exp_json.text)

        exp_csv = client.get(f"/api/analytics/{sid}/export?format=csv")
        assert exp_csv.status_code == 200
        assert exp_csv.headers["content-type"].startswith("text/csv")
        assert "utilization_pct" in exp_csv.text


def test_websocket_sync_and_live_updates():
    app = create_app()
    with TestClient(app) as client:
        sid = client.post("/api/simulation/create", json={"preset": "normal_workload", "seed": 42}).json()["session_id"]

        with client.websocket_connect(f"/ws/simulation/{sid}") as ws:
            initial = ws.receive_json()
            assert initial["type"] == "STATE_SYNC"
            assert initial["session_id"] == sid
            assert initial["state"]["tick"] == 0

            ws.send_json({"type": "PING"})
            pong = ws.receive_json()
            assert pong["type"] == "PONG"

            # Mutate via REST and verify WebSocket receives broadcast
            step = client.post(f"/api/simulation/{sid}/step")
            assert step.status_code == 200

            update = ws.receive_json()
            assert update["type"] == "STATE_SYNC"
            assert update["state"]["tick"] == 1

        # Unknown session websocket returns error message
        with client.websocket_connect("/ws/simulation/sim_missing") as ws_bad:
            err_msg = ws_bad.receive_json()
            assert err_msg["type"] == "ERROR"
            assert err_msg["error"]["code"] == "SESSION_NOT_FOUND"


def test_engine_failure_and_timeout_http_responses(tmp_path: Path):
    slow_sh = tmp_path / "slow_engine.sh"
    slow_sh.write_text("#!/bin/sh\nsleep 2\n")
    slow_sh.chmod(0o755)

    slow_app = create_app(bridge=EngineBridge(binary_path=slow_sh, default_timeout=0.15))
    with TestClient(slow_app) as client:
        res = client.post("/api/simulation/create", json={})
        assert res.status_code == 504
        assert res.json()["error"]["code"] == "ENGINE_TIMEOUT"

    missing_app = create_app(bridge=EngineBridge(binary_path=tmp_path / "missing"))
    with TestClient(missing_app) as client:
        res = client.post("/api/simulation/create", json={})
        assert res.status_code == 503
        assert res.json()["error"]["code"] == "ENGINE_UNAVAILABLE"


def test_cors_and_concurrent_session_updates_preserve_all_mutations():
    import asyncio
    import httpx

    app = create_app()
    with TestClient(app) as client:
        # Verify explicit Vite origin CORS headers
        cors = client.options(
            "/api/health",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert cors.status_code == 200
        assert cors.headers.get("access-control-allow-origin") == "http://localhost:5173"

    async def run_concurrent() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
            created = await ac.post("/api/simulation/create", json={"preset": "normal_workload", "seed": 42})
            assert created.status_code == 201
            sid = created.json()["session_id"]

            # Start auto-tick at 4x while issuing 5 simultaneous step requests & 2 process additions
            await ac.post(f"/api/simulation/{sid}/start", json={"speed": 4.0})
            tasks = [ac.post(f"/api/simulation/{sid}/step") for _ in range(5)]
            tasks.append(ac.post(f"/api/simulation/{sid}/process", json={"name": "ConcA", "burst_time": 10, "priority": 2}))
            tasks.append(ac.post(f"/api/simulation/{sid}/process", json={"name": "ConcB", "burst_time": 10, "priority": 3}))
            responses = await asyncio.gather(*tasks)
            for r in responses:
                assert r.status_code in (200, 201)

            await ac.post(f"/api/simulation/{sid}/pause")
            final_state = (await ac.get(f"/api/simulation/{sid}/state")).json()
            # All 5 manual steps + any auto ticks >= 5, and both ConcA & ConcB must be present (no lost writes)
            assert final_state["state"]["tick"] >= 5
            names = {p["name"] for p in final_state["state"]["processes"]}
            assert "ConcA" in names and "ConcB" in names
            assert final_state["result"]["runtime"]["seq"] >= 8

    asyncio.run(run_concurrent())


def test_phase7_presets_comparisons_analytics_and_exports():
    import csv
    import io

    app = create_app()
    with TestClient(app) as client:
        # 1. Authoritative C++ preset registry
        presets_res = client.get("/api/experiments/presets")
        assert presets_res.status_code == 200
        presets_data = presets_res.json()
        preset_ids = [p["id"] for p in presets_data["presets"]]
        assert len(preset_ids) == 9
        for required in [
            "normal_workload",
            "classic_banker_safe",
            "single_instance_deadlock",
            "multi_instance_safe_cycle",
            "unsafe_no_deadlock",
            "resource_starvation",
            "recovery_demo",
        ]:
            assert required in preset_ids

        # 2. Active session creation & deterministic analytics KPIs + CSV/JSON exports
        created = client.post("/api/simulation/create", json={"preset": "classic_banker_safe", "seed": 42})
        assert created.status_code == 201
        sid = created.json()["session_id"]
        before_active_tick = created.json()["state"]["tick"]

        # Trigger a safe grant and step to generate completed + metrics history + events
        req_res = client.post(f"/api/simulation/{sid}/request", json={
            "process_id": "P1",
            "request": {"R0": 1, "R2": 2},
            "use_banker": True,
        })
        assert req_res.status_code == 200
        assert req_res.json()["state"]["granted_request_count"] == 1

        step_res = client.post(f"/api/simulation/{sid}/step")
        assert step_res.status_code == 200
        assert step_res.json()["state"]["tick"] == 1

        ana = client.get(f"/api/analytics/{sid}")
        assert ana.status_code == 200
        ana_body = ana.json()
        assert ana_body["kpis"]["granted_request_count"] == 1
        assert ana_body["kpis"]["available_resource_instances"] == 5
        assert len(ana_body["metrics_history"]) >= 2
        assert "recorded_at" in ana_body["metrics_history"][0]
        assert "recorded_at" in ana_body["events"][0]

        # Event history CSV export
        ev_csv = client.get(f"/api/analytics/{sid}/export?format=csv&scope=events")
        assert ev_csv.status_code == 200
        assert ev_csv.headers["content-type"].startswith("text/csv")
        rows = list(csv.reader(io.StringIO(ev_csv.text)))
        assert rows[0][0] == "session_id"
        assert "recorded_at_utc" in rows[0]
        assert len(rows) >= 2

        # Metrics CSV export
        met_csv = client.get(f"/api/analytics/{sid}/export?format=csv&scope=metrics")
        assert met_csv.status_code == 200
        met_rows = list(csv.reader(io.StringIO(met_csv.text)))
        assert "pending_request_units" in met_rows[0]
        assert len(met_rows) >= 2

        # 3. Isolated Comparative Experiments (must NOT mutate active session!)
        comp_avoid = client.post("/api/experiments/compare", json={
            "mode": "avoidance",
            "preset": "classic_banker_safe",
            "seed": 42,
            "steps_after": 1,
        })
        assert comp_avoid.status_code == 200
        arms_avoid = comp_avoid.json()["arms"]
        assert len(arms_avoid) == 2
        assert arms_avoid[0]["safety_status"] == "SAFE"
        assert arms_avoid[1]["safety_status"] == "UNSAFE"

        comp_rec = client.post("/api/experiments/compare", json={
            "mode": "recovery",
            "preset": "recovery_demo",
            "seed": 42,
        })
        assert comp_rec.status_code == 200
        assert len(comp_rec.json()["arms"]) == 4

        comp_sched = client.post("/api/experiments/compare", json={
            "mode": "scheduling",
            "quantum": 2,
        })
        assert comp_sched.status_code == 200
        assert len(comp_sched.json()["arms"]) == 5

        comp_sync = client.post("/api/experiments/compare", json={
            "mode": "synchronization",
            "sync_scenario": "dining_philosophers",
            "sync_iterations": 2,
            "seed": 42,
        })
        assert comp_sync.status_code == 200
        sync_arms = comp_sync.json()["arms"]
        assert sync_arms[0]["safety_status"] == "CLEAN"
        assert sync_arms[1]["safety_status"] == "RACE / DEADLOCK"

        # Active session remains untouched by isolated comparisons
        after_active = client.get(f"/api/simulation/{sid}/state").json()
        assert after_active["state"]["tick"] == before_active_tick + 1
        assert after_active["state"]["preset"] == "classic_banker_safe"

        # 4. Experiment comparison & scheduling/sync exports
        exp_comp_csv = client.post("/api/experiments/export", json={
            "kind": "comparison",
            "format": "csv",
            "title": "avoidance-test",
            "data": comp_avoid.json(),
        })
        assert exp_comp_csv.status_code == 200
        assert "Banker's Avoidance ON" in exp_comp_csv.text

        exp_sched_csv = client.post("/api/experiments/export", json={
            "kind": "scheduling",
            "format": "csv",
            "title": "sched-test",
            "data": comp_sched.json(),
        })
        assert exp_sched_csv.status_code == 200
        assert "SRTF" in exp_sched_csv.text

        # Invalid experiment compare request returns 422
        bad_comp = client.post("/api/experiments/compare", json={"mode": "invalid_mode"})
        assert bad_comp.status_code == 422

        # Phase 8D Security & Reliability hardening checks
        # 1. Oversized HTTP body (>1 MiB) returns 413 PAYLOAD_TOO_LARGE cleanly
        huge_body = b'{"preset":"normal_workload","pad":"' + (b"x" * (1024 * 1024 + 128)) + b'"}'
        oversized = client.post(
            "/api/simulation/create",
            content=huge_body,
            headers={"Content-Type": "application/json"},
        )
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"

        # 2. Untrusted cross-site WebSocket origin is rejected cleanly
        import pytest
        from starlette.websockets import WebSocketDisconnect
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect(
                f"/ws/simulation/{sid}",
                headers={"Origin": "https://evil.example.com"},
            ):
                pass

        # 3. Disjoint cycles unresolved by single terminate_victim returns 409 DEADLOCK_UNRESOLVED
        s_disjoint = client.post("/api/simulation/create", json={"preset": "single_instance_deadlock", "seed": 42})
        assert s_disjoint.status_code == 201
        dj_id = s_disjoint.json()["session_id"]
        # Create second independent cycle: P2 holds R2 wants R3, P3 holds R3 wants R2
        assert client.post(f"/api/simulation/{dj_id}/resource", json={
            "id": "R2", "name": "Socket 2", "category": "LOCK", "total_instances": 1, "preemptible": False,
        }).status_code == 201
        assert client.post(f"/api/simulation/{dj_id}/resource", json={
            "id": "R3", "name": "Socket 3", "category": "LOCK", "total_instances": 1, "preemptible": False,
        }).status_code == 201
        assert client.post(f"/api/simulation/{dj_id}/process", json={
            "id": "P2", "name": "Worker 2", "arrival_time": 0, "burst_time": 4, "priority": 1,
            "max_demand": {"R2": 1, "R3": 1}, "termination_cost": 100,
        }).status_code == 201
        assert client.post(f"/api/simulation/{dj_id}/process", json={
            "id": "P3", "name": "Worker 3", "arrival_time": 0, "burst_time": 4, "priority": 1,
            "max_demand": {"R2": 1, "R3": 1}, "termination_cost": 100,
        }).status_code == 201
        assert client.post(f"/api/simulation/{dj_id}/request", json={"process_id": "P2", "request": {"R2": 1}, "use_banker": False}).status_code == 200
        assert client.post(f"/api/simulation/{dj_id}/request", json={"process_id": "P3", "request": {"R3": 1}, "use_banker": False}).status_code == 200
        assert client.post(f"/api/simulation/{dj_id}/request", json={"process_id": "P2", "request": {"R3": 1}, "use_banker": False}).status_code == 200
        assert client.post(f"/api/simulation/{dj_id}/request", json={"process_id": "P3", "request": {"R2": 1}, "use_banker": False}).status_code == 200

        victim_refusal = client.post(
            f"/api/simulation/{dj_id}/recovery",
            json={"strategy": "terminate_victim", "victim_criteria": "lowest_cost"},
        )
        assert victim_refusal.status_code == 409
        vr_body = victim_refusal.json()
        assert vr_body["error"]["code"] == "DEADLOCK_UNRESOLVED"
        assert vr_body["session_id"] == dj_id
        assert isinstance(vr_body["state"], dict)
        assert vr_body["state"]["recovery_count"] >= 1
        assert len(vr_body["result"]["terminated_processes"]) == 1
        # Canonical session state on server also reflects partial termination
        after_partial = client.get(f"/api/simulation/{dj_id}/state").json()
        assert after_partial["state"]["recovery_count"] == vr_body["state"]["recovery_count"]
        assert len(after_partial["state"]["deadlock_report"]["deadlocked_processes"]) == 2
