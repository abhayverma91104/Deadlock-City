# Deadlock City — Implementation Roadmap

## Phase 1 — Project Analysis & Planning (Current)
- [x] Analyze UI reference (`media_1795550720824_631469ef.jpg`) & establish Design System (`docs/design-system.md`)
- [x] Define 3-tier Architecture & Risk Matrix (`docs/architecture.md`)
- [x] Create monorepo directory structure & `.gitignore`
- [x] Define formal JSON IPC contract (`docs/schemas/engine-ipc.schema.json`)
- [x] Define REST & WebSocket API contracts (`docs/api.md`)
- [x] Commit Phase 1 baseline to Git

## Phase 2 — C++17 Core Simulation Engine (Complete)
- [x] Implement modular CMake build (`engine/CMakeLists.txt`) with `nlohmann/json` & `GoogleTest`.
- [x] Implement modules: `ProcessManager`, `ResourceManager`, `DeadlockDetector`, `BankersAlgorithm`, `RecoveryManager`, `CPUScheduler`, `SyncLab`, `SimulationEngine`, `SimulationSerializer`.
- [x] Implement CLI `--json-stdio` & `--health` entrypoint.
- [x] Write & pass GoogleTest suite covering Mandatory Tests 1–8 + edge cases (18/18 passing).

## Phase 3 — FastAPI Backend Orchestration (Complete)
- [x] Set up Python 3.11+ FastAPI app, Pydantic v2 schemas, `EngineBridge` subprocess runner with timeouts, `SessionManager`, auto-tick loop, WebSocket hub, and export service.
- [x] Write & pass `pytest` API & integration tests against the compiled C++ binary (11/11 passing).

## Phase 4 — Frontend Foundation & Design System (Complete)
- [x] Initialize Vite + React + TypeScript (strict) + Tailwind CSS + Framer Motion + Zustand.
- [x] Implement persistent futuristic tactical HUD shell (Top Telemetry Strip, Angled Status Banner, Activity Queue, Left Inspector Rail, Bottom Two-Tier Command Dock, Bottom-Right Radial Control Core).
- [x] Connect backend `/api/health`, session creation/restoration, WebSocket `STATE_SYNC` with bounded backoff & stale-snapshot guard, and lifecycle controls (`7/7` Vitest tests passing, lint & production build green).

## Phase 5 — Interactive 3D City Simulation (Complete)
- [x] Replace temporary viewport slot with interactive Three.js / React Three Fiber / Drei 3D City (`CityCanvasViewport`, `CityInfrastructure`, `ProcessBuilding`, `ResourceFacility`, `ResourceConduits`, `CityCameraRig`, `CityFallback2D`, `WebGLErrorBoundary`).
- [x] Implement 6 distinct Process Building states, 5 Resource Facility architectures with live capacity bars, directed glowing allocation/request conduits, authoritative deadlock vs cycle highlighting, and Low/Med/High graphics presets.
- [x] Verify with Vitest (`11/11`), Pytest (`12/12`), ESLint, TypeScript, Vite build, and Playwright WebGL browser verification with 7 screenshots and 0 console/page/network errors.

## Phase 6 — Graph & OS Algorithm Workbenches (Complete)
- [x] Resource Allocation Graph (`React Flow`) with custom Process/Resource nodes, Allocation vs Request edges, Wait-For Graph toggle, and cycle vs deadlock differentiation.
- [x] Deadlock Detection Stepper (Work/Finish trace & WFG), Banker's Algorithm Workbench (matrices + hypothetical request tester), Recovery Center (termination, preemption, rollback checkpoints), and Process/Resource Manager.
- [x] CPU Scheduling Gantt Lab & C++ Synchronization Lab (`std::thread` recorded events).

## Phase 7 — Analytics, Presets & Exports (Complete)
- [x] Recharts historical analytics suite (`utilization_pct`, `available` vs `allocated`, process lifecycle, pending requests, completions, deadlocks, recoveries, safety transitions) with range filter, tick/UTC axis toggle, deduplication, and `240`-sample cap.
- [x] Authoritative C++ preset center (all 9 canonical presets + deterministic random workload generator), 6 guided OS labs, isolated comparative experiment engine, searchable/navigable event timeline, print-friendly academic summary, and verified CSV/JSON exports.

## Phase 8 — End-to-End Integration & QA (Complete)
- [x] Full codebase & OS algorithm correctness audit, C++ sanitizers (`UBSan` native + Linux Docker `ASan+UBSan+TSan`), FastAPI hardening (`413`, `503` LRU session cap, `Semaphore(8)`, WS `Origin` check), `Vitest`/`Pytest`/`CTest` green, `docker compose` + helper scripts (`scripts/setup.sh`, `dev.sh`, `test.sh`), clean-install check, `610s` sustained stress benchmark (`60.0 FPS`), and 20-workflow browser QA.

## Phase 9 — Final Documentation & Delivery (Complete)
- [x] Finalized `README.md`, `docs/architecture.md` (9 Mermaid diagrams), `docs/algorithms.md`, `docs/api.md`, `docs/user-guide.md`, `docs/project-report.md`, `docs/course-outcomes.md`, `docs/demo-guide.md`, `docs/viva-guide.md`, `docs/portfolio.md`, and curated `docs/images/` screenshots.
