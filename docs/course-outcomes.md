# Deadlock City — Operating Systems Course Outcome Mapping

This document maps Deadlock City modules strictly to **actually implemented OS functionality** in `engine/src/`, `backend/app/`, and `frontend/src/`.

> **Scope Honesty Notice**  
> Deadlock City implements process management, CPU scheduling, deadlock detection/avoidance/recovery, and user-space POSIX thread synchronization (`std::mutex` / `std::condition_variable`). It does **not** implement memory paging, page replacement algorithms, disk/arm scheduling, file system allocation/inodes, POSIX named semaphores, or real OS kernel interrupts.

---

## 1. Course Outcome (CO) Alignment Matrix

| Course Outcome | Concept Area | Implementation Level | Deadlock City Artifacts & Modules |
| :--- | :--- | :--- | :--- |
| **CO1** | Process States & Control Blocks (`PCB`) | **Directly Implemented (Simulated)** | `ProcessManager`, `Types.hpp` (`NEW`, `READY`, `RUNNING`, `WAITING`, `BLOCKED`, `TERMINATED`), `LeftInspectorRail`, `ProcessResourceManager`, `ProcessBuilding` |
| **CO2** | Inter-Process Communication (IPC) & Serialization | **Directly Implemented (Architecture)** | `--json-stdio` stdin/stdout structured JSON protocol (`EngineBridge`, `main.cpp`, `docs/schemas/engine-ipc.schema.json`), plus WebSocket `STATE_SYNC` real-time push (`WebSocketHub`) |
| **CO3** | CPU Scheduling Algorithms & Performance Metrics | **Directly Implemented (Deterministic)** | `CPUScheduler` (`FCFS`, `SJF`, `SRTF`, `PRIORITY`, `RR`), Gantt charts with idle gaps, turnaround/waiting/response time, context switches, CPU utilization (`CpuSchedulingLab`) |
| **CO4** | Resource Allocation Graphs & Wait-For Projections | **Directly Implemented (Graph + Cycle Enum)** | `DeadlockDetector::find_rag_cycles` (Johnson-style `start_node` cycle search), `graph_builder.py`, interactive React Flow `RAG View` & `Wait-For Graph` |
| **CO5** | Deadlock Characterization, Detection, Avoidance & Recovery | **Directly Implemented (Core Truth Engine)** | `DeadlockDetector::detect` (`Work`/`Finish`), `BankersAlgorithm` (`Need=Max-Alloc`, safety sequence, hypothetical checks), `RecoveryManager` (victim termination, resource preemption, checkpoint rollback + partial `409 DEADLOCK_UNRESOLVED` sync) |
| **CO6** | Multithreading & Thread Synchronization Primitives | **Directly Implemented (Real OS Threads)** | `SyncLab` spawning real C++17 `std::thread` workers synchronized with `std::mutex`, `std::condition_variable`, and `std::atomic` across `Producer-Consumer`, `Readers-Writers`, and `Dining Philosophers` (`safe` vs `unsafe`) |

---

## 2. Direct vs. Supporting Concepts Breakdown

### Directly Implemented OS Concepts
- **Process Management**: Arrival promotion, priority ordering (`1` highest .. `10` lowest), CPU burst countdown, blocking on unsatisfied requests, waiting tick accumulation, suspend/resume, and termination resource cleanup.
- **CPU Scheduling**: Exact turnaround, waiting, response, context-switch, and idle-interval calculations across all 5 textbook schedulers (`FCFS`, `SJF`, `SRTF`, Non-preemptive `Priority`, `Round Robin`).
- **Resource Allocation & Deadlock Handling**: Multi-instance safety testing (`Banker's`), cycle vs. deadlock discrimination (`multi_instance_safe_cycle` vs `multiple_instance_deadlock`), unsafe-but-not-deadlocked state demonstration (`unsafe_no_deadlock`), victim selection criteria (`lowest_cost`, `lowest_priority`, `least_allocated`, `lowest_remaining_work`), preemptible-only resource reclamation, and checkpoint restoration.
- **Synchronization**: Mutual exclusion, condition-variable wait/notify (`wait_for`), bounded-buffer overflow/underflow races (`Producer-Consumer`), shared-read / exclusive-write exclusion (`Readers-Writers`), and ordered fork hierarchy vs. circular-wait timeouts (`Dining Philosophers`).

### Supporting Architectural / Systems Engineering Concepts
- **Subprocess IPC (`asyncio.create_subprocess_exec`)**: Isolated process boundary without shell invocation, wall-clock timeouts (`5s` / `15s`), concurrency limiting (`Semaphore(8)`), and malformed-output / crash recovery.
- **Concurrency Safety**: Per-session `asyncio.Lock` serialization preventing race conditions between REST requests and background auto-tick coroutines; monotonic `seq` snapshot gating rejecting out-of-order updates.
- **Reproducible Experimentation & Analytics**: Deterministic `std::mt19937` seeding, bounded sliding telemetry windows (`240` metrics / `200` events with explicit overflow disclosure), isolated A/B comparison runs, and CSV/JSON data exports.

---

## 3. Concepts Explicitly Out of Scope

The following Operating Systems syllabus topics are **not** present in this repository and must not be claimed during evaluation:
- Paging, segmentation, TLB, virtual memory page replacement (`FIFO`, `LRU`, `Optimal`)
- Disk scheduling (`FCFS`, `SSTF`, `SCAN`, `C-SCAN`)
- File system directory structures, allocation (`contiguous`, `linked`, `indexed`), inodes
- POSIX `sem_t` / SysV semaphores (synchronization uses C++17 `std::mutex` + `std::condition_variable` + `std::atomic`)
