# Deadlock City — FastAPI REST, WebSocket & C++ IPC Reference

Base URL: `/api`
Content-Type: `application/json` (maximum HTTP request body size: **`1 MiB`** / `1048576` bytes via `MAX_REQUEST_BODY_BYTES`; larger payloads return `413 PAYLOAD_TOO_LARGE`).

---

## 1. Standard Envelopes & Error Handling

### Canonical Success Envelope (`SimulationEnvelope`)
```json
{
  "session_id": "sim_a1b2c3d4",
  "state": {
    "tick": 1,
    "seed": 42,
    "preset": "classic_banker_safe",
    "status": "IDLE",
    "safety_status": "SAFE",
    "processes": [],
    "resources": [],
    "deadlock_report": { "detected": false, "has_cycle_in_rag": false },
    "banker_report": { "is_safe": true, "safe_sequence": ["P1", "P3", "P4", "P0", "P2"] },
    "total_metric_samples_recorded": 2,
    "total_events_recorded": 3,
    "events": [],
    "metrics_history": [],
    "checkpoints": []
  },
  "result": {
    "runtime": { "is_running": false, "speed": 1.0, "seq": 2 }
  }
}
```

### Error Envelope & HTTP Status Mapping

| HTTP Status | Error Code(s) | Trigger |
| :--- | :--- | :--- |
| `400 Bad Request` | `VALIDATION_ERROR`, `REQUEST_EXCEEDS_NEED`, `INVALID_RELEASE`, `PROCESS_LIMIT_EXCEEDED`, `RESOURCE_LIMIT_EXCEEDED` | Domain validation violation in C++ engine (`deadlock_engine` returns `ok=false`) |
| `404 Not Found` | `SESSION_NOT_FOUND`, `PROCESS_NOT_FOUND`, `RESOURCE_NOT_FOUND` | Unknown session ID, PID, or RID |
| `409 Conflict` | `NO_DEADLOCK_DETECTED`, `DEADLOCK_UNRESOLVED`, `NO_CHECKPOINTS`, `NO_PREEMPTIBLE_RESOURCE`, `RESOURCE_NOT_PREEMPTIBLE` | Conflicting recovery/state precondition; `DEADLOCK_UNRESOLVED` also includes updated `session_id`, `state`, and `result` |
| `413 Payload Too Large` | `PAYLOAD_TOO_LARGE` | Request body exceeds `MAX_REQUEST_BODY_BYTES` |
| `422 Unprocessable Entity` | `VALIDATION_ERROR` | Pydantic v2 schema constraint failure |
| `500 Internal Server Error` | `ENGINE_PROCESS_FAILED`, `ENGINE_MALFORMED_JSON`, `ENGINE_EMPTY_OUTPUT` | Unexpected engine crash or corrupt IPC output |
| `503 Service Unavailable` | `ENGINE_UNAVAILABLE`, `SESSION_LIMIT_REACHED` | Missing `deadlock_engine` binary or all `DEADLOCK_MAX_SESSIONS` slots busy |
| `504 Gateway Timeout` | `ENGINE_TIMEOUT` | Subprocess wall-clock timeout exceeded (`5.0s` standard, `15.0s` `run_synchronization`) |

#### Partial Recovery HTTP `409` Example
When terminating one victim resolves one cycle while leaving another disjoint deadlock cycle intact, FastAPI updates `SessionManager` state, broadcasts `STATE_SYNC` to WebSockets, and responds with `409`:

```json
{
  "error": {
    "code": "DEADLOCK_UNRESOLVED",
    "message": "Partial recovery executed, but deadlock still persists across remaining processes.",
    "details": { "session_id": "sim_90ab12ef" }
  },
  "session_id": "sim_90ab12ef",
  "state": { "...mutated canonical SimulationState..." },
  "result": {
    "ok": false,
    "error_code": "DEADLOCK_UNRESOLVED",
    "terminated_processes": ["P1"],
    "runtime": { "is_running": false, "speed": 1.0, "seq": 5 }
  }
}
```

---

## 2. Health Endpoint

### `GET /api/health`
Verifies FastAPI responsiveness and executes `deadlock_engine --health`.

Example Response (`200`):
```json
{
  "status": "ok",
  "engine_available": true,
  "engine_version": "1.0.0",
  "active_sessions": 1
}
```
If the binary is missing or fails health verification, returns `200` with `"status": "degraded"`, `"engine_available": false`, `"engine_version": null`.

---

## 3. Simulation Session & Lifecycle Endpoints

Capacity limit: **`DEADLOCK_MAX_SESSIONS`** (default `100`). When full, least-recently-used **idle** sessions (not running, zero connected WebSockets, unlocked) are evicted cleanly; if all slots are active/connected, returns `503 SESSION_LIMIT_REACHED`.

