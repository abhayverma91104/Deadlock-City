# Deadlock City — Live Project Demonstration Guide

This guide provides three tested, self-contained demonstration scripts mapped directly to real preset IDs and UI controls in Deadlock City.

---

## Pre-Demo Checklist (30 Seconds Before Presenting)

1. Start stack via Docker (`docker compose up -d` -> `http://localhost:8080`) or native (`./scripts/dev.sh` -> `http://127.0.0.1:5173`).
2. Confirm top-right header pills read **`C++ v1.0.0`** (green) and **`CONNECTED`** (cyan).
3. Start from clean `normal_workload` (`Tick 0`, `SAFE`).

---

## 1. Three-Minute Demonstration (Core Deadlock & Recovery Pitch)

### Beat 1: Architecture & Live 3D City (0:00 – 0:50)
- **Action**: Point at the 3D viewport (`City` tab), top bar telemetry, Process Execution Queue, and Left Inspector Rail (`P0..P3`, `R0..R2`).
- **Verbal Script**: *"Deadlock City maps OS kernel resource state into a 3D industrial city. Every building represents a process, every facility holds resource instances, and every calculation runs exclusively inside our compiled C++17 engine streamed to React over FastAPI and WebSockets."*

### Beat 2: Circular Deadlock Injection (0:50 – 1:40)
- **Action**: Click **`Presets / Session`** -> select **`single_instance_deadlock`** -> **`Load in Current`**.
- **Observation**: City turns **crimson (`DEADLOCKED`)** with thick pulsing conduits linking `P0` and `P1`; Process Execution Queue shows `BLK 2`, `DLK 1`.
- **Verbal Script**: *"Here `P0` holds `R0` waiting for `R1`, and `P1` holds `R1` waiting for `R0`. Coffman's four conditions hold simultaneously."*

### Beat 3: Deadlock Detection Trace (1:40 – 2:20)
- **Action**: Click **`Detection`** (`[3]`) -> click **`Run Detection`** -> click **`Play trace`**.
- **Observation**: `Work` stays `[R0: 0, R1: 0]`; neither `P0` nor `P1` finishes; Wait-For Graph lists `P0 -> P1` and `P1 -> P0`.

### Beat 4: Recovery & Live Restoration (2:20 – 3:00)
- **Action**: Click **`Recovery`** (`[5]`) -> keep `Terminate Victim Process` (`lowest_cost`) -> click **`Execute Recovery Strategy`** -> **`Confirm Recovery`**. Return to **`City`** (`[1]`).
- **Observation**: Banner transitions **`DEADLOCKED -> SAFE`**; terminated victim releases its lock, unblocking the survivor, and 3D city returns to healthy cyan lighting.

---

## 2. Five-Minute Demonstration (+ Banker's Avoidance, Unsafe vs. Deadlock & CPU Scheduling)

Execute **all steps of the 3-Minute Demo**, then continue:

### Beat 5: Banker's Algorithm & Hypothetical Check (3:00 – 3:55)
- **Action**: Open **`Analytics`** -> **`Preset Center`** -> load **`classic_banker_safe`** (`seed 42`). Open **`Banker's`** (`[4]`).
- **Observation**: Safe sequence displays **`P1 -> P3 -> P4 -> P0 -> P2`**.
- **Action**: Select `P0`, set request vector (`R0=3, R1=0, R2=0` or exceeding available/leaving unsafe state), click **`Evaluate Hypothetical`**, then **`Unsafe (No Deadlock)`** preset (`unsafe_no_deadlock`).
- **Verbal Script**: *"Notice `unsafe_no_deadlock`: top badge shows `UNSAFE`, zero safe completion sequence exists, yet `DeadlockDetector` proves zero processes are deadlocked right now—demonstrating the exact textbook distinction between unsafe and deadlocked states."*

### Beat 6: Interactive RAG / Wait-For Graph & CPU Scheduling (3:55 – 5:00)
- **Action**: Switch to **`RAG Graph`** (`[2]`) -> toggle **`Wait-For Graph`** -> switch to **`CPU Sched`** (`[7]`) -> click **`Compare All 5`**.
- **Observation**: Instant Gantt charts with `IDLE` arrival gaps across FCFS, SJF, SRTF, Priority, and Round Robin (`Quantum=2`), showing lowest average waiting time under SRTF and bounded response time under RR.

---

## 3. Ten-Minute Complete Technical Demonstration

Covers the full platform end-to-end:

1. **System Architecture Overview (0:00 – 1:15)**: Show three tiers (C++17 `--json-stdio` engine, FastAPI `SessionManager` + `EngineBridge`, React/Three.js HUD). Highlight camera presets (`Iso`, `Top`, `Focus Selected`), graphics toggle (`LOW/MED/HIGH`), and **`3D/2D` Tactical Fallback** switch.
2. **Process & Resource Management (1:15 – 2:30)**: Open **`Processes`** (`[6]`) -> spawn a custom process (`BatchWorker`, `burst=4`, `priority=3`, `max_demand`) -> submit and release resource requests -> inspect live updates in Left Inspector Rail and City.
3. **Multi-Instance RAG Cycle vs. True Deadlock (2:30 – 4:00)**:
   - Open **`Analytics`** -> **`Preset Center`** -> load **`multi_instance_safe_cycle`**.
   - Open **`RAG Graph`** (`[2]`): observe **amber cycle warning (`Has Cycle, Deadlock Clear`)**—prove why a multi-instance cycle alone is NOT sufficient for deadlock!
   - Load **`multiple_instance_deadlock`**: observe confirmed **crimson deadlock** across multi-unit pools.
4. **Banker's Algorithm & Unsafe State (4:00 – 5:15)**: Load **`classic_banker_safe`** -> run **`Banker's`** hypothetical safety check without mutating canonical state -> contrast with **`unsafe_no_deadlock`**.
5. **Recovery Strategies & Checkpoint Rollback (5:15 – 6:30)**:
   - Load **`recovery_demo`** (deadlocked at Tick 1 with saved `Checkpoint #0` at Tick 0).
   - Open **`Recovery`** (`[5]`) -> select **`Rollback to Checkpoint`** -> confirm recovery -> inspect before/after diff (`DEADLOCKED -> SAFE`).
6. **CPU Scheduling Compare (6:30 – 7:20)**: Open **`CPU Sched`** (`[7]`) -> compare all 5 algorithms (`FCFS`, `SJF`, `SRTF`, `PRIORITY`, `RR`) and inspect context switches & utilization metrics.
7. **Real C++ `std::thread` Synchronization Lab (7:20 – 8:30)**:
   - Open **`Sync Lab`** (`[8]`) -> run **`Dining Philosophers`** in **`Safe (Synchronized)`** mode (`0` conflicts, all meals completed).
   - Switch to **`Unsafe (Race / Contention)`** -> run again -> scrub event trace showing circular-wait timeout and fork contention.
8. **Analytics, Isolated A/B Comparisons & Exports (8:30 – 9:30)**:
   - Open **`Analytics`** (`[9]`): tour **`Historical Charts`** (8 Recharts panels + **`Accessible Table`** + tick/UTC toggle), **`Comparative Engine`** (`Avoidance ON vs OFF` isolated without mutating active session), **`Event Timeline`** deep links, and **`Exports & Summary`** (download Metrics `.csv` and show `@media print` summary sheet).
9. **Testing, Sanitizers & Docker Deployment Summary (9:30 – 10:00)**: Cite verified test suites (`24` C++ GoogleTests clean under ASan+UBSan+TSan in Linux Docker, `15` Pytest tests, `23` Vitest tests, `610s` `60 FPS` stability benchmark, `docker compose up --build`).
