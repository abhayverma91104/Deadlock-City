# Deadlock City — FastAPI REST & WebSocket API Contracts

Base URL: `/api`
Content-Type: `application/json`

## Standard Response & Error Envelope

All successful simulation mutations return the canonical session envelope:
```json
{
  "session_id": "sim_9f42a1",
  "state": { "...canonical SimulationState from C++ engine..." },
  "result": { "...optional command-specific report or diff..." }
}
```

All errors return structured JSON with appropriate HTTP status codes (`400`, `404`, `409`, `422`, `500`, `504`):
```json
{
  "error": {
    "code": "REQUEST_EXCEEDS_NEED",
    "message": "Process P1 requested 3 units of R1, exceeding remaining need of 1.",
    "details": {}
  }
}
```

---

## 1. Health & Metadata

- `GET /api/health`
  - Verifies FastAPI readiness **and** executes a lightweight `--health` check against the compiled `deadlock_engine` binary.
  - Response `200`: `{ "status": "ok", "engine_available": true, "engine_version": "1.0.0", "active_sessions": 2 }`

---

## 2. Simulation Lifecycle

- `POST /api/simulation/create`
  - Body: `{ "preset": "classic_banker_safe" | null, "seed": 42, "speed": 1.0 }`
  - Response `201`: `{ "session_id": "...", "state": {...} }`
- `GET /api/simulation/{id}/state`
  - Response `200`: `{ "session_id": "...", "state": {...} }`
- `POST /api/simulation/{id}/start`
  - Body (optional): `{ "speed": 1.0 }` — starts background tick loop for session `{id}`, pushing WebSocket state updates each tick.
- `POST /api/simulation/{id}/pause`
  - Pauses background tick loop.
- `POST /api/simulation/{id}/step`
  - Advances simulation by `1` tick via C++ `step_simulation`.
- `POST /api/simulation/{id}/reset`
  - Body (optional): `{ "preset": "...", "seed": 42 }`
- `POST /api/simulation/{id}/workload/random`
  - Body: `{ "process_count": 5, "resource_count": 3, "seed": 123 }`
- `POST /api/simulation/{id}/checkpoint`
  - Saves a valid recovery checkpoint in C++ engine state.

---

## 3. Process & Resource Management

- `POST /api/simulation/{id}/process`
  - Body: `{ "name": "Compiler", "arrival_time": 0, "burst_time": 6, "priority": 2, "max_demand": { "R0": 2, "R1": 1 }, "termination_cost": 5 }`
- `DELETE /api/simulation/{id}/process/{pid}`
  - Terminates and releases resources held by `{pid}`.
- `POST /api/simulation/{id}/process/{pid}/suspend`
- `POST /api/simulation/{id}/process/{pid}/resume`
- `POST /api/simulation/{id}/resource`
  - Body: `{ "name": "DB Lock", "category": "LOCK", "total_instances": 2, "preemptible": false }`
- `PATCH /api/simulation/{id}/resource/{rid}`
  - Body: `{ "total_instances": 3, "preemptible": true }`
- `POST /api/simulation/{id}/request`
  - Body: `{ "process_id": "P1", "request": { "R0": 1, "R1": 0 }, "use_banker": true }`
  - Returns allocation decision (`granted`, `reason`, `banker_report` or updated `deadlock_report`).
- `POST /api/simulation/{id}/release`
  - Body: `{ "process_id": "P1", "release": { "R0": 1 } }`

---

## 4. Graph, Detection, Banker's & Recovery

- `GET /api/simulation/{id}/graph`
  - Returns derived RAG nodes (`process`, `resource`) and edges (`allocation`, `request`, `cycle_member`, `deadlocked`) computed cleanly from canonical C++ engine state.
- `GET /api/simulation/{id}/deadlock`
  - Runs C++ `detect_deadlock` and returns `DeadlockReport` (Wait-For Graph, Work/Finish steps, cycles vs true deadlocks, explanation).
- `POST /api/simulation/{id}/banker/check`
  - Body (optional): `{ "process_id": "P1", "hypothetical_request": { "R0": 1 } }`
  - Runs C++ `check_banker_safety` without mutating state when hypothetical, returning `BankerReport` (`Need`, `Safe/Unsafe`, `SafeSequence`, `steps[]`, `explanation`).
- `POST /api/simulation/{id}/recovery`
  - Body: `{ "strategy": "terminate_all" | "terminate_victim" | "preempt_resource" | "rollback", "victim_criteria": "lowest_priority" | "lowest_cost" | "least_allocated" | "lowest_remaining_work", "target_process_id": "P1" | null, "target_resource_id": "R0" | null, "checkpoint_index": 0 | null }`
  - Mutates actual C++ simulation state, re-runs deadlock detection, and returns recovery summary + updated state.

---

## 5. Independent Laboratories & Analytics

- `POST /api/scheduling/compare`
  - Body: `{ "session_id": "..." | null, "quantum": 2, "processes": [ { "id": "P0", "name": "...", "arrival_time": 0, "burst_time": 5, "priority": 2 } ] }`
  - Executes C++ `CPUScheduler` across FCFS, SJF, SRTF, Priority, and Round Robin; returns Gantt segments + per-process and aggregate metrics.
- `POST /api/synchronization/run`
  - Body: `{ "scenario": "producer_consumer" | "readers_writers" | "dining_philosophers", "mode": "safe" | "unsafe", "iterations": 12, "buffer_size": 4, "seed": 42 }`
  - Executes bounded C++ multi-threaded synchronization module and returns thread state timeline, synchronization events, invariant check (`overflows`, `underflows`, `race_detected`), and logs.
- `GET /api/analytics/{id}`
  - Returns current KPI summary + `metrics_history` + `events` for Recharts visualizations.
- `GET /api/analytics/{id}/export?format=json|csv`
  - Downloads experiment snapshot/metrics as `application/json` or `text/csv`.
- `POST /api/experiments/run`
  - Body: `{ "session_id": "...", "preset": "single_instance_deadlock" | "multi_instance_safe_cycle" | "classic_banker_safe" | "unsafe_no_deadlock" | "resource_starvation" | "high_contention" | "normal_workload" | "recovery_demo", "seed": 42 }`

---

## 6. WebSocket Protocol

- Endpoint: `WS /ws/simulation/{id}`
- Server -> Client events:
  - `{"type": "STATE_SYNC", "state": {...}}`
  - `{"type": "SIMULATION_EVENT", "event": {...}}`
  - `{"type": "ERROR", "error": {...}}`
- Client -> Server keepalive/commands:
  - `{"type": "PING"}` -> `{"type": "PONG"}`
