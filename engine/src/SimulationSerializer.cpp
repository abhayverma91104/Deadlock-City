#include "SimulationSerializer.hpp"

namespace deadlock_city {

nlohmann::json SimulationSerializer::to_json(const CityPosition& pos) {
    return {
        {"x", pos.x},
        {"y", pos.y},
        {"z", pos.z},
        {"plot_id", pos.plot_id}
    };
}

CityPosition SimulationSerializer::city_position_from_json(const nlohmann::json& j) {
    CityPosition pos;
    pos.x = j.value("x", 0.0);
    pos.y = j.value("y", 0.0);
    pos.z = j.value("z", 0.0);
    pos.plot_id = j.value("plot_id", std::string{});
    return pos;
}

nlohmann::json SimulationSerializer::to_json(const Process& p) {
    return {
        {"id", p.id},
        {"name", p.name},
        {"arrival_time", p.arrival_time},
        {"burst_time", p.burst_time},
        {"remaining_time", p.remaining_time},
        {"priority", p.priority},
        {"state", to_string(p.state)},
        {"max_demand", p.max_demand},
        {"allocated", p.allocated},
        {"need", p.need},
        {"pending_request", p.pending_request},
        {"city_position", to_json(p.city_position)},
        {"termination_cost", p.termination_cost},
        {"waiting_ticks", p.waiting_ticks},
        {"preemption_count", p.preemption_count}
    };
}

Process SimulationSerializer::process_from_json(const nlohmann::json& j) {
    Process p;
    p.id = j.at("id").get<std::string>();
    p.name = j.at("name").get<std::string>();
    p.arrival_time = j.value("arrival_time", 0);
    p.burst_time = j.value("burst_time", 1);
    p.remaining_time = j.value("remaining_time", p.burst_time);
    p.priority = j.value("priority", 5);
    p.state = process_state_from_string(j.value("state", std::string("READY")));
    if (j.contains("max_demand") && j["max_demand"].is_object()) {
        p.max_demand = j["max_demand"].get<ResourceVector>();
    }
    if (j.contains("allocated") && j["allocated"].is_object()) {
        p.allocated = j["allocated"].get<ResourceVector>();
    }
    if (j.contains("need") && j["need"].is_object()) {
        p.need = j["need"].get<ResourceVector>();
    }
    if (j.contains("pending_request") && j["pending_request"].is_object()) {
        p.pending_request = j["pending_request"].get<ResourceVector>();
    }
    if (j.contains("city_position") && j["city_position"].is_object()) {
        p.city_position = city_position_from_json(j["city_position"]);
    }
    p.termination_cost = j.value("termination_cost", 1);
    p.waiting_ticks = j.value("waiting_ticks", 0);
    p.preemption_count = j.value("preemption_count", 0);
    return p;
}

nlohmann::json SimulationSerializer::to_json(const ResourceType& r) {
    return {
        {"id", r.id},
        {"name", r.name},
        {"category", to_string(r.category)},
        {"total_instances", r.total_instances},
        {"available_instances", r.available_instances},
        {"allocated_instances", r.allocated_instances},
        {"preemptible", r.preemptible},
        {"status", to_string(r.status)},
        {"city_position", to_json(r.city_position)}
    };
}

ResourceType SimulationSerializer::resource_from_json(const nlohmann::json& j) {
    ResourceType r;
    r.id = j.at("id").get<std::string>();
    r.name = j.at("name").get<std::string>();
    r.category = resource_category_from_string(j.value("category", std::string("COMPUTE")));
    r.total_instances = j.at("total_instances").get<int>();
    r.available_instances = j.value("available_instances", r.total_instances);
    r.allocated_instances = j.value("allocated_instances", 0);
    r.preemptible = j.value("preemptible", false);
    r.status = resource_status_from_string(j.value("status", std::string("AVAILABLE")));
    if (j.contains("city_position") && j["city_position"].is_object()) {
        r.city_position = city_position_from_json(j["city_position"]);
    }
    return r;
}

nlohmann::json SimulationSerializer::to_json(const DetectionStep& s) {
    return {
        {"step_index", s.step_index},
        {"work_before", s.work_before},
        {"work_after", s.work_after},
        {"selected_process", s.selected_process.has_value() ? nlohmann::json(*s.selected_process) : nlohmann::json(nullptr)},
        {"finish_snapshot", s.finish_snapshot},
        {"note", s.note}
    };
}

DetectionStep SimulationSerializer::detection_step_from_json(const nlohmann::json& j) {
    DetectionStep s;
    s.step_index = j.value("step_index", 0);
    if (j.contains("work_before") && j["work_before"].is_object()) {
        s.work_before = j["work_before"].get<ResourceVector>();
    }
    if (j.contains("work_after") && j["work_after"].is_object()) {
        s.work_after = j["work_after"].get<ResourceVector>();
    }
    if (j.contains("selected_process") && j["selected_process"].is_string()) {
        s.selected_process = j["selected_process"].get<std::string>();
    }
    if (j.contains("finish_snapshot") && j["finish_snapshot"].is_object()) {
        s.finish_snapshot = j["finish_snapshot"].get<std::map<std::string, bool>>();
    }
    s.note = j.value("note", std::string{});
    return s;
}

nlohmann::json SimulationSerializer::to_json(const WaitForEdge& e) {
    return {
        {"from", e.from},
        {"to", e.to},
        {"resource_id", e.resource_id}
    };
}

WaitForEdge SimulationSerializer::wait_for_edge_from_json(const nlohmann::json& j) {
    return WaitForEdge{
        j.at("from").get<std::string>(),
        j.at("to").get<std::string>(),
        j.at("resource_id").get<std::string>()
    };
}

nlohmann::json SimulationSerializer::to_json(const DeadlockReport& d) {
    nlohmann::json wfg = nlohmann::json::array();
    for (const auto& e : d.wait_for_edges) wfg.push_back(to_json(e));
    nlohmann::json steps = nlohmann::json::array();
    for (const auto& s : d.steps) steps.push_back(to_json(s));
    return {
        {"detected", d.detected},
        {"has_cycle_in_rag", d.has_cycle_in_rag},
        {"deadlocked_processes", d.deadlocked_processes},
        {"involved_resources", d.involved_resources},
        {"cycles", d.cycles},
        {"wait_for_edges", wfg},
        {"steps", steps},
        {"explanation", d.explanation}
    };
}

DeadlockReport SimulationSerializer::deadlock_report_from_json(const nlohmann::json& j) {
    DeadlockReport d;
    d.detected = j.value("detected", false);
    d.has_cycle_in_rag = j.value("has_cycle_in_rag", false);
    if (j.contains("deadlocked_processes")) d.deadlocked_processes = j["deadlocked_processes"].get<std::vector<std::string>>();
    if (j.contains("involved_resources")) d.involved_resources = j["involved_resources"].get<std::vector<std::string>>();
    if (j.contains("cycles")) d.cycles = j["cycles"].get<std::vector<std::vector<std::string>>>();
    if (j.contains("wait_for_edges")) {
        for (const auto& e : j["wait_for_edges"]) d.wait_for_edges.push_back(wait_for_edge_from_json(e));
    }
    if (j.contains("steps")) {
        for (const auto& s : j["steps"]) d.steps.push_back(detection_step_from_json(s));
    }
    d.explanation = j.value("explanation", std::string{});
    return d;
}

nlohmann::json SimulationSerializer::to_json(const BankerReport& b) {
    nlohmann::json steps = nlohmann::json::array();
    for (const auto& s : b.steps) steps.push_back(to_json(s));
    return {
        {"is_safe", b.is_safe},
        {"safe_sequence", b.safe_sequence},
        {"steps", steps},
        {"explanation", b.explanation}
    };
}

BankerReport SimulationSerializer::banker_report_from_json(const nlohmann::json& j) {
    BankerReport b;
    b.is_safe = j.value("is_safe", true);
    if (j.contains("safe_sequence")) b.safe_sequence = j["safe_sequence"].get<std::vector<std::string>>();
    if (j.contains("steps")) {
        for (const auto& s : j["steps"]) b.steps.push_back(detection_step_from_json(s));
    }
    b.explanation = j.value("explanation", std::string{});
    return b;
}

nlohmann::json SimulationSerializer::to_json(const SimulationEvent& e) {
    return {
        {"id", e.id},
        {"tick", e.tick},
        {"type", e.type},
        {"severity", e.severity},
        {"message", e.message},
        {"metadata", e.metadata}
    };
}

SimulationEvent SimulationSerializer::event_from_json(const nlohmann::json& j) {
    SimulationEvent e;
    e.id = j.value("id", std::string{});
    e.tick = j.value("tick", 0);
    e.type = j.value("type", std::string("INFO"));
    e.severity = j.value("severity", std::string("info"));
    e.message = j.value("message", std::string{});
    if (j.contains("metadata") && j["metadata"].is_object()) {
        e.metadata = j["metadata"].get<std::map<std::string, std::string>>();
    }
    return e;
}

nlohmann::json SimulationSerializer::to_json(const MetricPoint& m) {
    return {
        {"tick", m.tick},
        {"utilization_pct", m.utilization_pct},
        {"active_count", m.active_count},
        {"blocked_count", m.blocked_count},
        {"deadlocked_count", m.deadlocked_count},
        {"allocation_count", m.allocation_count}
    };
}

MetricPoint SimulationSerializer::metric_from_json(const nlohmann::json& j) {
    MetricPoint m;
    m.tick = j.value("tick", 0);
    m.utilization_pct = j.value("utilization_pct", 0.0);
    m.active_count = j.value("active_count", 0);
    m.blocked_count = j.value("blocked_count", 0);
    m.deadlocked_count = j.value("deadlocked_count", 0);
    m.allocation_count = j.value("allocation_count", 0);
    return m;
}

nlohmann::json SimulationSerializer::snapshot_to_json(const SimulationStateSnapshot& s) {
    nlohmann::json procs = nlohmann::json::array();
    for (const auto& p : s.processes) procs.push_back(to_json(p));
    nlohmann::json ress = nlohmann::json::array();
    for (const auto& r : s.resources) ress.push_back(to_json(r));
    nlohmann::json evs = nlohmann::json::array();
    for (const auto& e : s.events) evs.push_back(to_json(e));
    nlohmann::json mets = nlohmann::json::array();
    for (const auto& m : s.metrics_history) mets.push_back(to_json(m));

    return {
        {"tick", s.tick},
        {"seed", s.seed},
        {"preset", s.preset.has_value() ? nlohmann::json(*s.preset) : nlohmann::json(nullptr)},
        {"status", to_string(s.status)},
        {"safety_status", to_string(s.safety_status)},
        {"processes", procs},
        {"resources", ress},
        {"deadlock_report", to_json(s.deadlock_report)},
        {"banker_report", to_json(s.banker_report)},
        {"deadlock_count", s.deadlock_count},
        {"recovery_count", s.recovery_count},
        {"preemption_count", s.preemption_count},
        {"events", evs},
        {"metrics_history", mets}
    };
}

SimulationStateSnapshot SimulationSerializer::snapshot_from_json(const nlohmann::json& j) {
    SimulationStateSnapshot s;
    s.tick = j.value("tick", 0);
    s.seed = j.value("seed", 42u);
    if (j.contains("preset") && j["preset"].is_string()) {
        s.preset = j["preset"].get<std::string>();
    }
    s.status = sim_status_from_string(j.value("status", std::string("IDLE")));
    s.safety_status = safety_status_from_string(j.value("safety_status", std::string("SAFE")));

    if (j.contains("processes") && j["processes"].is_array()) {
        for (const auto& p : j["processes"]) s.processes.push_back(process_from_json(p));
    }
    if (j.contains("resources") && j["resources"].is_array()) {
        for (const auto& r : j["resources"]) s.resources.push_back(resource_from_json(r));
    }
    if (j.contains("deadlock_report") && j["deadlock_report"].is_object()) {
        s.deadlock_report = deadlock_report_from_json(j["deadlock_report"]);
    }
    if (j.contains("banker_report") && j["banker_report"].is_object()) {
        s.banker_report = banker_report_from_json(j["banker_report"]);
    }
    s.deadlock_count = j.value("deadlock_count", 0);
    s.recovery_count = j.value("recovery_count", 0);
    s.preemption_count = j.value("preemption_count", 0);
    if (j.contains("events") && j["events"].is_array()) {
        for (const auto& e : j["events"]) s.events.push_back(event_from_json(e));
    }
    if (j.contains("metrics_history") && j["metrics_history"].is_array()) {
        for (const auto& m : j["metrics_history"]) s.metrics_history.push_back(metric_from_json(m));
    }
    return s;
}

nlohmann::json SimulationSerializer::to_json(const SimulationState& s) {
    nlohmann::json j = snapshot_to_json(s);
    nlohmann::json cps = nlohmann::json::array();
    for (const auto& cp : s.checkpoints) cps.push_back(snapshot_to_json(cp));
    j["checkpoints"] = cps;
    return j;
}

SimulationState SimulationSerializer::state_from_json(const nlohmann::json& j) {
    SimulationState s;
    static_cast<SimulationStateSnapshot&>(s) = snapshot_from_json(j);
    if (j.contains("checkpoints") && j["checkpoints"].is_array()) {
        for (const auto& cp : j["checkpoints"]) s.checkpoints.push_back(snapshot_from_json(cp));
    }
    return s;
}

nlohmann::json SimulationSerializer::to_json(const RecoveryResult& r) {
    return {
        {"ok", r.ok},
        {"error_code", r.error_code},
        {"message", r.message},
        {"terminated_processes", r.terminated_processes},
        {"preempted_resources", r.preempted_resources},
        {"recovered_units", r.recovered_units},
        {"surviving_processes", r.surviving_processes},
        {"unblocked_processes", r.unblocked_processes},
        {"restored_checkpoint_index",
         r.restored_checkpoint_index.has_value() ? nlohmann::json(*r.restored_checkpoint_index) : nlohmann::json(nullptr)}
    };
}

nlohmann::json SimulationSerializer::to_json(const ScheduleResult& s) {
    nlohmann::json gantt = nlohmann::json::array();
    for (const auto& g : s.gantt) {
        gantt.push_back({
            {"process_id", g.process_id},
            {"process_name", g.process_name},
            {"start_time", g.start_time},
            {"end_time", g.end_time}
        });
    }
    nlohmann::json pm = nlohmann::json::array();
    for (const auto& m : s.process_metrics) {
        pm.push_back({
            {"id", m.id},
            {"name", m.name},
            {"arrival_time", m.arrival_time},
            {"burst_time", m.burst_time},
            {"priority", m.priority},
            {"completion_time", m.completion_time},
            {"turnaround_time", m.turnaround_time},
            {"waiting_time", m.waiting_time},
            {"response_time", m.response_time}
        });
    }
    return {
        {"algorithm", to_string(s.algorithm)},
        {"quantum", s.quantum},
        {"gantt", gantt},
        {"process_metrics", pm},
        {"avg_waiting_time", s.avg_waiting_time},
        {"avg_turnaround_time", s.avg_turnaround_time},
        {"avg_response_time", s.avg_response_time},
        {"context_switches", s.context_switches},
        {"cpu_utilization_pct", s.cpu_utilization_pct},
        {"total_time", s.total_time}
    };
}

nlohmann::json SimulationSerializer::to_json(const SyncReport& r) {
    nlohmann::json events = nlohmann::json::array();
    for (const auto& e : r.events) {
        events.push_back({
            {"seq", e.seq},
            {"thread_id", e.thread_id},
            {"state", e.state},
            {"action", e.action},
            {"resource", e.resource},
            {"detail", e.detail}
        });
    }
    return {
        {"scenario", to_string(r.scenario)},
        {"mode", to_string(r.mode)},
        {"completed_cleanly", r.completed_cleanly},
        {"race_or_deadlock_detected", r.race_or_deadlock_detected},
        {"produced_count", r.produced_count},
        {"consumed_count", r.consumed_count},
        {"overflows", r.overflows},
        {"underflows", r.underflows},
        {"conflicts", r.conflicts},
        {"completed_meals", r.completed_meals},
        {"events", events},
        {"logs", r.logs},
        {"summary", r.summary}
    };
}

} // namespace deadlock_city
