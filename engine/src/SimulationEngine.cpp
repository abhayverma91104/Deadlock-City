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
    SimulationEvent ev;
    ev.id = "ev_" + std::to_string(state.tick) + "_" + std::to_string(state.events.size() + 1);
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
    const bool was_deadlocked = (state.safety_status == SafetyStatus::DEADLOCKED);
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

    if (record_metric) {
        int total_inst = 0;
        int alloc_inst = 0;
        for (const auto& r : state.resources) {
            total_inst += r.total_instances;
            alloc_inst += r.allocated_instances;
        }
        int active = 0;
        int blocked = 0;
        for (const auto& p : state.processes) {
            if (p.state != ProcessState::TERMINATED) active++;
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
        state.metrics_history.push_back(mp);
        if (state.metrics_history.size() > 240) {
            state.metrics_history.erase(state.metrics_history.begin());
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
    for (const auto& pid : unblocked) {
        append_event(state, "ALLOCATION", "success", "Granted pending request for unblocked process " + pid + ".");
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
        }
    }

    if (runner) {
        runner->remaining_time = std::max(0, runner->remaining_time - 1);
        if (runner->remaining_time == 0) {
            std::string err;
            const std::string finished_id = runner->id;
            pm.terminate_process(finished_id, rm, err);
            append_event(state, "PROCESS", "success", "Process " + finished_id + " completed execution and released all resources.");

            // Re-check blocked processes immediately after completion releases resources
            auto post_unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            for (const auto& pid : post_unblocked) {
                append_event(state, "ALLOCATION", "success", "Process " + pid + " acquired freed resources and resumed READY.");
            }
        }
    }

    refresh_diagnostics(state, pm, rm, true);
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
            append_event(state, "INFO", "info", "Saved recovery checkpoint at tick " + std::to_string(state.tick) + ".");
            return ok_response(cmd, state, {{"checkpoint_count", state.checkpoints.size()}});
        }

        if (cmd == "add_process") {
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
            append_event(state, "PROCESS", "info", "Created process " + proc.id + " (" + proc.name + ").");
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
            append_event(state, "PROCESS", "info", "Terminated process " + pid + " and released held resources.");
            refresh_diagnostics(state, pm, rm, true);
            return ok_response(cmd, state, {{"terminated", pid}, {"unblocked_processes", unblocked}});
        }

        if (cmd == "suspend_process") {
            const std::string pid = payload.at("process_id").get<std::string>();
            std::string err;
            if (!pm.suspend_process(pid, err)) {
                return err_response(cmd, "PROCESS_ERROR", err, state);
            }
            append_event(state, "PROCESS", "warning", "Suspended process " + pid + ".");
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, {{"process_id", pid}});
        }

        if (cmd == "resume_process") {
            const std::string pid = payload.at("process_id").get<std::string>();
            std::string err;
            if (!pm.resume_process(pid, err)) {
                return err_response(cmd, "PROCESS_ERROR", err, state);
            }
            append_event(state, "PROCESS", "info", "Resumed process " + pid + ".");
            refresh_diagnostics(state, pm, rm, false);
            return ok_response(cmd, state, {{"process_id", pid}});
        }

        if (cmd == "add_resource") {
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
            append_event(state, "RESOURCE", "info", "Added resource facility " + res.id + " (" + res.name + " x" + std::to_string(res.total_instances) + ").");
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
            RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            append_event(state, "RESOURCE", "info", "Updated resource " + rid + ".");
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
                append_event(state, "REJECTION", "error", eval.reason);
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
                append_event(state, "REQUEST", "warning", eval.reason);
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
                append_event(state, "REJECTION", "warning", eval.reason);
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
            for (const auto& [rid, qty] : req_vec) {
                if (qty > 0) {
                    std::string err;
                    rm.allocate(rid, qty, err);
                    p->allocated[rid] += qty;
                }
            }
            pm.recompute_need(*p, rm.resources());
            if (p->state == ProcessState::BLOCKED || p->state == ProcessState::WAITING) {
                p->state = ProcessState::READY;
            }
            append_event(state, "ALLOCATION", "success", "Granted resource request for " + pid + ".");
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
            for (const auto& [rid, qty] : rel_vec) {
                if (qty > 0) {
                    std::string err;
                    rm.release(rid, qty, err);
                    p->allocated[rid] -= qty;
                }
            }
            pm.recompute_need(*p, rm.resources());
            auto unblocked = RecoveryManager::grant_satisfied_pending_requests(pm, rm);
            append_event(state, "RELEASE", "info", "Process " + pid + " released resources.");
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
            append_event(state, "RECOVERY", "success", rres.message);
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
