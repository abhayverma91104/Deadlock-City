#include "ProcessManager.hpp"

#include <algorithm>
#include <stdexcept>

namespace deadlock_city {

ProcessManager::ProcessManager(std::vector<Process> initial)
    : processes_(std::move(initial)) {}

bool ProcessManager::exists(const std::string& id) const {
    return find(id) != nullptr;
}

const Process* ProcessManager::find(const std::string& id) const {
    for (const auto& p : processes_) {
        if (p.id == id) return &p;
    }
    return nullptr;
}

Process* ProcessManager::find_mut(const std::string& id) {
    for (auto& p : processes_) {
        if (p.id == id) return &p;
    }
    return nullptr;
}

std::string ProcessManager::generate_next_id() const {
    int max_idx = -1;
    for (const auto& p : processes_) {
        if (p.id.size() >= 2 && p.id[0] == 'P') {
            try {
                int val = std::stoi(p.id.substr(1));
                if (val > max_idx) max_idx = val;
            } catch (...) {
            }
        }
    }
    return "P" + std::to_string(max_idx + 1);
}

CityPosition ProcessManager::assign_city_position(std::size_t index) const {
    // Inner urban grid: 4-column symmetrical blocks centered around the City Control Core
    constexpr int cols = 4;
    const int row = static_cast<int>(index) / cols;
    const int col = static_cast<int>(index) % cols;
    const double x = (static_cast<double>(col) - 1.5) * 4.5;
    const double z = (static_cast<double>(row) - 1.0) * 4.5;
    return CityPosition{x, 0.0, z, "PROC-PLOT-" + std::to_string(index)};
}

void ProcessManager::recompute_need(Process& proc, const std::vector<ResourceType>& resources) const {
    for (const auto& r : resources) {
        const int max_val = proc.max_demand.count(r.id) ? proc.max_demand.at(r.id) : 0;
        const int alloc_val = proc.allocated.count(r.id) ? proc.allocated.at(r.id) : 0;
        proc.max_demand[r.id] = max_val;
        proc.allocated[r.id] = alloc_val;
        proc.need[r.id] = std::max(0, max_val - alloc_val);
        if (!proc.pending_request.count(r.id)) {
            proc.pending_request[r.id] = 0;
        }
    }
}

void ProcessManager::sync_resource_keys(const std::vector<ResourceType>& resources) {
    for (auto& p : processes_) {
        recompute_need(p, resources);
    }
}

Process ProcessManager::add_process(
    const std::string& name,
    int arrival_time,
    int burst_time,
    int priority,
    const ResourceVector& max_demand,
    const std::vector<ResourceType>& resources,
    int termination_cost,
    std::optional<std::string> explicit_id,
    ProcessState initial_state
) {
    if (name.empty()) {
        throw std::invalid_argument("Process name cannot be empty.");
    }
    if (arrival_time < 0) {
        throw std::invalid_argument("Arrival time cannot be negative.");
    }
    if (burst_time < 1) {
        throw std::invalid_argument("Burst time must be at least 1.");
    }
    if (priority < 1 || priority > 10) {
        throw std::invalid_argument("Priority must be between 1 and 10.");
    }
    if (termination_cost < 1) {
        throw std::invalid_argument("Termination cost must be at least 1.");
    }

    std::string id = explicit_id.value_or(generate_next_id());
    if (exists(id)) {
        throw std::invalid_argument("Process ID already exists: " + id);
    }

    // Validate max_demand keys and bounds against existing resources
    for (const auto& [rid, qty] : max_demand) {
        if (qty < 0) {
            throw std::invalid_argument("Max demand cannot be negative for " + rid);
        }
        bool found = false;
        for (const auto& r : resources) {
            if (r.id == rid) {
                found = true;
                if (qty > r.total_instances) {
                    throw std::invalid_argument(
                        "Max demand (" + std::to_string(qty) + ") for " + rid +
                        " exceeds total system instances (" + std::to_string(r.total_instances) + ")."
                    );
                }
                break;
            }
        }
        if (!found) {
            throw std::invalid_argument("Unknown resource in max_demand: " + rid);
        }
    }

    Process proc;
    proc.id = std::move(id);
    proc.name = name;
    proc.arrival_time = arrival_time;
    proc.burst_time = burst_time;
    proc.remaining_time = burst_time;
    proc.priority = priority;
    proc.state = initial_state;
    proc.max_demand = max_demand;
    proc.termination_cost = termination_cost;
    proc.city_position = assign_city_position(processes_.size());

    recompute_need(proc, resources);
    processes_.push_back(proc);
    return proc;
}

bool ProcessManager::terminate_process(
    const std::string& id,
    ResourceManager& resource_mgr,
    std::string& error_message
) {
    auto* p = find_mut(id);
    if (!p) {
        error_message = "Process not found: " + id;
        return false;
    }
    if (p->state == ProcessState::TERMINATED) {
        error_message = "Process is already terminated: " + id;
        return false;
    }

    for (auto& [rid, qty] : p->allocated) {
        if (qty > 0) {
            std::string rel_err;
            if (!resource_mgr.release(rid, qty, rel_err)) {
                error_message = rel_err;
                return false;
            }
            qty = 0;
        }
    }
    for (auto& [rid, qty] : p->pending_request) {
        (void)rid;
        qty = 0;
    }
    p->state = ProcessState::TERMINATED;
    p->remaining_time = 0;
    recompute_need(*p, resource_mgr.resources());
    return true;
}

bool ProcessManager::suspend_process(const std::string& id, std::string& error_message) {
    auto* p = find_mut(id);
    if (!p) {
        error_message = "Process not found: " + id;
        return false;
    }
    if (p->state == ProcessState::TERMINATED) {
        error_message = "Cannot suspend a terminated process: " + id;
        return false;
    }
    p->state = ProcessState::WAITING;
    return true;
}

bool ProcessManager::resume_process(const std::string& id, std::string& error_message) {
    auto* p = find_mut(id);
    if (!p) {
        error_message = "Process not found: " + id;
        return false;
    }
    if (p->state == ProcessState::TERMINATED) {
        error_message = "Cannot resume a terminated process: " + id;
        return false;
    }
    bool has_pending = false;
    for (const auto& [rid, qty] : p->pending_request) {
        (void)rid;
        if (qty > 0) {
            has_pending = true;
            break;
        }
    }
    p->state = has_pending ? ProcessState::BLOCKED : ProcessState::READY;
    return true;
}

void ProcessManager::clear() {
    processes_.clear();
}

} // namespace deadlock_city
