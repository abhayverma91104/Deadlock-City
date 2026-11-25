# Deadlock City — Technical Viva Examination Guide

**64 grounded viva questions and model answers** aligned strictly with the Deadlock City codebase.

---

## Section A: Operating Systems & Process Management (Q1–Q10)

1. **What distinguishes Deadlock City from a real operating system kernel?**  
   Deadlock City is a discrete-tick **simulator** backed by compiled C++17 data structures and user-space POSIX thread demos (`SyncLab`). It models PCBs, CPU schedulers, Resource Allocation Graphs, Banker's safety, deadlock detection/recovery, and synchronization problems, without hardware interrupts, page tables, disk I/O scheduling, or file systems.
2. **Which process states exist in Deadlock City and how are transitions triggered?**  
   Six states (`NEW`, `READY`, `RUNNING`, `WAITING`, `BLOCKED`, `TERMINATED`). `NEW` promotes to `READY` when `arrival_time <= tick`; `RUNNING` decrements `remaining_time` until `0` (`TERMINATED`); unsatisfied requests set `BLOCKED`; manual suspend moves non-terminated processes to `WAITING`.
3. **What invariants connect `Max`, `Allocated`, and `Need`?**  
   For every active process $i$ and resource $j$, `Need[i][j] = max(0, Max[i][j] - Allocated[i][j])`. `Available[j] + sum(Allocated[i][j]) == total_instances[j]`.
4. **How is Priority represented in `ProcessManager` and `CPUScheduler`?**  
   Integer `priority` range `1..10`, where **lower numerical value equals higher priority** (`1` is highest priority, `10` lowest), enforced consistently across ticks, priority victim recovery, and `CPUScheduler`.
5. **What happens to allocated resources when a process finishes or is terminated early?**  
   Both natural completion (`remaining_time == 0`) and manual/recovery termination return every held `allocated[r]` unit back to `ResourceManager.available_instances`, clearing `allocated` and `pending_request`.
6. **What entity limits exist in the simulation engine and why?**  
   Capped at `24` processes and `12` resource types (`1..64` total instances) via `PROCESS_LIMIT_EXCEEDED` and `RESOURCE_LIMIT_EXCEEDED`, bounding $O(|P|^2 \cdot |R|)$ algorithm cost, 3D city geometry plot count, and IPC JSON size.
7. **How does `waiting_ticks` accumulate?**  
   Each simulation step increments `waiting_ticks` on active `BLOCKED` or `WAITING` processes so analytics `avg_waiting_ticks` reflects genuine contention delay.
8. **Why do processes store deterministic `city_position` coordinates?**  
   Each entity receives a fixed `plot_id` and `(x, y, z)` upon creation in C++ so reloading a session, stepping ticks, or refreshing the browser never scrambles 3D building placements.
9. **What is the difference between `WAITING` and `BLOCKED` in this simulator?**  
   `BLOCKED` occurs when a process awaits an unavailable or Banker-deferred resource request (`pending_request > 0`); `WAITING` represents a manually suspended process paused from execution via `/suspend`.
10. **How does deterministic seeding work across presets and random workloads?**  
    Preset generators and `generate_random_workload` seed `std::mt19937` from `req.seed`, producing identical initial processes, demands, allocations, and positions for identical `(preset, seed)` inputs (`SimulationEngineIPCTest.DeterministicSeedAndStateRoundTrip`).

---

## Section B: Deadlock Theory, Detection & Banker's Algorithm (Q11–Q26)

11. **What are Coffman's four necessary conditions for deadlock?**  
    Mutual Exclusion, Hold and Wait, No Preemption, and Circular Wait. Breaking any single condition prevents circular deadlock.
