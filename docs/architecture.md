# Deadlock City — System Architecture

Deadlock City is organized into three strictly decoupled tiers: a React 18 + Three.js visualization client, a FastAPI orchestration server, and an authoritative C++17 simulation engine (`deadlock_engine`).

---

## 1. Architectural Rationale & Core Design Choices

### Why C++17 is the Authoritative Simulation Engine
All operating systems algorithms—Banker's safety checks, RAG/WFG cycle enumeration, multi-instance Wait/Finish detection, victim recovery, CPU scheduling simulations, and POSIX thread synchronization—reside strictly in compiled C++17 (`engine/src/`). Compiling to native machine code delivers deterministic seeded PRNG behavior (`std::mt19937`), strict compiler diagnostics (`-Wall -Wextra -Wpedantic`), low-millisecond execution (~`8.9 ms` process startup + IPC roundtrip), hardware-real `std::thread` / `std::mutex` / `std::condition_variable` execution in `SyncLab`, and full compatibility with C++ UndefinedBehaviorSanitizer, AddressSanitizer, and ThreadSanitizer. Neither Python nor TypeScript re-implements any OS decision logic.

### Why FastAPI is Used for Orchestration
FastAPI (`backend/app/`) provides non-blocking `asyncio` orchestration over the C++ CLI subprocess via Pydantic v2 schema validation, structured HTTP error translation (`400`, `404`, `409`, `413`, `422`, `503`, `504`), per-session locking and background auto-tick loops (`SessionManager`), multi-client `WebSocketHub` fanout, and CSV/JSON data formatting (`ExportService`).

### Why React, Three.js, React Flow, and Recharts are Used for Visualization
- **React 18 + TypeScript + Zustand**: Provides a predictable tactical HUD and single client store hydrated strictly from server responses and WebSocket `STATE_SYNC` messages.
- **Three.js / React Three Fiber / Drei**: Renders the procedural 3D industrial city (district blocks, process buildings, resource facilities, animated conduit arcs) smoothly at `60 FPS` with automatic **2D Tactical SVG Fallback** (`CityFallback2D`) when WebGL is disabled or unavailable.
- **React Flow (`@xyflow/react`)**: Displays interactive bipartite Resource Allocation Graphs and Wait-For Graph projections without duplicating cycle/deadlock math.
- **Recharts**: Renders 8 live telemetry time-series panels and accessible tabular alternatives over the bounded historical buffer.

---

## 2. Architecture & Lifecycle Diagrams

### 2.1 Overall System Architecture

```mermaid
flowchart TB
  subgraph Client["Frontend (React 18 + Vite + TypeScript)"]
    UI["Tactical HUD Shell & Modals"]
    City["3D City Canvas (R3F / Three.js) + 2D Fallback"]
    Labs["RAG Graph + Detection + Banker + Recovery + Sched + Sync"]
    Analytics["Analytics Command Center (Recharts)"]
    Store["Zustand Store + WSManager"]
  end

  subgraph Backend["Backend Orchestration (FastAPI + Uvicorn)"]
    MW["RequestBodySizeLimitMiddleware (1 MiB) + CORS + Origin Check"]
    API["REST Routers (/api/health, /simulation, /labs, /analytics)"]
    SM["SessionManager (Locks, LRU Idle Eviction, Auto-Tick)"]
    Hub["WebSocketHub (/ws/simulation/{id})"]
    Exp["ExportService (JSON / CSV)"]
    Bridge["EngineBridge (Subprocess + Timeout + Semaphore)"]
  end

  subgraph Engine["Core C++17 Engine (deadlock_engine)"]
    CLI["JSON-STDIO Dispatcher (main.cpp)"]
    SE["SimulationEngine (Tick, Seeded PRNG, Presets)"]
    Alg["BankersAlgorithm + DeadlockDetector + RecoveryManager"]
    Sched["CPUScheduler + SyncLab (std::thread)"]
  end

  UI --> Store
  City --> Store
  Labs --> Store
  Analytics --> Store
  Store -- "HTTP/JSON" --> MW
  Store <-- "WS STATE_SYNC / PONG" --> Hub
  MW --> API --> SM --> Bridge
  SM --> Hub
  API --> Exp
  Bridge -- "stdin/stdout JSON" --> CLI --> SE --> Alg
  CLI --> Sched
```

