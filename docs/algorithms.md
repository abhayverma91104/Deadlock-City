# Deadlock City — Operating Systems Algorithms Reference

Every OS algorithm in Deadlock City executes exclusively inside the **C++17 core engine** (`engine/src/`) and is exposed cleanly over `--json-stdio` to FastAPI and React.

> **Simulation vs. Real Kernel Scope Notice**  
> Deadlock City is a discrete-tick **educational operating system simulation platform** (with user-space `std::thread` experiments in `SyncLab`). While it implements faithful OS textbook models (Work/Finish vectors, Banker's safety checks, RAG/WFG graphs, victim recovery, CPU burst scheduling timelines, and real POSIX threads/mutexes/CVs), it does **not** manage hardware page tables, virtual memory, device drivers, disk I/O queues, file systems, kernel system calls, or POSIX named semaphores.

---

## 1. Resource & Process Management

### 1.1 Process Lifecycle State Machine
- **Definition & Purpose**: Tracks active entities (`Process`) across six explicit OS states: `NEW`, `READY`, `RUNNING`, `WAITING`, `BLOCKED`, and `TERMINATED`, preserving invariants between `max_demand`, `allocated`, `need = max_demand - allocated`, and `pending_request`.
- **Inputs / Outputs**: Process descriptor (`id`, `name`, `arrival_time`, `burst_time`, `priority 1..10`, `max_demand`, `termination_cost`) -> updated `Process` PCB list + total resources returned upon termination.
- **Steps & Invariants**:
  1. New processes enter `NEW` (if `arrival_time > current_tick`) or `READY`.
  2. Each tick promotes `arrival_time <= tick` processes to `READY`, advances CPU execution (`remaining_time--`) for the selected active process (`1` = highest priority), and transitions processes finishing burst work (`remaining_time == 0`) to `TERMINATED`, releasing held units back to `ResourceManager`.
  3. Unsatisfied resource requests transition a process to `BLOCKED`; manual suspend moves non-terminated processes to `WAITING`.
- **Complexity**: Time $O(|P| \cdot |R|)$ per tick across up to `24` processes and `12` resource types; Space $O(|P| \cdot |R|)$.
- **Implementation**: [engine/include/ProcessManager.hpp](../engine/include/ProcessManager.hpp), [engine/src/ProcessManager.cpp](../engine/src/ProcessManager.cpp), [engine/src/ResourceManager.cpp](../engine/src/ResourceManager.cpp), [engine/src/SimulationEngine.cpp](../engine/src/SimulationEngine.cpp).
- **Tests**: `ResourceManagerTest.CreateAllocateReleaseAndModify`, `ProcessManagerTest.CreateNeedComputationAndTerminateReleasesResources` in [engine/tests/test_managers.cpp](../engine/tests/test_managers.cpp).
- **Limitations**: Capped at `24` processes and `12` resource pools (`1..64` units each); no hardware I/O interrupts.

### 1.2 Resource Allocation Graph (RAG) & Wait-For Graph (WFG)
- **Definition & Purpose**: Bipartite graph $G = (V_P \cup V_R, E_{alloc} \cup E_{req})$ where $R_j \to P_i$ denotes held allocation units and $P_i \to R_j$ denotes pending requests. The **Wait-For Graph** projects out resources: edge $P_i \to P_k$ exists whenever $P_i$ requests $R_j$ and $P_k$ currently holds units of $R_j$ (explicitly surfaced in `deadlock_report.wait_for_edges`).
- **Cycle Enumeration (`DeadlockDetector::find_rag_cycles`)**:
  - Uses canonical Johnson-style `start_node` DFS over the directed RAG adjacency list so secondary overlapping cycles are never pruned by global visited sets (`v >= start_node`, bounded at `kMaxCycles = 32` cycles and `expansions < 10000`).
- **Complexity**: Bounded exploration at worst `10,000` edge expansions; backend WFG/RAG projection in [backend/app/services/graph_builder.py](../backend/app/services/graph_builder.py) runs in $O(|P| \cdot |R|)$.
- **Critical Property**: A cycle in a **single-instance** RAG is necessary and sufficient for deadlock (`single_instance_deadlock`), whereas a cycle in a **multi-instance** RAG (`multi_instance_safe_cycle`) is necessary **but not sufficient** because unblocked external holders can finish and release instances.
- **Tests**: `DeadlockDetectorTest.OverlappingCyclesAndZeroHoldZeroPendingEdgeCases`, `DeadlockDetectorTest.MultiInstanceCycleWithoutDeadlock` in [engine/tests/test_banker_and_detection.cpp](../engine/tests/test_banker_and_detection.cpp).

---

## 2. Deadlock Management

### 2.1 Coffman's Four Necessary Conditions
In Deadlock City, a true deadlock emerges only when all four conditions hold simultaneously:
1. **Mutual Exclusion**: Resource instances are assigned exclusively per unit (`ResourceType.total_instances`).
2. **Hold and Wait**: Processes hold `allocated[r] > 0` while waiting on `pending_request[r'] > 0`.
3. **No Preemption**: Non-preemptible resources (`preemptible = false`, e.g., DB locks) remain locked until released or recovered via termination/rollback.
4. **Circular Wait**: A closed cycle in the Wait-For relation (single-instance) or mutual blocking unresolvable by `Work` reduction (multi-instance).

### 2.2 Multi-Instance Deadlock Detection (`DeadlockDetector::detect`)
- **Definition & Purpose**: Determines definitively which active processes cannot complete under current `Available` and `pending_request` vectors, independent of `Max` demand (`Banker's` uses `Need`, whereas detection uses current `Request`).
- **Inputs / Outputs**: Canonical `processes[]`, `resources[]`, plus `find_rag_cycles` cycle list -> `DeadlockReport { detected, has_cycle_in_rag, deadlocked_processes, involved_resources, cycles, wait_for_edges, steps[], explanation }`.
- **Pseudocode**:
```text
Work[r] = resource[r].available_instances  for all r in R
for each p in P:
  Finish[p] = (p.state == TERMINATED) or (sum(p.allocated) == 0 and sum(p.pending_request) == 0)

while exists p with not Finish[p] and p.pending_request <= Work:
  Work_before = copy(Work)
  Work = Work + p.allocated
  Finish[p] = true
  record DetectionStep(Work_before, Work, selected=p, Finish)

Deadlocked = { p in P : not Finish[p] }
detected = (not Deadlocked.empty())
```
- **Complexity**: Time $O(|P|^2 \cdot |R|)$, Space $O(|P| \cdot |R|)$ (for recorded `DetectionStep` trace snapshots).
- **Worked Example (`multi_instance_safe_cycle` vs `multiple_instance_deadlock`)**:
  - In `multi_instance_safe_cycle`, `P0` holds `R0=1` wanting `R1=1`, `P1` holds `R1=1` wanting `R0=1`, creating a RAG cycle `P0 -> R1 -> P1 -> R0 -> P0`. Another process `P2` holds an extra unit with 0 pending requests, finishes first (`Work` increases), letting `P1` and `P0` finish in turn -> `detected = false`, `has_cycle_in_rag = true`.
- **Edge Cases**: Zero resources or all processes `TERMINATED`; processes holding `0` and requesting `0` finish immediately (`Finish = true`); overlapping cycles (`DeadlockDetectorTest.OverlappingCyclesAndZeroHoldZeroPendingEdgeCases`).
- **Implementation**: [engine/src/DeadlockDetector.cpp](../engine/src/DeadlockDetector.cpp).

### 2.3 Banker's Safety & Resource Request Algorithm (`BankersAlgorithm`)
- **Definition & Purpose**: Deadlock **avoidance** algorithm guaranteeing there exists at least one completion sequence (`safe_sequence`) assuming every process may eventually request up to its declared `Need[r] = Max[r] - Allocated[r]`. Distinguishes strictly between **`SAFE`**, **`UNSAFE` (not deadlocked)**, and **`DEADLOCKED`**.
- **Inputs / Outputs**: Canonical state (`check_safety`), or `(process_id, request_map, use_banker)` (`evaluate_request`).
- **Steps (`evaluate_request`)**:
  1. Guard bounds: `0 <= qty <= 1,000,000` and cumulative check `req_qty + pending_request[r] <= need[r]` (`REQUEST_EXCEEDS_NEED` if exceeded).
  2. Check availability: if `request > Available`, block caller (`BLOCKED`, store `pending_request`).
  3. If `use_banker == false`: allocate directly without safety check and recompute safety/deadlock (`unsafe_no_deadlock` can arise here).
  4. If `use_banker == true`: tentatively mutate `Available -= Req`, `Allocated += Req`, `Need -= Req`; execute `check_safety` ($O(|P|^2 \cdot |R|)$ `Work`/`Finish` over `Need`); commit only if `is_safe == true`, else restore pre-trial vectors cleanly and increment `rejected_request_count`.
- **Complexity**: Time $O(|P|^2 \cdot |R|)$, Space $O(|P| \cdot |R|)$.
- **Worked Example (`classic_banker_safe`)**: `Available = (R0=3, R1=3, R2=2)` across `P0..P4`. `check_safety` finishes `P1` (`Work -> 5,3,2`), then `P3` (`7,4,3`), `P4` (`7,4,5`), `P0` (`7,5,5`), `P2` (`10,5,7`) -> `safe_sequence = [P1, P3, P4, P0, P2]`.
- **Edge Cases**: Cumulative request overflow, 0 resources / 0 active processes (vacuously safe), unsafe state without deadlock (`UnsafeStateWithoutDeadlock` / `unsafe_no_deadlock`).
- **Implementation & Tests**: [engine/src/BankersAlgorithm.cpp](../engine/src/BankersAlgorithm.cpp), [engine/tests/test_banker_and_detection.cpp](../engine/tests/test_banker_and_detection.cpp).

### 2.4 Deadlock Recovery (`RecoveryManager`)
- **Strategies Implemented**:
  1. `terminate_all`: Terminates all `deadlocked_processes` and frees every held unit.
  2. `terminate_victim`: Picks explicit `target_process_id` or ranks victims by `victim_criteria` (`lowest_cost`, `lowest_priority`, `least_allocated`, `lowest_remaining_work`), terminates it, frees held units, and tries unblocking waiting peers.
  3. `preempt_resource`: Strips held `preemptible == true` units from deadlocked holders, incrementing `preemption_count`, and rolls victim `pending_request` cleanly. Refuses non-preemptible pools (`RESOURCE_NOT_PREEMPTIBLE` / `NO_PREEMPTIBLE_RESOURCE`).
  4. `rollback`: Restores an entire saved `SimulationState` snapshot from `checkpoints[checkpoint_index]` and recomputes detection/safety reports.
- **Verification & Partial Recovery Guard**: Immediately re-runs `DeadlockDetector::detect` after recovery mutations. If `state.deadlock_report.detected == true` (e.g., breaking one cycle among two disjoint deadlock cycles), sets `res.ok = false` and `error_code = "DEADLOCK_UNRESOLVED"`; FastAPI persists the mutated state, bumps `seq`, broadcasts `STATE_SYNC`, and returns HTTP `409` with the updated `state`.
- **Complexity**: Time $O(|P|^2 \cdot |R|)$, Space $O(\text{state size})$.
- **Implementation & Tests**: [engine/src/RecoveryManager.cpp](../engine/src/RecoveryManager.cpp), [engine/tests/test_recovery_scheduling_sync.cpp](../engine/tests/test_recovery_scheduling_sync.cpp).

---

## 3. CPU Scheduling (`CPUScheduler`)

Executes standalone or snapshot-derived workloads (`arrival_time`, `burst_time >= 1`, `priority 1..10`) across 5 classic scheduling algorithms, inserting explicit **`IDLE`** Gantt segments when no ready process has arrived yet:

| Algorithm | Preemptive? | Dispatch Rule & Tie-Break | Complexity |
| :--- | :--- | :--- | :--- |
| **FCFS** | Non-preemptive | Earliest `arrival_time` -> input order | $O(n \log n)$ |
| **SJF** | Non-preemptive | Min `burst_time` among arrived -> `arrival_time` -> `id` | $O(n^2)$ |
| **SRTF** | Preemptive (1-tick) | Min `remaining_time` among arrived -> `arrival_time` -> `id` | $O(T \cdot n)$ ($T$ = makespan) |
| **PRIORITY** | Non-preemptive | Min integer `priority` (`1` highest) -> `arrival_time` -> `id` | $O(n^2)$ |
| **RR** | Preemptive (`quantum`) | FIFO ready queue; new arrivals at tick `t` enqueued before re-queueing expired quantum process | $O(\text{total\_burst})$ |

- **Metrics Computed**: Per-process `completion_time`, `turnaround_time = completion - arrival`, `waiting_time = turnaround - burst`, `response_time = first_run - arrival`; aggregate `avg_waiting_time`, `avg_turnaround_time`, `avg_response_time`, `context_switches`, `cpu_utilization_pct`, `total_time`.
- **Edge Cases & Guard**: Single process, zero-arrival idle gaps (`IdleGapsSimultaneousArrivalsAndTieBreaking`), equal priorities/bursts (`InvalidInputsSingleProcessAndEqualPriorityTieBreak`), empty process list (`VALIDATION_ERROR`), quantum clamped (`1..64`).
- **Implementation & Tests**: [engine/src/CPUScheduler.cpp](../engine/src/CPUScheduler.cpp), [engine/tests/test_recovery_scheduling_sync.cpp](../engine/tests/test_recovery_scheduling_sync.cpp).

---

## 4. Real Multithreaded Synchronization Lab (`SyncLab`)

Uses real C++17 `std::thread`, `std::mutex`, `std::condition_variable`, and `std::atomic<int>` primitives under bounded iterations (`1..50`) and bounded wait timeouts (`wait_for` <= `500 ms`):

1. **Producer-Consumer** (`run_producer_consumer`): Safe (`std::mutex` + `not_full`/`not_empty` CVs -> `0` overflows/underflows) vs. Unsafe (unsynchronized occupancy counter -> capacity overflows & underflows).
2. **Readers-Writers** (`run_readers_writers`): Safe (`std::mutex` + `rw_cv` allowing concurrent readers while excluding writers cleanly, returning on `wait_for` timeout) vs. Unsafe (concurrent reader/writer conflicts).
3. **Dining Philosophers** (`run_dining_philosophers`): Safe (`TimedFork` `std::mutex` + `std::condition_variable` acquired in ordered hierarchy `min(left, right)` -> `0` deadlocks) vs. Unsafe (`left` then `right` timed wait exposing circular-wait timeouts cleanly).

- **Sanitizer Verification**: Verified **0 ThreadSanitizer warnings** across 10 consecutive `SyncLabTest.*Safe*` repetitions on ARM64 Linux (`ubuntu:24.04`, GCC 13.3).
- **Implementation & Tests**: [engine/src/SyncLab.cpp](../engine/src/SyncLab.cpp), `SyncLabTest.*` in [engine/tests/test_recovery_scheduling_sync.cpp](../engine/tests/test_recovery_scheduling_sync.cpp).