12. **Why does a cycle in a Resource Allocation Graph (RAG) NOT always imply deadlock?** *(Examiner Favorite)*  
    In a **multi-instance** resource pool, a cycle in the RAG (`multi_instance_safe_cycle`) is necessary **but not sufficient** for deadlock: another unblocked holder can finish, release instances back into `Work`, and satisfy the blocked edge in the cycle. Only when every instance is exhausted across an unfinishable cycle (`DeadlockDetector::detect` returns `detected = true`) is it a true deadlock.
13. **Why is an `UNSAFE` state not necessarily deadlocked?** *(Examiner Favorite)*  
    `UNSAFE` (from `BankersAlgorithm::check_safety`) only means *worst-case future max demands* could trap the system (`no safe completion sequence assuming every process immediately requests full remaining Need`). However, if processes currently have `pending_request == 0` or ask for fewer units right now (`unsafe_no_deadlock` preset), nobody is deadlocked today.
14. **How do Banker's Algorithm and Multi-Instance Deadlock Detection differ computationally?**  
    Both run $O(|P|^2 \cdot |R|)$ `Work`/`Finish` loops, but **Banker's** checks whether processes can finish assuming full remaining `Need = Max - Allocated`, whereas **Detection** checks whether processes can finish given only current `pending_request` vectors.
15. **How does `DeadlockDetector::find_rag_cycles` avoid missing overlapping cycles?**  
    Instead of pruning globally with a shared visited set (which hides secondary cycles sharing a node with an earlier cycle), it performs Johnson-style canonical enumeration where each DFS starting from `start_node` visits only vertices `v >= start_node`, bounded by `kMaxCycles = 32` and `10,000` expansions.
16. **What is the Wait-For Graph (WFG) and how is it derived?**  
    The WFG eliminates resource vertices by creating directed edge `P_wait -> P_holder` whenever `P_wait` has `pending_request[r] > 0` on resource `r` and `P_holder` holds `allocated[r] > 0`.
17. **What happens during a hypothetical Banker check (`use_banker` preview)?**  
    The client calls `/api/simulation/{id}/banker/check` with `process_id` + `hypothetical_request`; C++ evaluates safety on a temporary copy and returns `would_approve` + `steps[]` **without modifying `Allocation`, `Available`, or canonical state**.
18. **How does Banker's evaluate a request when `request > Need` or cumulative requests overflow?**  
    `BankersAlgorithm::evaluate_request` rejects `qty < 0` or `qty > 1000000` cleanly, checks `req_qty + pending_request[r] <= need[r]`, and returns `REQUEST_EXCEEDS_NEED` (`ok=false`, HTTP `400`).
19. **What happens if a request satisfies `Need` and `Banker's` is turned OFF (`use_banker: false`)?**  
    If units are `Available`, C++ allocates immediately without checking safety, which can intentionally move `classic_banker_safe` from `SAFE` into `UNSAFE` or `DEADLOCKED` (demonstrated in Comparative Engine `avoidance` mode).
20. **How are `SAFE`, `UNSAFE`, and `DEADLOCKED` differentiated visually in Deadlock City?**  
    - `SAFE`: Cyan/emerald buildings & status banner, healthy cyan conduits.  
    - `UNSAFE`: Amber alert banner, amber buildings when unsafe without cycle deadlock.  
    - `DEADLOCKED`: Crimson pulsing buildings, thick pulsing red conduits, red Deadlock Alert banner (`Has Cycle` without deadlock in multi-instance RAG stays amber dashed).
21. **Compare `terminate_victim`, `terminate_all`, `preempt_resource`, and `rollback` recovery.**  
    - `terminate_victim`: Terminates 1 deadlocked process selected via 4 cost/priority/work heuristics.  
    - `terminate_all`: Immediately terminates every process in `deadlocked_processes`.  
    - `preempt_resource`: Strips only `preemptible == true` units cleanly from holders without killing them (`preemption_count++`).  
    - `rollback`: Restores an entire saved safe `SimulationState` snapshot from `checkpoints[]`.