### 2.2 Frontend, Backend, and C++ Communication

```mermaid
flowchart LR
  ReactUI["React Component Action"] --> ApiClient["Typed apiClient (fetch + AbortController)"]
  ApiClient -- "POST /api/simulation/{id}/request" --> FastAPI["FastAPI Router + Pydantic v2"]
  FastAPI --> SessionMgr["SessionManager._get_record(id) + async with rec.lock"]
  SessionMgr --> Bridge["EngineBridge.execute(..., payload)"]
  Bridge -- "async with asyncio.Semaphore(8)" --> Proc["deadlock_engine --json-stdio"]
  Proc -- "Canonical SimulationState + result" --> Bridge
  Bridge --> SessionMgr
  SessionMgr -- "STATE_SYNC broadcast" --> WSHub["WebSocketHub"]
  SessionMgr -- "HTTP 200 or 409 + state" --> ApiClient
  WSHub -- "WS JSON frame" --> WSManager["SimulationWebSocketManager"]
  WSManager --> Zustand["useSimulationStore (seq check)"]
  ApiClient --> Zustand
```

### 2.3 JSON IPC Request-Response Lifecycle

```mermaid
sequenceDiagram
  participant SM as SessionManager
  participant EB as EngineBridge
  participant OS as OS Subprocess (deadlock_engine --json-stdio)
  participant SE as SimulationEngine (C++17)

  SM->>EB: execute(command, state, payload)
  EB->>EB: _ensure_binary() & acquire Semaphore(8)
  EB->>OS: create_subprocess_exec (no shell)
  EB->>OS: write stdin JSON {command, state, payload}
  OS->>SE: dispatch command + reconstruct state
  SE-->>OS: JSON response {ok, command, error, state, result}
  alt Timeout exceeded (5s default / 15s sync)
    EB->>OS: proc.kill() + wait()
    EB-->>SM: raise EngineTimeoutError (HTTP 504)
  else Non-zero exit or invalid JSON
    EB-->>SM: raise EngineBridgeError (HTTP 500)
  else Domain error ok=false (e.g., DEADLOCK_UNRESOLVED)
    OS-->>EB: exit 0 with ok=false, error, optional mutated state
    EB-->>SM: raise EngineDomainError (400 / 404 / 409)
  else Success ok=true
    OS-->>EB: exit 0 JSON envelope
    EB-->>SM: return updated state + result
  end
```

### 2.4 WebSocket Synchronization & Stale Snapshot Protection

```mermaid
sequenceDiagram
  participant UI as React / Zustand Store
  participant WSM as SimulationWebSocketManager
  participant FastAPI as FastAPI WS Endpoint
  participant SM as SessionManager

  UI->>WSM: connect(sessionId)
  WSM->>FastAPI: WS Connect /ws/simulation/{id}
  FastAPI->>FastAPI: Validate Origin against local regex + ALLOWED_ORIGINS
  alt Untrusted Origin
    FastAPI-->>WSM: Close 1008 (Policy Violation)
  else Missing Session
    FastAPI-->>WSM: ERROR + Close 4404 (no reconnect)
  else Connected
    FastAPI->>SM: get_state(session_id)
    FastAPI-->>WSM: Initial STATE_SYNC {state, runtime: {seq, speed, is_running}}
    loop Every 20s heartbeat
      WSM->>FastAPI: {"type": "PING"}
      FastAPI-->>WSM: {"type": "PONG"}
    end
    loop Auto-tick or REST mutation
      SM->>FastAPI: _broadcast_locked -> STATE_SYNC (seq = seq + 1)
      FastAPI-->>WSM: STATE_SYNC
      WSM->>UI: handleWsMessage(msg)
      UI->>UI: Reject if incomingSeq < latestSeq
    end
  end
```

