# Deadlock City — System Architecture

## 1. Architectural Principles

1. **C++17 Engine as Single Source of Truth**:
   All OS simulation state transitions, resource allocation, Banker's Algorithm safety checks, Wait-For/RAG deadlock detection, deadlock recovery, CPU scheduling metrics, and synchronization experiments execute exclusively in the C++17 binary (`deadlock_engine`). Neither Python nor TypeScript duplicates algorithmic logic.
2. **Stateless C++ Command Execution + Reconstructible Session Snapshots**:
   The C++ engine operates cleanly via structured JSON over `stdin`/`stdout` (and optional CLI flags for batch/unit invocation). Every command accepts the current serialized simulation state (or initializes a new state) and returns the updated canonical state snapshot plus command-specific diagnostics (Banker's step trace, detection trace, recovery diff, Gantt chart). Python persists per-session state in memory (thread-safe per-session lock) and pushes deltas/snapshots over WebSockets to connected frontend clients.
3. **Strict Layer Separation**:
   - **Frontend (`React + TypeScript + R3F + React Flow`)**: Pure presentation, 3D city rendering, RAG layout, interactive controls, and client-side UI view state (selected node, camera target, active tab).
   - **Backend (`Python 3.11+ / FastAPI / Pydantic`)**: Session lifecycle, input validation, rate/timeout safety around subprocess calls, WebSocket broadcasting, and CSV/JSON export formatting.
   - **Core Engine (`C++17 / CMake / nlohmann::json / GoogleTest`)**: Deterministic simulation kernel, OS algorithms, and multi-threaded synchronization lab.

---

## 2. Three-Tier Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────────┐
│ FRONTEND (React 18 + TypeScript + Vite + Tailwind + R3F + React Flow)     │
│  - 3D City Canvas (Buildings=Processes, Facilities=Resources, Conduits)   │
│  - RAG Interactive Graph (React Flow)                                     │
│  - Banker's Matrix Workbench, Detection Stepper, Recovery Console         │
│  - CPU Scheduling Gantt Lab, Sync Lab, Analytics (Recharts)               │
│  - Zustand UI + Session Store (hydrated via REST + WebSocket updates)     │
└───────────────────────────────┬───────────────────────────┬───────────────┘
                                │ REST (JSON)               │ WebSocket
                                ▼                           ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ BACKEND ORCHESTRATION LAYER (Python 3.11+ + FastAPI + Pydantic v2)        │
│  - SessionManager (isolated sessions, asyncio locks, auto-tick runner)    │
│  - EngineBridge (safe subprocess exec with stdin/stdout JSON & timeouts)  │
│  - WebSocketHub (broadcasts canonical state & event logs per session)     │
│  - ExportService (CSV / JSON experiment serialization)                    │
└───────────────────────────────┬───────────────────────────────────────────┘
                                │ Subprocess stdin/stdout (JSON IPC)
                                ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ CORE SIMULATION ENGINE (C++17 Executable: deadlock_engine)                │
│  - SimulationEngine       : Orchestrates ticks, seed PRNG, presets        │
│  - ProcessManager         : PCB lifecycle (New/Ready/Running/Wait/Blk/Trm)│
│  - ResourceManager        : Resource types, instances, alloc/request/rel  │
│  - DeadlockDetector       : Single-inst cycle + Multi-inst Work/Finish    │
│  - BankersAlgorithm       : Need=Max-Alloc, Safety check, Request guard   │
│  - RecoveryManager        : Victim selection, preemption, checkpoints     │
│  - CPUScheduler           : FCFS, SJF, SRTF, Priority, Round Robin        │
│  - SyncLab                : Producer-Consumer, Readers-Writers, Dining Ph │
│  - SimulationSerializer   : Canonical JSON state & diff serialization     │
└───────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Directory Structure

```text
Deadlock City/
├── frontend/
│   ├── public/
│   └── src/
│       ├── city/          # Three.js / R3F 3D city scene, buildings, conduits, camera
│       ├── graph/         # React Flow Resource Allocation Graph & custom nodes/edges
│       ├── dashboard/     # Overview HUD, top bar, radial control core, inspector
│       ├── simulation/    # Detection, Banker's, Recovery, Scheduling, Sync Lab views
│       ├── components/    # Shared tactical UI primitives (panels, tables, badges, modals)
│       ├── pages/         # Top-level route/tab views & Docs
│       ├── hooks/         # WebSocket hook, keyboard hotkeys, selection hooks
│       ├── services/      # Typed REST API client & WebSocket client
│       ├── stores/        # Zustand simulation & UI store
│       ├── types/         # TypeScript interfaces matching Pydantic & C++ schemas
│       └── utils/         # Formatters, layout helpers, color tokens
├── backend/
│   ├── app/
│   │   ├── api/           # FastAPI routers (simulation, scheduling, sync, analytics, health)
│   │   ├── engine/        # Subprocess bridge & binary locator
│   │   ├── schemas/       # Pydantic v2 request/response models
│   │   ├── services/      # SessionManager, background ticker, export service
│   │   ├── websocket/     # Per-session WebSocket connection manager
│   │   └── main.py        # FastAPI app entrypoint & CORS/error handlers
│   ├── tests/             # Pytest integration & API contract tests
│   └── requirements.txt
├── engine/
│   ├── include/           # C++17 headers (.hpp) for all 8+ engine modules
│   ├── src/               # C++17 implementations (.cpp) + main CLI entrypoint
│   ├── tests/             # GoogleTest suites covering Test Cases 1–8 + edge cases
│   └── CMakeLists.txt
├── docs/
│   ├── schemas/
│   │   └── engine-ipc.schema.json
│   ├── design-system.md
│   ├── architecture.md
│   ├── api.md
│   ├── algorithms.md      # Added/expanded in Phase 2 & 9
│   ├── user-guide.md      # Added in Phase 9
│   └── roadmap.md
├── scripts/               # Build, dev-runner, and test scripts
├── .gitignore
├── docker-compose.yml     # Added in Phase 8/9
└── README.md              # Added/finalized in Phase 9
```

*(Note: The workspace root `Deadlock City/` serves directly as the monorepo root so paths stay flat and clean.)*

---

## 4. C++ / Python Communication Contract

### Invocation Pattern
The backend invokes `deadlock_engine --json-stdio` as a bounded subprocess (`asyncio.create_subprocess_exec`, **no shell**, fixed timeout e.g. `5.0s` for simulation commands, `15.0s` for synchronization lab runs).

- **Input (on `stdin`)**: Single JSON object matching `EngineRequest`:
  ```json
  {
    "command": "request_resources",
    "state": { "...canonical SimulationState..." },
    "payload": {
      "process_id": "P1",
      "request": { "R1": 0, "R2": 1 },
      "use_banker": true
    }
  }
  ```
  *(For `init_simulation` or `load_preset`, `state` may be omitted/null.)*
- **Output (on `stdout`)**: Single JSON object matching `EngineResponse`:
  ```json
  {
    "ok": true,
    "command": "request_resources",
    "error": null,
    "state": { "...updated canonical SimulationState..." },
    "result": {
      "granted": false,
      "reason": "Banker's Algorithm rejected request: resulting state is UNSAFE.",
      "banker_report": { "...step trace..." }
    }
  }
  ```
- **Error Handling**:
  - Domain errors (e.g. `Request exceeds remaining Need`, `Unknown process ID`, `Invalid preset`) return exit code `0` with `"ok": false` and structured `"error": { "code": "...", "message": "..." }`, allowing FastAPI to map cleanly to `400` / `404` / `409` / `422`.
  - Unexpected crashes or non-zero exit codes / timeouts are caught by `EngineBridge`, logged with `stderr`, and surfaced as HTTP `500` / `504` structured errors without leaking internals or corrupting stored session state.

### Supported C++ Commands
- `create_simulation` / `load_preset` / `reset_simulation`
- `step_simulation` (advances 1 tick: executes Running process, updates remaining time, retries blocked requests, checks deadlock)
- `add_process` / `remove_process` / `suspend_process` / `resume_process`
- `add_resource` / `modify_resource`
- `request_resources` (supports `use_banker: true|false`)
- `release_resources`
- `detect_deadlock` (returns RAG + WFG + Work/Finish step trace + human explanation)
- `check_banker_safety` (returns Need matrix, Safe/Unsafe status, Safe sequence, step trace)
- `recover_deadlock` (`terminate_all`, `terminate_victim`, `preempt_resource`, `rollback_checkpoint`)
- `create_checkpoint`
- `generate_random_workload` (deterministic via `seed`)
- `compare_scheduling` (standalone/snapshot workload -> FCFS, SJF, SRTF, Priority, RR metrics + Gantt timelines)
- `run_synchronization` (bounded multi-threaded C++ `std::thread` / `std::mutex` / `std::condition_variable` lab: Producer-Consumer, Readers-Writers, Dining Philosophers in `safe` or `unsafe` mode)

---

## 5. Simulation Data Model Highlights

### Process (`ProcessStateModel`)
- `id` (`"P0"`, `"P1"`, ...), `name`, `arrival_time`, `burst_time`, `remaining_time`, `priority` (lower = higher or explicit convention, documented consistently as **lower integer = higher priority** with `1` highest, `10` lowest)
- `state`: `"NEW" | "READY" | "RUNNING" | "WAITING" | "BLOCKED" | "TERMINATED"`
- `max_demand`: `map<resource_id, int>`
- `allocated`: `map<resource_id, int>`
- `need`: `map<resource_id, int>` (derived invariant: `max_demand[r] - allocated[r]`)
- `pending_request`: `map<resource_id, int>`
- `city_position`: `{ x, y, z, plot_id }` (deterministic city grid slot assigned on creation so 3D positions remain stable across reloads)
- `termination_cost`: `int`, `preemption_count`: `int`, `history`: list of `{ tick, event, detail }`

### Resource (`ResourceTypeModel`)
- `id` (`"R0"`, `"R1"`, ...), `name` (e.g. `"Printer"`, `"DB Lock"`, `"GPU Core"`), `category` (`"IO" | "LOCK" | "COMPUTE" | "MEMORY" | "STORAGE"`)
- `total_instances`: `int`, `available_instances`: `int`, `allocated_instances`: `int`
- `preemptible`: `bool`
- `status`: `"AVAILABLE" | "ALLOCATED" | "REQUESTED" | "UNAVAILABLE"`
- `city_position`: `{ x, y, z, plot_id }`

### System Diagnostics & Analytics
- `safety_status`: `"SAFE" | "UNSAFE" | "DEADLOCKED"` (strict distinction: an `UNSAFE` state sets `deadlock_detected: false` unless a cycle/unfinishable blocked set exists)
- `deadlock_report`: `{ detected, deadlocked_processes, involved_resources, cycles, steps[], explanation }`
- `banker_report`: `{ is_safe, safe_sequence[], steps[], explanation }`
- `checkpoints`: bounded stack of valid prior `SimulationState` snapshots for rollback recovery
- `metrics_history`: per-tick array of `{ tick, utilization_pct, active_count, blocked_count, deadlocked_count, allocation_count }`
- `events`: timestamped/tick-stamped audit log (`allocation`, `request`, `rejection`, `deadlock`, `recovery`, `completion`)

---

## 6. Technical Risks & Mitigations

| Risk | Impact | Mitigation |
| :--- | :--- | :--- |
| **Offline / CMake FetchContent failure for `nlohmann/json` & `GoogleTest`** | Build fails in restricted network environments | Check system packages first; vendor or cache single-header `nlohmann/json.hpp` + local test fallback or pre-fetch into `engine/third_party` if FetchContent cannot reach GitHub. |
| **Subprocess latency on high-frequency ticks** | Slow UI updates during 4x simulation speed | Keep JSON state compact (bounded history/checkpoints), run `deadlock_engine` with `-O2` (sub-millisecond execution for <100 processes), and cap auto-tick loop cleanly. |
| **Synchronization Lab deadlocks hanging the backend** | C++ thread lab in `unsafe` mode could block forever | Enforce strict bounded iterations, timed mutex/CV waits (`wait_for`), and a hard backend subprocess timeout (`15s`) so no scenario can ever hang. |
| **Frontend/Backend/Engine state drift** | City shows stale ownership vs Graph/Banker's | Never mutate allocation state in React or Python; every user action calls REST -> C++ engine -> broadcasts canonical `state` over WebSocket/HTTP response to update the single Zustand store. |
| **Three.js / R3F WebGL performance or disposal leaks** | Frame drops or GPU memory growth | Use instanced background city blocks, memoized geometries/materials, minimal dynamic point lights, and clean unmount disposal. |
| **Multiple-instance RAG cycle misinterpretation** | False-positive deadlock alerts on multi-instance cycles | Visually highlight *cycles* in amber/dashed when multiple instances allow completion, and reserve red `DEADLOCKED` status strictly for processes identified by the C++ Work/Finish algorithm. |