22. **What happens if `terminate_victim` breaks one cycle, leaving a second disjoint deadlock cycle intact?** *(Partial Recovery)*  
    `RecoveryManager` re-runs `DeadlockDetector::detect` after recovery; because `detected == true` still holds, it sets `res.ok = false`, `error_code = "DEADLOCK_UNRESOLVED"` alongside the mutated state. `SessionManager` persists the partial mutation, increments `seq`, broadcasts `STATE_SYNC`, and FastAPI returns **HTTP `409`** with the updated state so UI and backend stay synced.
23. **Why cannot `preempt_resource` fix a DB-lock deadlock (`single_instance_deadlock`)?**  
    Because database locks have `preemptible = false`; attempting preemption returns HTTP `409 RESOURCE_NOT_PREEMPTIBLE` / `NO_PREEMPTIBLE_RESOURCE` cleanly.
24. **How does checkpoint rollback preserve resource consistency?** *(Examiner Question)*  
    `create_checkpoint` serializes a deep snapshot of all processes (`allocated`, `need`, `pending_request`, `state`), resource counts (`available_instances`, `allocated_instances`), and counters at a clean tick. On `rollback`, `RecoveryManager` atomically replaces the live `processes` and `resources` vectors from `checkpoints[checkpoint_index]` and re-computes `DeadlockDetector` and `BankersAlgorithm` reports, preventing half-rolled-back allocations.
25. **Why does `RecoveryManagerTest` require at least two disjoint cycles to trigger `DEADLOCK_UNRESOLVED`?**  
    Removing a single process from a single cycle always breaks that cycle cleanly; only independent disjoint cycles or non-preemptible holds leave `deadlocked_processes` non-empty after 1 partial operation.
26. **Can Deadlock City guarantee starvation-free scheduling during normal ticks?**  
    No: `resource_starvation` intentionally models low-priority or large-demand contention waiting behind higher-priority holders (`waiting_ticks` grows each tick), demonstrating starvation vs. deadlock.

---

## Section C: CPU Scheduling & Multithreaded Synchronization (Q27–Q38)

27. **Which 5 CPU scheduling algorithms are implemented in `CPUScheduler`?**  
    `FCFS`, `SJF` (non-preemptive), `SRTF` (preemptive 1-tick), Non-preemptive `PRIORITY`, and `Round Robin` (`quantum`).
28. **How does `CPUScheduler` handle arrival gaps (`arrival_time > current_time`)?**  
    If no arrived process is ready while future arrivals remain, the scheduler emits an explicit `process_id = "IDLE"` Gantt segment up to the next earliest arrival, reducing `cpu_utilization_pct` accordingly.
29. **What tie-breaking rule resolves equal burst/priority/arrival times?**  
    Smallest `priority` / `burst` -> earliest `arrival_time` -> lexicographical `id` (`InvalidInputsSingleProcessAndEqualPriorityTieBreak`).
30. **In Round Robin (`RR`), when two processes finish/arrive on the exact same tick `t`, which goes first?**  
    New arrivals at `arrival_time <= t` are pushed onto the ready FIFO **before** re-queueing a process whose quantum just expired at tick `t`, matching standard OS textbook conventions (`CPUScheduler.cpp`).
31. **How are real OS threads exercised in `SyncLab`?**  
    `SyncLab.cpp` spawns genuine `std::thread` workers (`2 producers + 2 consumers`, `3 readers + 2 writers`, `5 dining philosophers`) coordinated by real C++ `std::mutex`, `std::condition_variable`, and `std::atomic<int>` counters.
32. **How are synchronization events recorded safely without corrupting memory across threads?** *(Examiner Question)*  
    A dedicated `log_mtx` (`std::mutex`) serializes insertions into `report.events` (capped at `240`) and `report.logs`, with monotonic atomic sequence IDs (`std::atomic<int> seq`), recording occupancy, active readers/writers, and fork ownership arrays safely.