### 2.5 Simulation Session Lifecycle & Auto-Tick Loop

```mermaid
stateDiagram-v2
  [*] --> Created: POST /create (or LRU evict idle slot if max=100)
  Created --> Idle: seq=1, is_running=false
  Idle --> Running: POST /start or /resume (spawn _auto_tick_loop)
  Running --> Idle: POST /pause or /stop (cancel runner task)
  Running --> HaltedDeadlock: step_simulation -> safety_status == DEADLOCKED
  Running --> HaltedComplete: All processes TERMINATED
  HaltedDeadlock --> Idle: Auto-pause & WS broadcast
  HaltedComplete --> Idle: Auto-pause & WS broadcast
  Idle --> Idle: /step, /request, /recovery, /reset, /workload/random
  Idle --> Evicted: LRU idle eviction when >= DEADLOCK_MAX_SESSIONS
```

### 2.6 Resource Request Processing (`use_banker` ON vs. OFF)

```mermaid
flowchart TD
  Req["POST /api/simulation/{id}/request (pid, request, use_banker)"] --> Cpp["BankersAlgorithm::evaluate_request (C++17)"]
  Cpp --> Valid{"Process active, qty <= 1000000, cumReq <= Need?"}
  Valid -- "No" --> Err["ok=false (400/404) + log REJECTION"]
  Valid -- "Yes" --> Avail{"request <= Available?"}
  Avail -- "No" --> Block["Process -> BLOCKED, update pending_request, ok=true, granted=false"]
  Avail -- "Yes" --> BankerFlag{"use_banker == true?"}
  BankerFlag -- "No (Immediate)" --> Commit["Grant resources, re-run Banker check + DeadlockDetector"]
  BankerFlag -- "Yes" --> Trial["Tentatively allocate & run check_safety()"]
  Trial --> Safe{"Safe sequence exists?"}
  Safe -- "Yes" --> Commit
  Safe -- "No" --> Rollback["Roll back tentative allocation, mark BLOCKED or rejected, granted=false"]
  Commit --> Done["Return updated canonical SimulationState"]
  Block --> Done
  Rollback --> Done
```

### 2.7 Deadlock Detection & Recovery Lifecycle

```mermaid
flowchart TD
  Detect["DeadlockDetector::detect(state)"] --> Cycles["1. Find RAG Cycles via start_node enumeration (find_rag_cycles)"]
  Cycles --> WF["2. Run Multi-Instance Work/Finish Reduction"]
  WF --> Classify{"Unfinished blocked processes > 0?"}
  Classify -- "No" --> Clear["deadlocked = false; has_cycle_in_rag distinguishes multi-unit safe cycle"]
  Classify -- "Yes" --> Deadlocked["safety_status = DEADLOCKED; populate deadlocked_processes & wait_for_edges"]
  Deadlocked --> Rec["POST /recovery (terminate_all | terminate_victim | preempt_resource | rollback)"]
  Rec --> RM["RecoveryManager mutates processes/resources & re-runs DeadlockDetector"]
  RM --> Resolved{"deadlock_report.detected == false?"}
  Resolved -- "Yes" --> HTTP200["Return HTTP 200 + updated SAFE/UNSAFE state"]
  Resolved -- "No (Partial Recovery)" --> HTTP409["Update SessionManager rec.state + seq, broadcast WS, return HTTP 409 DEADLOCK_UNRESOLVED with updated state"]
```

### 2.8 Isolated Comparative Experiment Execution

