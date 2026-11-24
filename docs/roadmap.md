# Deadlock City — Implementation Roadmap

## Phase 1 — Project Analysis & Planning (Current)
- [x] Analyze UI reference (`media_1795550720824_631469ef.jpg`) & establish Design System (`docs/design-system.md`)
- [x] Define 3-tier Architecture & Risk Matrix (`docs/architecture.md`)
- [x] Create monorepo directory structure & `.gitignore`
- [x] Define formal JSON IPC contract (`docs/schemas/engine-ipc.schema.json`)
- [x] Define REST & WebSocket API contracts (`docs/api.md`)
- [ ] Commit Phase 1 baseline to Git

## Phase 2 — C++17 Core Simulation Engine
- Implement modular CMake build (`engine/CMakeLists.txt`) with `nlohmann/json` & `GoogleTest`.
- Implement modules: `ProcessManager`, `ResourceManager`, `DeadlockDetector`, `BankersAlgorithm`, `RecoveryManager`, `CPUScheduler`, `SyncLab`, `SimulationEngine`, `SimulationSerializer`.
- Implement CLI `--json-stdio` & `--health` entrypoint.
- Write & pass GoogleTest suite covering Mandatory Tests 1–8 + edge cases.

## Phase 3 — FastAPI Backend Orchestration
- Set up Python 3.11+ FastAPI app, Pydantic v2 schemas, `EngineBridge` subprocess runner with timeouts, `SessionManager`, auto-tick loop, WebSocket hub, and export service.
- Write & pass `pytest` API & integration tests against the compiled C++ binary.

## Phase 4 — Frontend Foundation & Design System
- Initialize Vite + React + TypeScript + Tailwind CSS + Framer Motion + Zustand.
- Implement persistent futuristic tactical HUD shell (Top Telemetry Strip, Status Banner, Activity Queue, Bottom Two-Tier Command Dock, Bottom-Right Radial Control Core).
- Connect backend `/api/health` and session initialization.

## Phase 5 — Interactive 3D City Simulation
- Build Three.js / React Three Fiber atmospheric city environment matching the visual reference.
- Render interactive Process Buildings, Resource Facilities, glowing ownership/request conduits, floating rooftop badges, and world-space hover tooltips.
- Wire Left Inspector Rail and full CRUD/allocation/tick controls to live backend state.

## Phase 6 — Graph & OS Algorithm Workbenches
- Resource Allocation Graph (`React Flow`) with custom Process/Resource nodes, Allocation vs Request edges, cycle vs deadlock differentiation.
- Deadlock Detection Stepper (Work/Finish trace & WFG), Banker's Algorithm Workbench (matrices + hypothetical request tester), Recovery Center (termination, preemption, rollback checkpoints).
- CPU Scheduling Gantt Lab & C++ Synchronization Lab.

## Phase 7 — Analytics, Presets & Exports
- Recharts analytics suite (utilization over time, state distribution, deadlock/recovery timeline, scheduling comparisons).
- All 8 playable presets + deterministic seed generator + JSON/CSV exports.

## Phase 8 — End-to-End Integration & QA
- Full-stack verification (C++ tests, Pytest, Vitest, TypeScript build, live browser verification across all 11 views, console/error checks, session persistence across refresh).
- Docker Compose configuration & helper startup scripts.

## Phase 9 — Final Documentation
- Complete `README.md`, `docs/algorithms.md`, `docs/user-guide.md`, OS syllabus mapping, and sample lab experiment scenarios.