33. **How are unsafe experiments demonstrated without causing uncontrolled undefined behavior or backend hangs?** *(Examiner Question)*  
    - In `Producer-Consumer` and `Readers-Writers`, `unsafe` mode removes mutex locks around atomic logical occupancy/active-thread counters (`std::atomic<int>`) rather than unsynchronized non-atomic pointer mutations, isolating race observations (capacity overflows/underflows, RW critical-section collisions) cleanly without crashing memory.  
    - In `Dining Philosophers`, `unsafe` acquires `left` then `right` using bounded `TimedForkGuard` timeouts (`15 ms`), exposing circular wait (`TIMEOUT`) cleanly without wedging the process permanently.
34. **Why does Safe Dining Philosophers in `SyncLab` never deadlock?**  
    Every philosopher requests `first = min(left, right)` before `second = max(left, right)` (total resource ordering), breaking Coffman's 4th condition (Circular Wait).
35. **Why did we replace `std::timed_mutex` with `TimedFork` (`std::mutex` + `std::condition_variable`) in `SyncLab.cpp`?**  
    On Linux glibc 2.39 + GCC 13, `std::timed_mutex::try_lock_for` lowered to `pthread_mutex_clocklock`, which `libtsan2` did not intercept, causing false-positive "unlock of an unlocked mutex" warnings. Our `TimedFork` monitor fixed TSan to **0 warnings** across 10/10 runs cleanly.
36. **Why does `wait_for` in `run_readers_writers` SAFE mode check its boolean return before modifying `active_readers`/`active_writers`?**  
    To prevent timeout fallthroughs from mutating shared state (`shared_data`, counters) without owning `rw_mtx`—a real CV-timeout race caught and fixed during the Phase 8A audit.
37. **Does Deadlock City use POSIX semaphores (`sem_t`)?**  
    No. All synchronization in `SyncLab` uses C++17 standard library mutexes, condition variables, and atomics.
38. **Can `CPUScheduler` or `SyncLab` mutate the live 3D City session?**  
    No; `/api/scheduling/compare` and `/api/synchronization/run` operate independently of `SessionManager._sessions`.

---

## Section D: C++17 Architecture, FastAPI, IPC & Concurrency (Q39–Q52)

39. **Why use C++17 instead of implementing Banker's and Detection directly in Python?** *(Examiner Question)*  
    To eliminate runtime drift across tiers, run real POSIX `std::thread` synchronization (`SyncLab`) unencumbered by Python's GIL, catch memory/thread bugs via ASan/UBSan/TSan, and provide deterministic native performance (`~8.9 ms` binary invocation, `< 1 ms` internal unit test execution).
40. **Why is the C++ engine the single source of truth?** *(Examiner Question)*  
    If UI or Python computed safe sequences or RAG cycles independently, subtle tie-break or edge-case mismatches (e.g. multi-instance cycles vs. deadlocks, cumulative pending checks) would diverge between the 3D city, React Flow, and Analytics KPIs.
41. **Why does the project use `--json-stdio` subprocess IPC instead of Python C-extensions (`pybind11`) or a resident socket daemon?** *(Examiner Question)*  
    Subprocess IPC enforces complete fault isolation—a bug or timeout inside an experimental thread run cannot crash FastAPI's event loop or corrupt other sessions—requires zero ABI/compiler coupling in Python virtualenvs, and avoids shell injection (`create_subprocess_exec` with argument array). Trade-off: `~9–33 ms` process spawn cost per call.
42. **What happens if `deadlock_engine` crashes, outputs invalid JSON, or hangs?** *(Examiner Question)*  
    - Hang: `EngineBridge` cancels `asyncio.wait_for` after `5.0s` (`15.0s` for `run_synchronization`), executes `proc.kill()` + `await proc.wait()`, and raises `504 ENGINE_TIMEOUT`.  
    - Non-zero exit / empty output / invalid JSON: Raises `500 ENGINE_PROCESS_FAILED` / `ENGINE_MALFORMED_JSON` cleanly while leaving the session's previous `rec.state` untouched.
