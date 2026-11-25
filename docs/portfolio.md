# Deadlock City — Portfolio & Resume Kit

---

## 1. One-Line Project Description

Interactive 3D Operating Systems laboratory and discrete-tick deadlock simulation platform combining a compiled **C++17 engine**, **FastAPI** WebSocket orchestration, and a **React + Three.js** tactical HUD.

## 2. Short GitHub Repository Description

> Interactive 3D OS resource management, Banker's safety, multi-instance deadlock detection/recovery, CPU scheduling, and multithreaded C++ synchronization workbench powered by C++17, FastAPI, WebSockets, Three.js, React Flow, and Recharts.

---

## 3. Resume Bullet Points

- **Architected a deterministic three-tier OS simulation platform** separating a compiled **C++17 engine** (`BankersAlgorithm`, `DeadlockDetector`, `RecoveryManager`, `CPUScheduler`, `std::thread` `SyncLab`) from a **FastAPI WebSocket server** and a **React / Three.js (R3F) + React Flow** UI via bounded `--json-stdio` subprocess IPC, maintaining a single source of truth across 3D visuals, graph topologies, and telemetry charts.
- **Hardened correctness, concurrency safety, and reliability** using **Linux GCC ASan/UBSan & ThreadSanitizer** (`24/24` C++ GoogleTests + `10/10` synchronization loops warning-free), per-session `asyncio.Lock` serialization, monotonic snapshot sequence gating, HTTP `1 MiB` body & concurrency (`Semaphore(8)`) caps, LRU idle session eviction, and `409 DEADLOCK_UNRESOLVED` partial-recovery synchronization.
- **Benchmarked and containerized full-stack delivery**, reducing Vite production chunk sizes (`997 kB` -> `683 kB` core Three.js split with zero circular chunk warnings) while sustaining **`60.0 FPS`** (`59.5 FPS` p5), steady JS heap (`41.15 -> 46.20 MB`), and stable backend RSS (`40.92 MB`) over a continuous **610-second multi-session stress run**, packaged via multi-stage **Docker Compose** (non-root backend & Nginx reverse proxy).

---

## 4. Detailed Portfolio Summary

**Deadlock City** turns abstract fifth-semester Operating Systems mechanisms into a spatial, inspectable simulation environment without compromising algorithmic rigor. Rather than writing toy browser animations in JavaScript, every process transition, resource vector update, Banker's `Need = Max - Allocated` check, Work/Finish cycle detection trace, victim selection rule, CPU Gantt interval, and thread synchronization event is calculated inside an isolated **C++17 binary (`deadlock_engine`)**.

A typed **FastAPI** orchestration layer manages isolated simulation sessions in memory (`SessionManager`), spawns bounded no-shell subprocesses (`EngineBridge`) protected by concurrency semaphores and timeouts, streams canonical snapshots to clients over **WebSockets**, and produces structured CSV/JSON datasets. On the client, **Three.js / React Three Fiber** renders process buildings, resource facilities, and animated conduits cleanly at 60 FPS (with a built-in **2D Tactical SVG Fallback** for non-WebGL or reduced-motion environments), while **React Flow** and **Recharts** expose interactive bipartite RAG/WFG projections and 8 synchronized historical telemetry charts.

---

## 5. Key Engineering Challenges & Verified Solutions

| Challenge | Solution Implemented |
| :--- | :--- |
| **Overlapping Cycle Pruning** | Replaced global visited pruning in `DeadlockDetector::find_rag_cycles` with Johnson-style `start_node` enumeration (`kMaxCycles=32`, bounded expansion guard) so multi-cycle topologies are never masked. |
| **Partial Recovery State Drift** | Updated `RecoveryManager`, `EngineBridge`, `SessionManager`, and `RecoveryCenter` so unresolved multi-cycle recoveries emit HTTP `409 DEADLOCK_UNRESOLVED` *with* the partially updated `state` and WebSocket broadcast, preventing UI drift after partial victim termination. |
| **GNU libstdc++ TSan False Positive** | Replaced `std::timed_mutex` (`pthread_mutex_clocklock`) in Dining Philosophers with a portable `TimedFork` monitor (`std::mutex` + `std::condition_variable::wait_for`), passing 10/10 Linux TSan repeats with 0 warnings. |
| **Three.js / Vite Bundle Bloat & Disposals** | Eliminated Rollup `Circular chunk` warnings by separating `three_core`, `three_react`, `charts_vendor`, and `xyflow_vendor`, and refactored `ResourceConduits` to share a disposed `SphereGeometry`. |

---

## 6. Two-Minute Interview Pitch

> *"Operating Systems students often struggle with why an unsafe state isn't always deadlocked, or why a cycle in a multi-instance Resource Allocation Graph doesn't guarantee deadlock. I built **Deadlock City** as a full-stack interactive lab to make those invariants tangible. All core OS logic—Banker's safety checks, Work/Finish deadlock detection, recovery strategies, 5 CPU schedulers, and real `std::thread` synchronization labs—lives strictly in C++17. FastAPI orchestrates isolated sessions over JSON-STDIO subprocess IPC with per-session asyncio locks, and broadcasts monotonic sequence-numbered state updates over WebSockets to a Three.js 3D city, a React Flow graph, and Recharts analytics. Everything runs in one command via multi-stage Docker Compose or local bash scripts, and I verified memory/thread safety on Linux using ASan, UBSan, and TSan alongside a continuous 10-minute 60 FPS browser stress test."*

---

## 7. Measured Results & Technology Stack

- **Automated Verification**: `24/24` C++17 GoogleTests (`CTest` + Linux `ASan+UBSan` + `TSan` + macOS `UBSan`), `15/15` FastAPI `Pytest` integration tests, `23/23` `Vitest` UI/store tests, `ESLint` & strict `tsc -b` clean, and `20/20` Playwright browser workflows passing.
- **Security Scans**: `0` vulnerabilities reported by `npm audit --omit=dev` and `pip-audit -r backend/requirements.txt`.
- **Sustained Benchmark (`610s`)**: `60.0 FPS` mean WebGL rate, `8.92 ms` C++ `--health` median IPC, `32.73 ms` `/step` median latency, stable heap (`41.15 -> 46.20 MB`), and flat backend RSS (`40.92 MB`).
- **Stack**: `C++17`, `CMake`, `GoogleTest`, `nlohmann/json`, `Python 3.12`, `FastAPI`, `Pydantic v2`, `Uvicorn`, `WebSockets`, `Pytest`, `React 18`, `TypeScript`, `Three.js`, `@react-three/fiber`, `@xyflow/react`, `Recharts`, `Zustand`, `Tailwind CSS`, `Docker`, `Nginx`.