| Method | Path | Request Body / Params | Response |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/simulation/create` | `{"preset": string\|null, "seed": int>=0 (42), "speed": 0.25..4.0 (1.0)}` | `201 SimulationEnvelope` |
| `GET` | `/api/simulation/{session_id}/state` | Path `session_id` | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/start` | Optional `{"speed": 0.25..4.0\|null}` | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/pause` | None | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/resume` | Optional `{"speed": 0.25..4.0\|null}` | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/stop` | None | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/step` | None | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/reset` | Optional `{"preset": string\|null, "seed": int>=0\|null}` | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/workload/random` | `{"process_count": 2..12, "resource_count": 2..6, "seed": int>=0}` | `200 SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/checkpoint` | None | `200 SimulationEnvelope` |

Example Create Request & Response:
```bash
curl -s -X POST http://127.0.0.1:8000/api/simulation/create \
  -H "Content-Type: application/json" \
  -d '{"preset":"classic_banker_safe","seed":42,"speed":1.0}'
```

---

## 4. Process, Resource, Graph, Banker & Recovery Endpoints

| Method | Path | Request Body | Notes |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/simulation/{session_id}/process` | `{"id"?: string, "name": 1..64 chars, "arrival_time"?: >=0, "burst_time": 1..500, "priority": 1..10, "max_demand": {rid: qty}, "termination_cost": 1..100}` | `201` (max 24 processes) |
| `DELETE` | `/api/simulation/{session_id}/process/{pid}` | Path `pid` | Terminates & releases held instances |
| `POST` | `/api/simulation/{session_id}/process/{pid}/suspend` | Path `pid` | Transitions non-terminated -> `WAITING` |
| `POST` | `/api/simulation/{session_id}/process/{pid}/resume` | Path `pid` | Transitions `WAITING` -> `READY` |
| `POST` | `/api/simulation/{session_id}/resource` | `{"id"?: string, "name": 1..64 chars, "category": "IO"\|"LOCK"\|"COMPUTE"\|"MEMORY"\|"STORAGE", "total_instances": 1..64, "preemptible": bool}` | `201` (max 12 pools) |
| `PATCH` | `/api/simulation/{session_id}/resource/{rid}` | `{"total_instances"?: 1..64, "preemptible"?: bool}` | Refuses shrinking below allocated count |
| `POST` | `/api/simulation/{session_id}/request` | `{"process_id": string, "request": {rid: qty}, "use_banker": bool}` | Returns grant/rejection + updated report |
| `POST` | `/api/simulation/{session_id}/release` | `{"process_id": string, "release": {rid: qty}}` | Frees held units & retries blocked peers |
| `GET` | `/api/simulation/{session_id}/graph` | Path `session_id` | Returns `{"session_id", "graph": {nodes, edges, has_cycle, deadlock_detected, deadlocked_processes, cycles, wait_for_edges}, "state"}` |
| `GET` | `/api/simulation/{session_id}/deadlock` | Path `session_id` | Executes C++ `detect_deadlock`, returning `SimulationEnvelope` |
| `POST` | `/api/simulation/{session_id}/banker/check` | Optional `{"process_id"?: string, "hypothetical_request"?: {rid: qty}}` | Non-mutating when hypothetical |
| `POST` | `/api/simulation/{session_id}/recovery` | `{"strategy": "terminate_all"\|"terminate_victim"\|"preempt_resource"\|"rollback", "victim_criteria"?: ..., "target_process_id"?: ..., "target_resource_id"?: ..., "checkpoint_index"?: >=0}` | Mutates canonical state; returns `409 DEADLOCK_UNRESOLVED` with updated `state` if another cycle persists |

---

## 5. Independent Laboratories, Analytics & Exports

### `POST /api/scheduling/compare`
Request:
```json
{
  "session_id": null,
  "quantum": 2,
  "processes": [
    {"id": "P0", "name": "Gateway", "arrival_time": 0, "burst_time": 5, "priority": 2},
    {"id": "P1", "name": "Indexer", "arrival_time": 1, "burst_time": 2, "priority": 1}
  ]
}
```
Returns `comparisons[]` for `FCFS`, `SJF`, `SRTF`, `PRIORITY`, and `RR` (plus optional `gantt`, `process_metrics`, `avg_waiting_time`, `avg_turnaround_time`, `avg_response_time`, `context_switches`, `cpu_utilization_pct`, `total_time`). Requires either `processes` or `session_id`.

### `POST /api/synchronization/run`
Request:
```json
{
  "scenario": "dining_philosophers",
  "mode": "safe",
  "iterations": 10,
  "buffer_size": 4,
  "seed": 42
}
```
Constraints: `iterations` `1..50`, `buffer_size` `1..32`. Returns `completed_cleanly`, `race_or_deadlock_detected`, `produced_count`, `consumed_count`, `overflows`, `underflows`, `conflicts`, `completed_meals`, `events[]` (up to 240), `logs[]`, `summary`.

### `GET /api/analytics/{session_id}`
Returns KPI summary (`kpis`), bounded sliding-window telemetry retention disclosure (`telemetry_retention`), UTC-stamped `metrics_history`, `events`, and `process_state_distribution`:
```json
{
  "session_id": "sim_a1b2c3d4",
  "tick": 12,
  "preset": "classic_banker_safe",
  "seed": 42,
  "safety_status": "SAFE",
  "telemetry_retention": {
    "metrics_window_cap": 240,
    "events_window_cap": 200,
    "total_metric_samples_recorded": 13,
    "retained_metric_samples": 13,
    "discarded_metric_samples": 0,
    "retained_tick_range": [0, 12],
    "total_events_recorded": 18,
    "retained_events": 18,
    "discarded_events": 0
  },
  "kpis": { "...21 engine-backed KPIs..." },
  "metrics_history": [],
  "events": [],
  "process_state_distribution": { "NEW": 0, "READY": 4, "RUNNING": 1, "WAITING": 0, "BLOCKED": 0, "TERMINATED": 0 }
}
```

### `GET /api/analytics/{session_id}/export?format=json|csv&scope=snapshot|metrics|events`
- `format=json`: Downloads `deadlock-city-{session_id}-snapshot.json` (`analytics` summary + full `state`).
- `format=csv&scope=metrics`: Downloads metrics CSV with columns `session_id,tick,utilization_pct,active_count,blocked_count,deadlocked_count,allocation_count,available_count_units,waiting_count_procs,completed_count_procs,terminated_count_procs,pending_request_units,deadlock_count_total,recovery_count_total,safety_status,preset,seed,recorded_at_utc,total_metric_samples_recorded`.
- `format=csv&scope=events`: Downloads event CSV including `event_id`, `tick`, `recorded_at_utc`, `category`, `severity`, `process_id`, `resource_id`, `message`, `metadata_json`, and `total_events_recorded`.

### Experiments Endpoints
- `GET /api/experiments/presets` — Returns all 9 authoritative C++ presets (`list_presets`) + random generator bounds (`2..12` processes, `2..6` resources).
- `POST /api/experiments/run` — Loads `{ "session_id", "preset", "seed" }` into an existing session.
- `POST /api/experiments/compare` — Runs isolated non-mutating A/B comparison for `"mode": "avoidance" | "recovery" | "scheduling" | "synchronization"` (`steps_after` `0..20`, `quantum` `1..50`, `sync_iterations` `1..40`, `sync_buffer_size` `1..16`).
- `POST /api/experiments/export` — Downloads experiment results (`comparison`, `scheduling`, `synchronization`) in `csv` or `json` with sanitized filename (`_safe_filename`).

---

## 6. WebSocket Protocol

- **Endpoint**: `WS /ws/simulation/{session_id}`
- **Connection Lifecycle**:
  1. Validates `Origin` header (when supplied) against `ALLOWED_ORIGINS` and local `localhost|127.0.0.1` regex; rejects untrusted browser origins immediately with close code `1008`.
  2. Accepts socket and sends initial `STATE_SYNC` (`{"type": "STATE_SYNC", "session_id", "state", "runtime": {"is_running", "speed", "seq"}}`), or sends `SESSION_NOT_FOUND` + closes with `4404` if missing (frontend suppresses reconnect on `4404`).
  3. Frontend reconnect manager applies exponential backoff up to `8` attempts and sends `{"type": "PING"}` every `20s`.
- **Events**:
  - Server -> Client: `STATE_SYNC`, `SIMULATION_EVENT`, `ERROR` (`INVALID_WS_MESSAGE` / `SESSION_NOT_FOUND` / engine error), `PONG`
  - Client -> Server: `{"type": "PING"}`

---

## 7. Authoritative C++ Engine IPC (`deadlock_engine`)

Invoked without a shell via `deadlock_engine --health` or `deadlock_engine --json-stdio` (constrained by `EngineBridge` `asyncio.Semaphore(8)`). Formal JSON Schema: [docs/schemas/engine-ipc.schema.json](schemas/engine-ipc.schema.json).

### All Supported `--json-stdio` Commands (`SimulationEngine::execute_json`)
- `health`, `list_presets`
- `create_simulation`, `load_preset`, `reset_simulation`, `generate_random_workload`
- `step_simulation`, `create_checkpoint`
- `add_process`, `remove_process` / `terminate_process`, `suspend_process`, `resume_process`
- `add_resource`, `modify_resource`
- `request_resources`, `release_resources`
- `detect_deadlock`, `check_banker_safety`, `recover_deadlock`
- `compare_scheduling`, `run_synchronization`