```mermaid
sequenceDiagram
  participant User as Frontend Analytics UI
  participant API as FastAPI /api/experiments/compare
  participant Engine as EngineBridge (Stateless C++ Invocations)
  participant Active as Active User Session

  Note over Active: Remains untouched throughout comparison
  User->>API: POST /experiments/compare {mode, preset, seed, params}
  alt mode == avoidance
    API->>Engine: load_preset(preset, seed) -> base_state
    API->>Engine: request_resources(use_banker=true) -> Arm A
    API->>Engine: request_resources(use_banker=false) -> Arm B
  else mode == recovery
    API->>Engine: recover_deadlock across 4 strategies on clean base_state
  else mode == scheduling
    API->>Engine: compare_scheduling across FCFS/SJF/SRTF/Priority/RR
  else mode == synchronization
    API->>Engine: run_synchronization in safe and unsafe modes
  end
  API-->>User: Comparison arms + expectations
```

### 2.9 Docker Deployment Architecture

```mermaid
flowchart LR
  Browser["User Browser (http://localhost:8080)"] --> Nginx["frontend container (nginx:1.27-alpine, non-root, :8080)"]
  Nginx -- "Static SPA assets (/)" --> Bundle["dist/ (Vite + Three.js chunks)"]
  Nginx -- "HTTP proxy (/api/*)" --> Backend["backend container (python:3.12-slim, non-root appuser, internal :8000)"]
  Nginx -- "WebSocket Upgrade (/ws/*)" --> Backend
  Backend -- "exec /app/bin/deadlock_engine" --> CppBin["Compiled C++17 Binary (from debian:bookworm-slim stage)"]
```

---

## 3. State Consistency, Concurrency & Safety Mechanisms

1. **Canonical Simulation State**: Python stores the full `SimulationState` JSON dictionary per session ID (`SessionRecord.state`) and stamps UTC ISO timestamps onto metrics and events (`_stamp_session_timestamps`). Every C++ mutation accepts the previous state JSON, mutates deterministically, trims `metrics_history` to `240` samples and `events` to `200` records while preserving monotonic `total_metric_samples_recorded` and `total_events_recorded`, and returns the authoritative replacement snapshot.
2. **Session Isolation**: Each session gets a unique `sim_<8hex>` identifier and its own `SessionRecord` with dedicated `asyncio.Lock`, `runner_task`, `wakeup_event`, and sequence counter `seq`. Isolated comparative experiments execute directly against `EngineBridge` without touching `SessionManager._sessions`. `SessionManager` caps live storage (`DEADLOCK_MAX_SESSIONS=100`) and evicts only least-recently-used **idle** sessions (`not is_running`, `0` active WebSocket connections, unlocked).
3. **Concurrent Mutation Synchronization**: Every HTTP endpoint mutating session `{id}` and every background `_auto_tick_loop` iteration acquires `async with rec.lock` before invoking `EngineBridge.execute(...)` or updating `rec.state`. Thus auto-ticks and manual user requests (`step`, `request`, `recovery`, `reset`) are strictly serialized per session.
4. **Subprocess Lifecycle & Safety**: `EngineBridge` never invokes a shell (`create_subprocess_exec`), guards concurrent spawns with `asyncio.Semaphore(DEADLOCK_MAX_ENGINE_CONCURRENCY=8)`, enforces wall-clock timeouts (`5.0s` simulation, `15.0s` `run_synchronization`), kills + reaps timed-out subprocesses cleanly, and translates domain errors (`400`, `404`, `409`) separately from crash/timeout failures (`500`, `504`). Even when `DEADLOCK_UNRESOLVED` (`409`) occurs after partial victim termination, `SessionManager` persists `exc.state`, bumps `rec.seq`, broadcasts `STATE_SYNC`, and returns updated `state`/`result` in the `409` body.
5. **Stale Frontend Snapshot Rejection**: FastAPI increments monotonic `rec.seq` on every state change (REST responses embed `result.runtime.seq` and WebSocket frames embed `runtime.seq`). Both `applyEnvelope` and `handleWsMessage` in `useSimulationStore.ts` discard incoming snapshots within the same session if `incomingSeq < latestSeq`, preventing slower out-of-order HTTP responses from overwriting newer WebSocket ticks.
