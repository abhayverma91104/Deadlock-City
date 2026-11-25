#include "SimulationEngine.hpp"

#include "SimulationSerializer.hpp"

#include <algorithm>
#include <cmath>
#include <random>
#include <stdexcept>

namespace deadlock_city {

namespace {

nlohmann::json ok_response(
    const std::string& command,
    const std::optional<SimulationState>& state,
    const nlohmann::json& result = nullptr
) {
    return {
        {"ok", true},
        {"command", command},
        {"error", nullptr},
        {"state", state.has_value() ? SimulationSerializer::to_json(*state) : nlohmann::json(nullptr)},
        {"result", result}
    };
}

nlohmann::json err_response(
    const std::string& command,
    const std::string& code,
    const std::string& message,
    const std::optional<SimulationState>& state = std::nullopt,
    const nlohmann::json& result = nullptr
) {
    return {
        {"ok", false},
        {"command", command},
        {"error", {{"code", code}, {"message", message}}},
        {"state", state.has_value() ? SimulationSerializer::to_json(*state) : nlohmann::json(nullptr)},
        {"result", result}
    };
}

void allocate_direct(
    ProcessManager& pm,
    ResourceManager& rm,
    const std::string& pid,
    const ResourceVector& alloc,
    const ResourceVector& pending = {}
) {
    auto* p = pm.find_mut(pid);
    if (!p) throw std::runtime_error("Missing process in preset: " + pid);
    for (const auto& [rid, qty] : alloc) {
        if (qty > 0) {
            std::string err;
            if (!rm.allocate(rid, qty, err)) {
                throw std::runtime_error("Preset allocation failed: " + err);
            }
            p->allocated[rid] += qty;
        }
    }
    bool has_pending = false;
    for (const auto& [rid, qty] : pending) {
        if (qty > 0) {
            p->pending_request[rid] = qty;
            has_pending = true;
        }
    }
    if (has_pending) {
        p->state = ProcessState::BLOCKED;
    }
    pm.recompute_need(*p, rm.resources());
}

} // namespace

void SimulationEngine::append_event(
    SimulationState& state,
    const std::string& type,
    const std::string& severity,
    const std::string& message,
    const std::map<std::string, std::string>& meta
) {
    state.total_events_recorded += 1;
    SimulationEvent ev;
    ev.id = "ev_" + std::to_string(state.tick) + "_" + std::to_string(state.total_events_recorded);
    ev.tick = state.tick;
    ev.type = type;
    ev.severity = severity;
    ev.message = message;
    ev.metadata = meta;
    state.events.push_back(std::move(ev));
    if (state.events.size() > 200) {
        state.events.erase(state.events.begin(), state.events.begin() + static_cast<std::ptrdiff_t>(state.events.size() - 200));
    }
}

void SimulationEngine::save_checkpoint(SimulationState& state) {
    state.checkpoints.push_back(static_cast<const SimulationStateSnapshot&>(state));
    if (state.checkpoints.size() > 10) {
        state.checkpoints.erase(state.checkpoints.begin());
    }
}

void SimulationEngine::refresh_diagnostics(
    SimulationState& state,
    ProcessManager& pm,
    ResourceManager& rm,
    bool record_metric
) {
    const SafetyStatus prev_safety = state.safety_status;
    const bool was_deadlocked = (prev_safety == SafetyStatus::DEADLOCKED);
    const bool initialized_yet = !state.events.empty();
    rm.refresh_statuses(pm.processes());
    state.processes = pm.processes();
    state.resources = rm.resources();
    state.deadlock_report = detector_.detect(state.processes, state.resources);
    state.banker_report = banker_.check_safety(state.processes, state.resources);

    if (state.deadlock_report.detected) {
        state.safety_status = SafetyStatus::DEADLOCKED;
        if (!was_deadlocked) {
            state.deadlock_count += 1;
            append_event(state, "DEADLOCK", "error", state.deadlock_report.explanation);
        }
    } else if (!state.banker_report.is_safe) {
        state.safety_status = SafetyStatus::UNSAFE;
    } else {
        state.safety_status = SafetyStatus::SAFE;
    }

    if (initialized_yet && state.safety_status != prev_safety) {
        append_event(
            state,
            "SAFETY_CHANGE",
            state.safety_status == SafetyStatus::SAFE
                ? "success"
                : state.safety_status == SafetyStatus::DEADLOCKED ? "error" : "warning",
            "System safety transitioned from " + to_string(prev_safety) + " to " + to_string(state.safety_status) + ".",
            {{"safety_from", to_string(prev_safety)}, {"safety_to", to_string(state.safety_status)}}
        );
    }

    if (record_metric) {
        int total_inst = 0;
        int alloc_inst = 0;
        int avail_inst = 0;
        for (const auto& r : state.resources) {
            total_inst += r.total_instances;
            alloc_inst += r.allocated_instances;
            avail_inst += r.available_instances;
        }
        int active = 0;
        int blocked = 0;
        int waiting = 0;
        int terminated = 0;
        int pending_units = 0;
        for (const auto& p : state.processes) {
            if (p.state != ProcessState::TERMINATED) {
                active++;
                for (const auto& [rid, qty] : p.pending_request) {
                    (void)rid;
                    if (qty > 0) pending_units += qty;
                }
            } else {
                terminated++;
            }
            if (p.state == ProcessState::WAITING) waiting++;
            if (p.state == ProcessState::BLOCKED || p.state == ProcessState::WAITING) blocked++;
        }
        MetricPoint mp;
        mp.tick = state.tick;
        mp.utilization_pct = total_inst > 0
            ? std::round((static_cast<double>(alloc_inst) / static_cast<double>(total_inst)) * 1000.0) / 10.0
            : 0.0;
        mp.active_count = active;
        mp.blocked_count = blocked;
        mp.deadlocked_count = static_cast<int>(state.deadlock_report.deadlocked_processes.size());
        mp.allocation_count = alloc_inst;
        mp.available_count = avail_inst;
        mp.waiting_count = waiting;
        mp.completed_count = state.completed_count;
        mp.terminated_count = terminated;
        mp.pending_request_units = pending_units;
        mp.deadlock_count = state.deadlock_count;
        mp.recovery_count = state.recovery_count;
        mp.safety_status = state.safety_status;

        bool is_duplicate_tail = false;
        if (!state.metrics_history.empty()) {
            const auto& last = state.metrics_history.back();
            is_duplicate_tail =
                last.tick == mp.tick &&
                last.utilization_pct == mp.utilization_pct &&
                last.active_count == mp.active_count &&
                last.blocked_count == mp.blocked_count &&
                last.deadlocked_count == mp.deadlocked_count &&
                last.allocation_count == mp.allocation_count &&
                last.available_count == mp.available_count &&
                last.waiting_count == mp.waiting_count &&
                last.completed_count == mp.completed_count &&
                last.terminated_count == mp.terminated_count &&
                last.pending_request_units == mp.pending_request_units &&
                last.deadlock_count == mp.deadlock_count &&
                last.recovery_count == mp.recovery_count &&
                last.safety_status == mp.safety_status;
        }
        if (!is_duplicate_tail) {
            state.total_metric_samples_recorded += 1;
            state.metrics_history.push_back(mp);
            if (state.metrics_history.size() > 240) {
                state.metrics_history.erase(state.metrics_history.begin());
            }
        }
    }
}

SimulationState SimulationEngine::create_simulation(
    unsigned int seed,
    const std::optional<std::string>& preset
) {
    if (preset.has_value() && !preset->empty()) {
        return load_preset(*preset, seed);
    }
    SimulationState state;
    state.seed = seed;
    state.preset = std::nullopt;
    state.status = SimStatus::IDLE;

    ResourceManager rm;
    rm.add_resource("CPU Core", ResourceCategory::COMPUTE, 4, true, "R0");
    rm.add_resource("Memory Bus", ResourceCategory::MEMORY, 4, false, "R1");
    rm.add_resource("I/O Channel", ResourceCategory::IO, 2, false, "R2");

    ProcessManager pm;
    pm.add_process("KernelMonitor", 0, 8, 2, {{"R0", 2}, {"R1", 2}, {"R2", 1}}, rm.resources(), 6, "P0");
    pm.add_process("GridRouter", 0, 6, 3, {{"R0", 2}, {"R1", 1}, {"R2", 1}}, rm.resources(), 4, "P1");
    pm.add_process("DataIngest", 1, 5, 4, {{"R0", 1}, {"R1", 2}, {"R2", 1}}, rm.resources(), 3, "P2");

    allocate_direct(pm, rm, "P0", {{"R0", 1}, {"R1", 1}});
    allocate_direct(pm, rm, "P1", {{"R0", 1}});

    append_event(state, "INFO", "info", "Initialized new Deadlock City simulation.");
    refresh_diagnostics(state, pm, rm, true);
    save_checkpoint(state);
    return state;
}

SimulationState SimulationEngine::load_preset(const std::string& preset_name, unsigned int seed) {
    SimulationState state;
    state.seed = seed;
    state.preset = preset_name;
    state.status = SimStatus::IDLE;

    ResourceManager rm;
    ProcessManager pm;

    if (preset_name == "normal_workload") {
        rm.add_resource("Compute Core", ResourceCategory::COMPUTE, 6, true, "R0");
        rm.add_resource("Memory Pool", ResourceCategory::MEMORY, 6, false, "R1");
        rm.add_resource("Disk Array", ResourceCategory::STORAGE, 4, false, "R2");

        pm.add_process("AuthDaemon", 0, 6, 2, {{"R0", 2}, {"R1", 2}, {"R2", 1}}, rm.resources(), 4, "P0");
        pm.add_process("StreamEngine", 0, 8, 3, {{"R0", 3}, {"R1", 2}, {"R2", 2}}, rm.resources(), 6, "P1");
        pm.add_process("Telemetry", 1, 5, 4, {{"R0", 1}, {"R1", 2}, {"R2", 1}}, rm.resources(), 2, "P2");
        pm.add_process("CacheSync", 1, 4, 5, {{"R0", 2}, {"R1", 1}, {"R2", 1}}, rm.resources(), 3, "P3");

        allocate_direct(pm, rm, "P0", {{"R0", 1}, {"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R0", 2}, {"R2", 1}});
        allocate_direct(pm, rm, "P2", {{"R1", 1}});
        append_event(state, "INFO", "success", "Loaded Normal Workload preset (healthy balanced allocation).");
    } else if (preset_name == "single_instance_deadlock") {
        rm.add_resource("Printer A", ResourceCategory::IO, 1, false, "R0");
        rm.add_resource("Database Lock B", ResourceCategory::LOCK, 1, false, "R1");

        pm.add_process("BillingJob", 0, 6, 3, {{"R0", 1}, {"R1", 1}}, rm.resources(), 4, "P0");
        pm.add_process("LedgerSync", 0, 7, 4, {{"R0", 1}, {"R1", 1}}, rm.resources(), 2, "P1");

        allocate_direct(pm, rm, "P0", {{"R0", 1}}, {{"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R1", 1}}, {{"R0", 1}});
        append_event(state, "DEADLOCK", "warning", "Loaded Single-Instance Deadlock preset (P0 <-> P1 circular wait).");
    } else if (preset_name == "multiple_instance_deadlock" || preset_name == "multi_instance_deadlock") {
        rm.add_resource("GPU Cluster", ResourceCategory::COMPUTE, 2, true, "R0");
        rm.add_resource("Lock Table", ResourceCategory::LOCK, 2, false, "R1");

        pm.add_process("Trainer-Alpha", 0, 9, 2, {{"R0", 2}, {"R1", 2}}, rm.resources(), 7, "P0");
        pm.add_process("Trainer-Beta", 0, 8, 5, {{"R0", 2}, {"R1", 2}}, rm.resources(), 3, "P1");
        pm.add_process("Monitor", 0, 4, 6, {{"R0", 1}}, rm.resources(), 1, "P2");

        allocate_direct(pm, rm, "P0", {{"R0", 1}, {"R1", 1}}, {{"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R0", 1}, {"R1", 1}}, {{"R0", 1}});
        append_event(state, "DEADLOCK", "warning", "Loaded Multiple-Instance Deadlock preset.");
    } else if (preset_name == "multi_instance_safe_cycle") {
        rm.add_resource("Compute Pool", ResourceCategory::COMPUTE, 2, true, "R0");
        rm.add_resource("Mutex Lock", ResourceCategory::LOCK, 1, false, "R1");

        pm.add_process("Worker-0", 0, 5, 2, {{"R0", 1}, {"R1", 1}}, rm.resources(), 4, "P0");
        pm.add_process("Worker-1", 0, 5, 3, {{"R0", 1}, {"R1", 1}}, rm.resources(), 4, "P1");
        pm.add_process("Finisher-2", 0, 2, 1, {{"R0", 1}}, rm.resources(), 2, "P2");

        allocate_direct(pm, rm, "P0", {{"R0", 1}}, {{"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R1", 1}}, {{"R0", 1}});
        allocate_direct(pm, rm, "P2", {{"R0", 1}});
        append_event(state, "INFO", "info", "Loaded Multi-Instance Cycle (No Deadlock) preset.");
    } else if (preset_name == "classic_banker_safe" || preset_name == "safe_resource_allocation") {
        rm.add_resource("Compute A", ResourceCategory::COMPUTE, 10, true, "R0");
        rm.add_resource("Memory B", ResourceCategory::MEMORY, 5, false, "R1");
        rm.add_resource("IO C", ResourceCategory::IO, 7, false, "R2");

        pm.add_process("Proc-0", 0, 7, 3, {{"R0", 7}, {"R1", 5}, {"R2", 3}}, rm.resources(), 5, "P0");
        pm.add_process("Proc-1", 0, 4, 2, {{"R0", 3}, {"R1", 2}, {"R2", 2}}, rm.resources(), 3, "P1");
        pm.add_process("Proc-2", 0, 8, 4, {{"R0", 9}, {"R1", 0}, {"R2", 2}}, rm.resources(), 6, "P2");
        pm.add_process("Proc-3", 0, 3, 1, {{"R0", 2}, {"R1", 2}, {"R2", 2}}, rm.resources(), 2, "P3");
        pm.add_process("Proc-4", 0, 5, 5, {{"R0", 4}, {"R1", 3}, {"R2", 3}}, rm.resources(), 4, "P4");

        allocate_direct(pm, rm, "P0", {{"R0", 0}, {"R1", 1}, {"R2", 0}});
        allocate_direct(pm, rm, "P1", {{"R0", 2}, {"R1", 0}, {"R2", 0}});
        allocate_direct(pm, rm, "P2", {{"R0", 3}, {"R1", 0}, {"R2", 2}});
        allocate_direct(pm, rm, "P3", {{"R0", 2}, {"R1", 1}, {"R2", 1}});
        allocate_direct(pm, rm, "P4", {{"R0", 0}, {"R1", 0}, {"R2", 2}});
        append_event(state, "INFO", "success", "Loaded Classic Banker's Safe State preset (Safe Seq: P1->P3->P4->P0->P2).");
    } else if (preset_name == "unsafe_no_deadlock" || preset_name == "unsafe_without_deadlock") {
        rm.add_resource("Tape Drive", ResourceCategory::STORAGE, 4, false, "R0");
        rm.add_resource("Network Link", ResourceCategory::IO, 2, true, "R1");

        pm.add_process("Backup-A", 0, 6, 2, {{"R0", 4}, {"R1", 1}}, rm.resources(), 4, "P0");
        pm.add_process("Backup-B", 0, 5, 3, {{"R0", 3}, {"R1", 2}}, rm.resources(), 3, "P1");

        allocate_direct(pm, rm, "P0", {{"R0", 2}, {"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R0", 1}, {"R1", 0}});
        append_event(state, "INFO", "warning", "Loaded Unsafe State Without Deadlock preset.");
    } else if (preset_name == "resource_starvation") {
        rm.add_resource("Priority Bus", ResourceCategory::IO, 2, false, "R0");
        rm.add_resource("RAM Slice", ResourceCategory::MEMORY, 3, false, "R1");

        pm.add_process("Realtime-1", 0, 12, 1, {{"R0", 1}, {"R1", 2}}, rm.resources(), 9, "P0");
        pm.add_process("Realtime-2", 0, 10, 1, {{"R0", 1}, {"R1", 1}}, rm.resources(), 8, "P1");
        pm.add_process("LowPrio-Batch", 0, 6, 10, {{"R0", 2}, {"R1", 2}}, rm.resources(), 1, "P2");

        allocate_direct(pm, rm, "P0", {{"R0", 1}, {"R1", 2}});
        allocate_direct(pm, rm, "P1", {{"R0", 1}, {"R1", 1}});
        allocate_direct(pm, rm, "P2", {}, {{"R0", 1}, {"R1", 1}});
        append_event(state, "REQUEST", "warning", "Loaded Resource Starvation preset (P2 blocked behind high-priority holders).");
    } else if (preset_name == "high_contention") {
        rm.add_resource("Core Pool", ResourceCategory::COMPUTE, 3, true, "R0");
        rm.add_resource("DB Lock", ResourceCategory::LOCK, 2, false, "R1");
        rm.add_resource("NVMe Bus", ResourceCategory::STORAGE, 2, false, "R2");

        pm.add_process("Query-0", 0, 7, 2, {{"R0", 2}, {"R1", 1}, {"R2", 1}}, rm.resources(), 5, "P0");
        pm.add_process("Query-1", 0, 6, 3, {{"R0", 1}, {"R1", 2}, {"R2", 1}}, rm.resources(), 4, "P1");
        pm.add_process("Query-2", 0, 8, 4, {{"R0", 2}, {"R1", 1}, {"R2", 2}}, rm.resources(), 3, "P2");
        pm.add_process("Query-3", 0, 5, 5, {{"R0", 1}, {"R1", 1}, {"R2", 1}}, rm.resources(), 2, "P3");

        allocate_direct(pm, rm, "P0", {{"R0", 1}, {"R1", 1}}, {{"R2", 1}});
        allocate_direct(pm, rm, "P1", {{"R0", 1}, {"R2", 1}}, {{"R1", 1}});
        allocate_direct(pm, rm, "P2", {{"R1", 1}, {"R2", 1}}, {{"R0", 1}});
        allocate_direct(pm, rm, "P3", {{"R0", 1}}, {});
        append_event(state, "INFO", "warning", "Loaded High Contention preset (near-saturated pools).");
    } else if (preset_name == "recovery_demo" || preset_name == "recovery_experiment") {
        rm.add_resource("Socket Port", ResourceCategory::IO, 1, false, "R0");
        rm.add_resource("Cache Slot", ResourceCategory::MEMORY, 1, true, "R1");
        rm.add_resource("Write Lock", ResourceCategory::LOCK, 1, false, "R2");

        pm.add_process("CriticalGateway", 0, 9, 1, {{"R0", 1}, {"R1", 1}}, rm.resources(), 10, "P0");
        pm.add_process("TempWorker", 0, 4, 8, {{"R1", 1}, {"R2", 1}}, rm.resources(), 1, "P1");
        pm.add_process("AnalyticsJob", 0, 6, 4, {{"R0", 1}, {"R2", 1}}, rm.resources(), 5, "P2");

        // Save initial safe checkpoint before introducing 3-way deadlock
        refresh_diagnostics(state, pm, rm, false);
        save_checkpoint(state);

        allocate_direct(pm, rm, "P0", {{"R0", 1}}, {{"R1", 1}});
        allocate_direct(pm, rm, "P1", {{"R1", 1}}, {{"R2", 1}});
        allocate_direct(pm, rm, "P2", {{"R2", 1}}, {{"R0", 1}});
        append_event(state, "DEADLOCK", "warning", "Loaded Recovery Experiment preset (3-process cycle with saved clean checkpoint).");
    } else {
        throw std::invalid_argument("Unknown preset name: " + preset_name);
    }

    refresh_diagnostics(state, pm, rm, true);
    if (state.checkpoints.empty()) {
        save_checkpoint(state);
    }
    return state;
}

SimulationState SimulationEngine::generate_random_workload(
    int process_count,
    int resource_count,
    unsigned int seed
) {
    process_count = std::clamp(process_count, 2, 12);
    resource_count = std::clamp(resource_count, 2, 6);

    std::mt19937 rng(seed);
    SimulationState state;
    state.seed = seed;
    state.preset = "random_seed_" + std::to_string(seed);
    state.status = SimStatus::IDLE;

    ResourceManager rm;
    const std::vector<std::pair<std::string, ResourceCategory>> res_names = {
        {"Compute Core", ResourceCategory::COMPUTE},
        {"Memory Bank", ResourceCategory::MEMORY},
        {"DB Lock", ResourceCategory::LOCK},
        {"I/O Bus", ResourceCategory::IO},
        {"Storage Array", ResourceCategory::STORAGE},
        {"GPU Slice", ResourceCategory::COMPUTE}
    };
    std::uniform_int_distribution<int> inst_dist(2, 6);
    for (int i = 0; i < resource_count; ++i) {
        const auto& spec = res_names[static_cast<std::size_t>(i) % res_names.size()];
        rm.add_resource(spec.first + " " + std::to_string(i), spec.second, inst_dist(rng), (i % 2 == 0));
    }

    ProcessManager pm;
    std::uniform_int_distribution<int> burst_dist(4, 12);
    std::uniform_int_distribution<int> prio_dist(1, 9);
    std::uniform_int_distribution<int> cost_dist(1, 10);

    for (int i = 0; i < process_count; ++i) {
        ResourceVector max_d;
        for (const auto& r : rm.resources()) {
            std::uniform_int_distribution<int> max_dist(0, std::max(1, r.total_instances - 1));
            max_d[r.id] = max_dist(rng);
        }
        pm.add_process(
            "CityTask-" + std::to_string(i),
            0,
            burst_dist(rng),
            prio_dist(rng),
            max_d,
            rm.resources(),
            cost_dist(rng)
        );
    }

    // Seed initial safe-ish partial allocations
    for (auto& p : pm.mutable_processes()) {
        for (const auto& r : rm.resources()) {
            const int cap = std::min(p.max_demand.at(r.id), r.available_instances);
            if (cap > 0) {
                std::uniform_int_distribution<int> alloc_dist(0, cap / 2);
                const int qty = alloc_dist(rng);
                if (qty > 0) {
                    std::string err;
                    if (rm.allocate(r.id, qty, err)) {
                        p.allocated[r.id] += qty;
                    }
                }
            }
        }
        pm.recompute_need(p, rm.resources());
    }

    append_event(state, "INFO", "info", "Generated deterministic random workload (seed=" + std::to_string(seed) + ").");
    refresh_diagnostics(state, pm, rm, true);
    save_checkpoint(state);
    return state;
}

void SimulationEngine::step_internal(SimulationState& state, ProcessManager& pm, ResourceManager& rm) {
    state.tick += 1;

    // 1. Admit NEW processes whose arrival_time <= tick
    for (auto& p : pm.mutable_processes()) {
        if (p.state == ProcessState::NEW && p.arrival_time <= state.tick) {
            p.state = ProcessState::READY;
        }
    }

    // 2. Retry BLOCKED pending requests if resources became available
    auto unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
    state.granted_request_count += static_cast<int>(unblocked.size());
    for (const auto& pid : unblocked) {
        append_event(
            state,
            "ALLOCATION",
            "success",
            "Granted pending request for unblocked process " + pid + ".",
            {{"process_id", pid}}
        );
    }

    // 3. Increment waiting_ticks on blocked/waiting processes
    for (auto& p : pm.mutable_processes()) {
        if (p.state == ProcessState::BLOCKED || p.state == ProcessState::WAITING) {
            p.waiting_ticks += 1;
        }
    }

    // 4. Advance one runnable process (RUNNING first, else highest-priority READY)
    Process* runner = nullptr;
    for (auto& p : pm.mutable_processes()) {
        if (p.state == ProcessState::RUNNING) {
            runner = &p;
            break;
        }
    }
    if (!runner) {
        for (auto& p : pm.mutable_processes()) {
            if (p.state == ProcessState::READY) {
                if (!runner || p.priority < runner->priority) {
                    runner = &p;
                }
            }
        }
        if (runner) {
            runner->state = ProcessState::RUNNING;
            append_event(
                state,
                "PROCESS",
                "info",
                "Dispatched process " + runner->id + " (" + runner->name + ") to RUNNING.",
                {{"process_id", runner->id}, {"transition", "READY->RUNNING"}}
            );
        }
    }

    if (runner) {
        runner->remaining_time = std::max(0, runner->remaining_time - 1);
        if (runner->remaining_time == 0) {
            std::string err;
            const std::string finished_id = runner->id;
            pm.terminate_process(finished_id, rm, err);
            state.completed_count += 1;
            append_event(
                state,
                "PROCESS",
                "success",
                "Process " + finished_id + " completed execution and released all resources.",
                {{"process_id", finished_id}, {"transition", "RUNNING->COMPLETED"}}
            );

            // Re-check blocked processes immediately after completion releases resources
            auto post_unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(post_unblocked.size());
            for (const auto& pid : post_unblocked) {
                append_event(
                    state,
                    "ALLOCATION",
                    "success",
                    "Process " + pid + " acquired freed resources and resumed READY.",
                    {{"process_id", pid}}
                );
            }
        }
    }

    refresh_diagnostics(state, pm, rm, true);
}

nlohmann::json SimulationEngine::preset_catalog() {
    return nlohmann::json::array({
        {
            {"id", "normal_workload"},
            {"name", "Normal Workload"},
            {"category", "Safe"},
            {"description", "Balanced 4-process city workload with healthy resource headroom across Compute, Memory, and Disk."},
            {"os_concept", "Safe Multi-Process Resource Sharing"},
            {"initial_process_count", 4},
            {"initial_resource_config", {{"R0", 6}, {"R1", 6}, {"R2", 4}}},
            {"expected_behavior", "Remains SAFE; all processes complete cleanly as resources recycle across ticks."},
            {"learning_objective", "Observe normal resource allocation, process completion, and declining utilization in a healthy OS."},
            {"recommended_actions", {"Step +1 Tick", "Run Banker Safety Check", "Inspect Utilization Charts"}},
            {"default_seed", 42}
        },
        {
            {"id", "classic_banker_safe"},
            {"name", "Classic Banker's Safe State"},
            {"category", "Safe"},
            {"description", "Textbook Silberschatz 5-process (P0-P4), 3-resource (10, 5, 7) safe state verification scenario."},
            {"os_concept", "Banker's Algorithm Safe Sequence Verification"},
            {"initial_process_count", 5},
            {"initial_resource_config", {{"R0", 10}, {"R1", 5}, {"R2", 7}}},
            {"expected_behavior", "Banker's algorithm finds the canonical safe completion order P1 -> P3 -> P4 -> P0 -> P2."},
            {"learning_objective", "Verify Need = Max - Allocation and trace Work/Finish execution step-by-step."},
            {"recommended_actions", {"Open Banker's Lab", "Test P1 [1,0,2] Grant", "Test Unsafe Request Rejection"}},
            {"default_seed", 42}
        },
        {
            {"id", "single_instance_deadlock"},
            {"name", "Single-Instance Deadlock"},
            {"category", "Deadlock"},
            {"description", "Classic P0 <-> P1 circular wait over single-unit Printer A (R0) and Database Lock B (R1)."},
            {"os_concept", "Coffman Circular Wait with Single-Instance Resources"},
            {"initial_process_count", 2},
            {"initial_resource_config", {{"R0", 1}, {"R1", 1}}},
            {"expected_behavior", "Immediate DEADLOCKED state with Wait-For cycle P0 -> P1 -> P0; auto-run halts."},
            {"learning_objective", "Contrast single-instance RAG cycle sufficiency for deadlock against multi-instance pools."},
            {"recommended_actions", {"Inspect RAG & WFG", "Run Detection Trace", "Compare Recovery Strategies"}},
            {"default_seed", 42}
        },
        {
            {"id", "multiple_instance_deadlock"},
            {"name", "Multi-Instance Deadlock"},
            {"category", "Deadlock"},
            {"description", "Saturated 2-unit GPU Cluster and Lock Table pools where Trainer-Alpha and Trainer-Beta hold and request conflicting units."},
            {"os_concept", "Deadlock Detection Matrix Algorithm (Multiple Instances)"},
            {"initial_process_count", 3},
            {"initial_resource_config", {{"R0", 2}, {"R1", 2}}},
            {"expected_behavior", "DEADLOCKED across P0 and P1 while Monitor (P2) requires no unallocated units."},
            {"learning_objective", "Observe Request <= Work matrix reduction when multiple resource instances exist."},
            {"recommended_actions", {"Run Detection Matrix Trace", "Preempt GPU Cluster (R0)", "Terminate Lowest-Cost Victim"}},
            {"default_seed", 42}
        },
        {
            {"id", "multi_instance_safe_cycle"},
            {"name", "Multi-Instance Cycle (Safe)"},
            {"category", "Safe"},
            {"description", "Demonstrates a Resource Allocation Graph cycle involving P0, P1, R0, and R1 that resolves without deadlock via Finisher-2 releasing R0."},
            {"os_concept", "Cycle Necessary But Not Sufficient (Multi-Instance RAG)"},
            {"initial_process_count", 3},
            {"initial_resource_config", {{"R0", 2}, {"R1", 1}}},
            {"expected_behavior", "RAG reports has_cycle_in_rag=true, yet Finisher-2 (P2) can finish and break the cycle (detected=false)."},
            {"learning_objective", "Understand why graph cycle detection alone yields false positives on multi-instance resources."},
            {"recommended_actions", {"Open RAG Graph", "Compare RAG vs WFG", "Step Simulation to Watch P2 Free R0"}},
            {"default_seed", 42}
        },
        {
            {"id", "unsafe_no_deadlock"},
            {"name", "Unsafe State (No Deadlock)"},
            {"category", "Unsafe"},
            {"description", "Backup-A and Backup-B hold 3/4 Tape Drives and 1/2 Network Links with zero blocking, yet no safe sequence exists for worst-case Max claims."},
            {"os_concept", "Banker's Unsafe Region vs Actual Deadlock"},
            {"initial_process_count", 2},
            {"initial_resource_config", {{"R0", 4}, {"R1", 2}}},
            {"expected_behavior", "safety_status=UNSAFE, deadlock_report.detected=false; neither process is deadlocked yet."},
            {"learning_objective", "Distinguish unsafe states (loss of deadlock avoidance guarantee) from confirmed runtime deadlock."},
            {"recommended_actions", {"Inspect Banker's Matrix", "Run Detection Lab", "Step Simulation to Observe Execution"}},
            {"default_seed", 42}
        },
        {
            {"id", "resource_starvation"},
            {"name", "Resource Starvation"},
            {"category", "Contention"},
            {"description", "Low-priority LowPrio-Batch (P2) waits indefinitely behind priority-1 Realtime holders across Priority Bus and RAM Slice."},
            {"os_concept", "Indefinite Blocking / Priority Contention"},
            {"initial_process_count", 3},
            {"initial_resource_config", {{"R0", 2}, {"R1", 3}}},
            {"expected_behavior", "P2 accumulates waiting_ticks while P0 and P1 execute first until their completion frees resources."},
            {"learning_objective", "Measure waiting_ticks and contrast starvation with circular deadlock."},
            {"recommended_actions", {"Monitor Avg Waiting Ticks", "Step 5+ Ticks", "Inspect Event Timeline"}},
            {"default_seed", 42}
        },
        {
            {"id", "high_contention"},
            {"name", "High Contention"},
            {"category", "Contention"},
            {"description", "Near-saturated Core Pool, DB Lock, and NVMe Bus with three competing Query tasks waiting on mutually held pools."},
            {"os_concept", "High Resource Utilization & Cascade Blocking"},
            {"initial_process_count", 4},
            {"initial_resource_config", {{"R0", 3}, {"R1", 2}, {"R2", 2}}},
            {"expected_behavior", "High utilization with blocked processes relying on Query-3 completion or recovery intervention."},
            {"learning_objective", "Observe how contention elevates utilization_pct and triggers cascading unblocking or deadlock."},
            {"recommended_actions", {"Watch Utilization Chart", "Inspect Deadlock Status", "Test Preemption Recovery"}},
            {"default_seed", 42}
        },
        {
            {"id", "recovery_demo"},
            {"name", "Recovery Experiment"},
            {"category", "Deadlock"},
            {"description", "3-process circular wait (CriticalGateway, TempWorker, AnalyticsJob) pre-loaded with a clean initial recovery checkpoint."},
            {"os_concept", "Deadlock Recovery (Termination, Preemption, Checkpoint Rollback)"},
            {"initial_process_count", 3},
            {"initial_resource_config", {{"R0", 1}, {"R1", 1}, {"R2", 1}}},
            {"expected_behavior", "DEADLOCKED at tick 0 with 1 preemptible resource (R1) and 1 clean pre-deadlock checkpoint (#0)."},
            {"learning_objective", "Compare victim selection cost vs resource preemption vs checkpoint rollback restoration."},
            {"recommended_actions", {"Open Recovery Center", "Create Checkpoint", "Compare All Recovery Strategies"}},
            {"default_seed", 42}
        }
    });
}

nlohmann::json SimulationEngine::execute_command(const nlohmann::json& req) {
    const std::string cmd = req.value("command", std::string{});
    if (cmd.empty()) {
        return err_response("", "MISSING_COMMAND", "Request JSON must include a non-empty 'command' field.");
    }

    const nlohmann::json payload = req.contains("payload") && req["payload"].is_object()
        ? req["payload"]
        : nlohmann::json::object();

    try {
        // Standalone commands (no SimulationState needed)
        if (cmd == "health") {
            return ok_response(cmd, std::nullopt, {{"engine_version", "1.0.0"}, {"status", "ok"}});
        }

        if (cmd == "list_presets") {
            return ok_response(cmd, std::nullopt, {
                {"presets", preset_catalog()},
                {"random_workload", {
                    {"min_processes", 2},
                    {"max_processes", 12},
                    {"min_resources", 2},
                    {"max_resources", 6},
                    {"default_seed", 42}
                }}
            });
        }

        if (cmd == "compare_scheduling") {
            const int quantum = payload.value("quantum", 2);
            if (!payload.contains("processes") || !payload["processes"].is_array()) {
                return err_response(cmd, "INVALID_PAYLOAD", "payload.processes array is required.");
            }
            std::vector<ScheduleInputProcess> inputs;
            for (const auto& item : payload["processes"]) {
                inputs.push_back(ScheduleInputProcess{
                    item.at("id").get<std::string>(),
                    item.value("name", item.at("id").get<std::string>()),
                    item.value("arrival_time", 0),
                    item.value("burst_time", 1),
                    item.value("priority", 5)
                });
            }
            auto results = scheduler_.compare_all(inputs, quantum);
            nlohmann::json arr = nlohmann::json::array();
            for (const auto& r : results) arr.push_back(SimulationSerializer::to_json(r));
            return ok_response(cmd, std::nullopt, {{"comparisons", arr}});
        }

        if (cmd == "run_synchronization") {
            SyncRequest sreq;
            sreq.scenario = sync_scenario_from_string(payload.value("scenario", std::string("producer_consumer")));
            sreq.mode = sync_mode_from_string(payload.value("mode", std::string("safe")));
            sreq.iterations = payload.value("iterations", 10);
            sreq.buffer_size = payload.value("buffer_size", 4);
            sreq.seed = payload.value("seed", 42u);
            auto report = sync_lab_.run(sreq);
            return ok_response(cmd, std::nullopt, SimulationSerializer::to_json(report));
        }

        if (cmd == "create_simulation" || cmd == "load_preset" || cmd == "reset_simulation") {
            const unsigned int seed = payload.value("seed", 42u);
            std::optional<std::string> preset;
            if (payload.contains("preset") && payload["preset"].is_string() && !payload["preset"].get<std::string>().empty()) {
                preset = payload["preset"].get<std::string>();
            }
            auto state = create_simulation(seed, preset);
            return ok_response(cmd, state, {{"initialized", true}});
        }

        if (cmd == "generate_random_workload") {
            const int p_count = payload.value("process_count", 5);
            const int r_count = payload.value("resource_count", 3);
            const unsigned int seed = payload.value("seed", 42u);
            auto state = generate_random_workload(p_count, r_count, seed);
            return ok_response(cmd, state, {{"seed", seed}});
        }

        // State-mutating / inspecting commands
        if (!req.contains("state") || req["state"].is_null()) {
            return err_response(cmd, "MISSING_STATE", "Command '" + cmd + "' requires a valid 'state' object.");
        }

        SimulationState state = SimulationSerializer::state_from_json(req["state"]);
        ResourceManager rm(state.resources);
        ProcessManager pm(state.processes);
        pm.sync_resource_keys(rm.resources());

        if (cmd == "step_simulation") {
            step_internal(state, pm, rm);
            return ok_response(cmd, state, {{"tick", state.tick}});
        }

        if (cmd == "create_checkpoint") {
            save_checkpoint(state);
            append_event(
                state,
                "CHECKPOINT",
                "info",
                "Saved recovery checkpoint at tick " + std::to_string(state.tick) + ".",
                {{"checkpoint_index", std::to_string(state.checkpoints.size() - 1)}}
            );
            return ok_response(cmd, state, {{"checkpoint_count", state.checkpoints.size()}});
        }

        if (cmd == "add_process") {
            if (pm.processes().size() >= 24) {
                return err_response(cmd, "PROCESS_LIMIT_EXCEEDED", "Maximum 24 processes per simulation session exceeded.", state);
            }
            ResourceVector max_d;
            if (payload.contains("max_demand") && payload["max_demand"].is_object()) {
                max_d = payload["max_demand"].get<ResourceVector>();
            }
            std::optional<std::string> explicit_id;
            if (payload.contains("id") && payload["id"].is_string() && !payload["id"].get<std::string>().empty()) {
                explicit_id = payload["id"].get<std::string>();
            }
            auto proc = pm.add_process(
                payload.at("name").get<std::string>(),
                payload.value("arrival_time", state.tick),
                payload.value("burst_time", 5),
                payload.value("priority", 5),
                max_d,
                rm.resources(),
                payload.value("termination_cost", 3),
                explicit_id,
                payload.value("arrival_time", state.tick) > state.tick ? ProcessState::NEW : ProcessState::READY
            );
            append_event(state, "PROCESS", "info", "Created process " + proc.id + " (" + proc.name + ").", {{"process_id", proc.id}});
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"process", SimulationSerializer::to_json(proc)}});
        }

        if (cmd == "remove_process" || cmd == "terminate_process") {
            const std::string pid = payload.at("process_id").get<std::string>();
            std::string err;
            if (!pm.terminate_process(pid, rm, err)) {
                return err_response(cmd, "PROCESS_ERROR", err, state);
            }
            auto unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(unblocked.size());
            append_event(state, "PROCESS", "info", "Terminated process " + pid + " and released held resources.", {{"process_id", pid}});
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"terminated", pid}, {"unblocked_processes", unblocked}});
        }

        if (cmd == "suspend_process") {
            const std::string pid = payload.at("process_id").get<std::string>();
            std::string err;
            if (!pm.suspend_process(pid, err)) {
                return err_response(cmd, "PROCESS_ERROR", err, state);
            }
            append_event(state, "PROCESS", "warning", "Suspended process " + pid + ".", {{"process_id", pid}, {"transition", "SUSPENDED"}});
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, {{"process_id", pid}});
        }

        if (cmd == "resume_process") {
            const std::string pid = payload.at("process_id").get<std::string>();
            std::string err;
            if (!pm.resume_process(pid, err)) {
                return err_response(cmd, "PROCESS_ERROR", err, state);
            }
            append_event(state, "PROCESS", "info", "Resumed process " + pid + ".", {{"process_id", pid}, {"transition", "RESUMED"}});
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, {{"process_id", pid}});
        }

        if (cmd == "add_resource") {
            if (rm.resources().size() >= 12) {
                return err_response(cmd, "RESOURCE_LIMIT_EXCEEDED", "Maximum 12 resource pools per simulation session exceeded.", state);
            }
            const int inst_count = payload.at("total_instances").get<int>();
            if (inst_count < 1 || inst_count > 64) {
                return err_response(cmd, "VALIDATION_ERROR", "Resource total_instances must be between 1 and 64.", state);
            }
            std::optional<std::string> explicit_id;
            if (payload.contains("id") && payload["id"].is_string() && !payload["id"].get<std::string>().empty()) {
                explicit_id = payload["id"].get<std::string>();
            }
            auto res = rm.add_resource(
                payload.at("name").get<std::string>(),
                resource_category_from_string(payload.value("category", std::string("COMPUTE"))),
                payload.at("total_instances").get<int>(),
                payload.value("preemptible", false),
                explicit_id
            );
            pm.sync_resource_keys(rm.resources());
            append_event(state, "RESOURCE", "info", "Added resource facility " + res.id + " (" + res.name + " x" + std::to_string(res.total_instances) + ").", {{"resource_id", res.id}});
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"resource", SimulationSerializer::to_json(res)}});
        }

        if (cmd == "modify_resource") {
            const std::string rid = payload.at("resource_id").get<std::string>();
            std::optional<int> new_total;
            std::optional<bool> new_preempt;
            if (payload.contains("total_instances") && payload["total_instances"].is_number_integer()) {
                new_total = payload["total_instances"].get<int>();
            }
            if (payload.contains("preemptible") && payload["preemptible"].is_boolean()) {
                new_preempt = payload["preemptible"].get<bool>();
            }
            std::string err;
            if (!rm.modify_resource(rid, new_total, new_preempt, err)) {
                return err_response(cmd, "RESOURCE_ERROR", err, state);
            }
            auto unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(unblocked.size());
            append_event(state, "RESOURCE", "info", "Updated resource " + rid + ".", {{"resource_id", rid}});
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"resource_id", rid}});
        }

        if (cmd == "request_resources") {
            const std::string pid = payload.at("process_id").get<std::string>();
            const ResourceVector req_vec = payload.at("request").get<ResourceVector>();
            const bool use_banker = payload.value("use_banker", true);

            auto eval = banker_.evaluate_request(pm.processes(), rm.resources(), pid, req_vec, use_banker);
            if (eval.error_code == "PROCESS_NOT_FOUND" ||
                eval.error_code == "PROCESS_TERMINATED" ||
                eval.error_code == "RESOURCE_NOT_FOUND" ||
                eval.error_code == "INVALID_REQUEST" ||
                eval.error_code == "REQUEST_EXCEEDS_NEED") {
                state.rejected_request_count += 1;
                append_event(state, "REJECTION", "error", eval.reason, {{"process_id", pid}, {"reason_code", eval.error_code}});
                return err_response(cmd, eval.error_code, eval.reason, state, {
                    {"granted", false},
                    {"waited", false},
                    {"reason", eval.reason},
                    {"banker_report", SimulationSerializer::to_json(eval.banker_report)}
                });
            }

            if (eval.waited) {
                auto* p = pm.find_mut(pid);
                for (const auto& [rid, qty] : req_vec) {
                    if (qty > 0) p->pending_request[rid] += qty;
                }
                p->state = ProcessState::BLOCKED;
                append_event(state, "REQUEST", "warning", eval.reason, {{"process_id", pid}});
                refresh_diagnostics(state, pm, rm, true);
                return ok_response(cmd, state, {
                    {"granted", false},
                    {"waited", true},
                    {"reason", eval.reason},
                    {"banker_report", SimulationSerializer::to_json(eval.banker_report)}
                });
            }

            if (!eval.approved) {
                // Banker's Algorithm rejected unsafe request and rolled back
                state.rejected_request_count += 1;
                append_event(state, "REJECTION", "warning", eval.reason, {{"process_id", pid}, {"reason_code", "UNSAFE_STATE_REJECTED"}});
                refresh_diagnostics(state, pm, rm, false);
                return ok_response(cmd, state, {
                    {"granted", false},
                    {"waited", false},
                    {"reason", eval.reason},
                    {"banker_report", SimulationSerializer::to_json(eval.banker_report)}
                });
            }

            // Grant allocation
            save_checkpoint(state);
            auto* p = pm.find_mut(pid);
            std::string first_rid;
            for (const auto& [rid, qty] : req_vec) {
                if (qty > 0) {
                    if (first_rid.empty()) first_rid = rid;
                    std::string err;
                    rm.allocate(rid, qty, err);
                    p->allocated[rid] += qty;
                }
            }
            pm.recompute_need(*p, rm.resources());
            if (p->state == ProcessState::BLOCKED || p->state == ProcessState::WAITING) {
                p->state = ProcessState::READY;
            }
            state.granted_request_count += 1;
            std::map<std::string, std::string> meta = {{"process_id", pid}};
            if (!first_rid.empty()) meta["resource_id"] = first_rid;
            append_event(state, "ALLOCATION", "success", "Granted resource request for " + pid + ".", meta);
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {
                {"granted", true},
                {"waited", false},
                {"reason", eval.reason},
                {"banker_report", SimulationSerializer::to_json(state.banker_report)}
            });
        }

        if (cmd == "release_resources") {
            const std::string pid = payload.at("process_id").get<std::string>();
            const ResourceVector rel_vec = payload.at("release").get<ResourceVector>();
            auto* p = pm.find_mut(pid);
            if (!p) {
                return err_response(cmd, "PROCESS_NOT_FOUND", "Process not found: " + pid, state);
            }
            for (const auto& [rid, qty] : rel_vec) {
                if (qty < 0) {
                    return err_response(cmd, "INVALID_RELEASE", "Negative release count.", state);
                }
                const int held = p->allocated.count(rid) ? p->allocated.at(rid) : 0;
                if (qty > held) {
                    return err_response(cmd, "RELEASE_EXCEEDS_ALLOCATION",
                                        "Process " + pid + " only holds " + std::to_string(held) + " units of " + rid + ".",
                                        state);
                }
            }
            std::string first_rid;
            for (const auto& [rid, qty] : rel_vec) {
                if (qty > 0) {
                    if (first_rid.empty()) first_rid = rid;
                    std::string err;
                    rm.release(rid, qty, err);
                    p->allocated[rid] -= qty;
                }
            }
            pm.recompute_need(*p, rm.resources());
            auto unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(unblocked.size());
            std::map<std::string, std::string> meta = {{"process_id", pid}};
            if (!first_rid.empty()) meta["resource_id"] = first_rid;
            append_event(state, "RELEASE", "info", "Process " + pid + " released resources.", meta);
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"released", true}, {"unblocked_processes", unblocked}});
        }

        if (cmd == "detect_deadlock") {
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, SimulationSerializer::to_json(state.deadlock_report));
        }

        if (cmd == "check_banker_safety") {
            if (payload.contains("process_id") && payload["process_id"].is_string() &&
                payload.contains("hypothetical_request") && payload["hypothetical_request"].is_object()) {
                const std::string pid = payload["process_id"].get<std::string>();
                const auto req_vec = payload["hypothetical_request"].get<ResourceVector>();
                auto eval = banker_.evaluate_request(pm.processes(), rm.resources(), pid, req_vec, true);
                return ok_response(cmd, state, {
                    {"would_approve", eval.approved},
                    {"waited", eval.waited},
                    {"error_code", eval.error_code},
                    {"reason", eval.reason},
                    {"banker_report", SimulationSerializer::to_json(eval.banker_report)}
                });
            }
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, SimulationSerializer::to_json(state.banker_report));
        }

        if (cmd == "recover_deadlock") {
            RecoveryRequest rreq;
            rreq.strategy = recovery_strategy_from_string(payload.value("strategy", std::string("terminate_victim")));
            rreq.victim_criteria = victim_criteria_from_string(payload.value("victim_criteria", std::string("lowest_cost")));
            if (payload.contains("target_process_id") && payload["target_process_id"].is_string()) {
                rreq.target_process_id = payload["target_process_id"].get<std::string>();
            }
            if (payload.contains("target_resource_id") && payload["target_resource_id"].is_string()) {
                rreq.target_resource_id = payload["target_resource_id"].get<std::string>();
            }
            if (payload.contains("checkpoint_index") && payload["checkpoint_index"].is_number_integer()) {
                rreq.checkpoint_index = payload["checkpoint_index"].get<std::size_t>();
            }

            auto rres = recovery_.recover(state, pm, rm, detector_, banker_, rreq);
            if (!rres.ok) {
                return err_response(cmd, rres.error_code, rres.message, state, SimulationSerializer::to_json(rres));
            }
            std::map<std::string, std::string> meta = {{"strategy", to_string(rreq.strategy)}};
            if (!rres.terminated_processes.empty()) meta["process_id"] = rres.terminated_processes.front();
            if (!rres.preempted_resources.empty()) meta["resource_id"] = rres.preempted_resources.front();
            append_event(
                state,
                rreq.strategy == RecoveryStrategy::ROLLBACK ? "ROLLBACK" : "RECOVERY",
                "success",
                rres.message,
                meta
            );
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, SimulationSerializer::to_json(rres));
        }

        return err_response(cmd, "UNKNOWN_COMMAND", "Unsupported engine command: " + cmd, state);
    } catch (const std::invalid_argument& e) {
        return err_response(cmd, "VALIDATION_ERROR", e.what());
    } catch (const std::exception& e) {
        return err_response(cmd, "ENGINE_ERROR", e.what());
    }
}

} // namespace deadlock_city