43. **How does the system prevent concurrent state corruption between auto-tick and user HTTP actions?** *(Examiner Question)*  
    Each `SessionRecord` owns a per-session `asyncio.Lock`. Both `_auto_tick_loop` iterations and REST endpoints acquire `async with rec.lock:` before executing `EngineBridge` and mutating `rec.state` or broadcasting over WebSockets.
44. **What prevents a surge of concurrent requests from causing a C++ fork storm?**  
    `EngineBridge` bounds simultaneous subprocess spawns with `asyncio.Semaphore(DEADLOCK_MAX_ENGINE_CONCURRENCY=8)`, and `SessionManager` caps active stored sessions (`DEADLOCK_MAX_SESSIONS=100`).
45. **How does LRU session eviction protect active experiments?**  
    `_evict_idle_session_if_needed()` only evicts sessions where `not rec.is_running`, `ws_hub.connection_count(sid) == 0`, and `not rec.lock.locked()`. If all 100 sessions are busy/connected, new creations fail safely with `503 SESSION_LIMIT_REACHED`.
46. **How is WebSocket security handled?**  
    FastAPI validates the WebSocket handshake `Origin` header against `ALLOWED_ORIGINS` and local dev regex before `ws_hub.connect()`, closing untrusted cross-origin requests with WebSocket code `1008` (Policy Violation).
47. **How is telemetry memory bounded across long-running simulations?**  
    C++ caps `metrics_history` at `240` samples and `events` at `200` entries while incrementing monotonic `total_metric_samples_recorded` and `total_events_recorded`. Over a `610s` run, backend RSS settled at `40.92 MB` and open FDs stayed `60 -> 61`.
48. **Why does `ExportService` compute timestamps in Python (`_stamp_session_timestamps`)?**  
    Keeping C++ deterministic across seeded runs avoids embedding wall-clock `std::chrono::system_clock` strings inside C++ test snapshots while still giving exported CSVs and Recharts `recorded_at` UTC timestamps.
49. **How do stale REST responses fail to overwrite newer WebSocket updates in React?**  
    FastAPI increments monotonic `rec.seq` on every state change. Zustand (`useSimulationStore`) stores `latestSeq` and drops any `STATE_SYNC` or REST envelope for the active session whose `incomingSeq < latestSeq`.
50. **What prevents large JSON payloads from exhausting backend memory?**  
    `RequestBodySizeLimitMiddleware` rejects HTTP bodies exceeding `1 MiB` (`MAX_REQUEST_BODY_BYTES=1048576`) by both `Content-Length` and chunked receive byte counting with `413 PAYLOAD_TOO_LARGE`.
51. **What are the main scalability limitations of this architecture?** *(Examiner Question)*  
    In-memory Python session storage (lost on backend restart; single-worker Uvicorn process required unless using shared store) and subprocess spawn latency (`~9–33 ms` per command), suitable for local classrooms/labs rather than high-throughput multi-node cloud clustering.
52. **Why does `create_simulation` default cleanly to `preset: "normal_workload"` in the UI?**  
    So first-time users immediately land on a live interactive 4-process, 3-resource safe city rather than an empty grid.

---

## Section E: React, Three.js, Sanitizers, Testing & Deployment (Q53–Q64)

53. **How does Three.js (`@react-three/fiber`) avoid memory/GPU leaks and frame drops?**  
    Instanced background city geometry (`CityInfrastructure`), shared memoized `SphereGeometry` with explicit `.dispose()` cleanup (`ResourceConduits`), graphics quality presets (`LOW`/`MED`/`HIGH`), and route-based `React.lazy()` code splitting—maintaining `60.0 FPS` across 10+ minutes (`41.15 -> 46.20 MB` JS heap).
54. **What happens if the user opens Deadlock City on a machine without WebGL or with hardware acceleration disabled?**  
    `CityCanvasViewport` runs `isWebGLAvailable()` and wraps `<Canvas>` in `WebGLErrorBoundary` + `webglcontextlost` listeners, automatically switching cleanly to the interactive SVG `CityFallback2D` tactical map.
55. **How did you fix the Vite/Rollup `Circular chunk` and oversized chunk warnings?**  
    Replacing the coarse manual chunk map in `vite.config.ts` with function-based splitting (`three_core`, `three_react`, `charts_vendor`, `xyflow_vendor`, `react_vendor`, `ui_vendor`) cut `three_vendor` (`997 kB`) down to `683.4 kB` (`three_core`) with zero circular dependencies.
56. **How does `prefers-reduced-motion` work across the app?**  
    `App.tsx` wraps the root in `<MotionConfig reducedMotion="user">`, CSS pulses use `@media (prefers-reduced-motion: no-preference)`, and 3D camera/packet animations inspect `matchMedia('(prefers-reduced-motion: reduce)')`.
57. **Why did you run Linux Docker sanitizers when testing on macOS Apple Silicon?**  
    On Darwin 25.5 (`AppleClang 17.0.0`), UBSan runs natively cleanly (`24/24` passed), whereas AppleClang ASan hangs at startup and TSan segfaults `139`. Running `ubuntu:24.04` (`g++ 13.3`) Docker containers verified real ARM64 Linux ASan+UBSan and TSan cleanly (`24/24` + `10/10` SyncLab repeats, 0 warnings).
58. **How is the Docker Compose deployment hardened cleanly?**  
    Multi-stage Dockerfiles compile C++ in `debian:bookworm-slim` / frontend in `node:20-alpine` and copy only runtime artifacts into non-root runtime containers (`appuser` in Python 3.12, `nginx` on port `8080`), connected over internal Docker network (`depends_on: condition: service_healthy`) with Nginx WebSocket `Upgrade` proxying.
59. **Why did `scripts/setup.sh` need `(cd "$ROOT_DIR/frontend" && npm ci)` instead of `--prefix`?**  
    Using `npm --prefix "<path>/frontend" ci` failed with `Missing: frontend@1.0.0 from lock file` (npm `--prefix` mismatch vs directory basename), uncovered and fixed during clean-directory (`/tmp/deadlock city clean test`) verification.
60. **How does browser page reload preserve the user's running scenario?**  
    `useSimulationStore` persists `deadlock_city_session_id` in `window.localStorage` and calls `GET /api/simulation/{id}/state` on startup, falling back to creating a fresh session only if the stored session ID returns `404`.
61. **What happens in the UI if FastAPI stops and restarts?**  
    `SimulationWebSocketManager` drops from `CONNECTED` to `RECONNECTING`/`DISCONNECTED` with exponential backoff up to `8` tries without throwing unhandled exceptions, allowing immediate health/session recovery once backend restarts.
62. **How are destructive actions in Recovery Center protected against accidental clicks?**  
    Submitting a recovery strategy opens an accessible `<NativeDialog>` modal displaying target details and warning text (`Confirm Recovery Operation`) before sending `POST /recovery`.
63. **What test suites verify Deadlock City before release?**  
    `24` C++ GoogleTests (`CTest`), `15` FastAPI `Pytest` integration tests, `23` `Vitest` UI/store tests, `ESLint`, strict `tsc -b`, Vite build, `20` Playwright browser workflows, `610s` sustained stress test, clean-install `/tmp` script run, and `docker compose` end-to-end health + WS checks.
64. **Why does Deadlock City disclose discarded telemetry samples in Analytics and CSVs?**  
    Because bounded sliding buffers retain only the latest `240` metrics / `200` events, explicitly displaying `total_metric_samples_recorded` and `retained_tick_range` ensures experimental reports never misrepresent windowed traces as complete infinite logs.
