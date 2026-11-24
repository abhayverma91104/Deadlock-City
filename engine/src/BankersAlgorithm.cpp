#include "BankersAlgorithm.hpp"

#include <sstream>

namespace deadlock_city {

namespace {

int get_val(const ResourceVector& vec, const std::string& rid) {
    auto it = vec.find(rid);
    return it == vec.end() ? 0 : it->second;
}

bool leq_vector(
    const ResourceVector& lhs,
    const ResourceVector& rhs,
    const std::vector<ResourceType>& resources
) {
    for (const auto& r : resources) {
        if (get_val(lhs, r.id) > get_val(rhs, r.id)) {
            return false;
        }
    }
    return true;
}

} // namespace

BankerReport BankersAlgorithm::check_safety(
    const std::vector<Process>& processes,
    const std::vector<ResourceType>& resources
) const {
    BankerReport report;

    ResourceVector work;
    for (const auto& r : resources) {
        work[r.id] = r.available_instances;
    }

    std::vector<const Process*> active;
    std::map<std::string, bool> finish;
    for (const auto& p : processes) {
        if (p.state != ProcessState::TERMINATED) {
            active.push_back(&p);
            finish[p.id] = false;
        }
    }

    if (active.empty()) {
        report.is_safe = true;
        report.explanation = "No active processes in system; state is trivially safe.";
        return report;
    }

    int step_idx = 0;
    bool progress = true;
    while (progress) {
        progress = false;
        for (const auto* p : active) {
            if (finish[p->id]) continue;

            // Compute Need dynamically as Max - Allocation to guarantee invariant
            ResourceVector need_vec;
            for (const auto& r : resources) {
                const int m = get_val(p->max_demand, r.id);
                const int a = get_val(p->allocated, r.id);
                need_vec[r.id] = std::max(0, m - a);
            }

            if (leq_vector(need_vec, work, resources)) {
                DetectionStep step;
                step.step_index = step_idx++;
                step.work_before = work;

                for (const auto& r : resources) {
                    work[r.id] += get_val(p->allocated, r.id);
                }

                finish[p->id] = true;
                step.work_after = work;
                step.selected_process = p->id;
                step.finish_snapshot = finish;
                step.note = "Need(" + p->id + ") <= Work; simulated completion and reclaimed allocations.";
                report.steps.push_back(std::move(step));
                report.safe_sequence.push_back(p->id);
                progress = true;
            }
        }
    }

    bool all_finished = true;
    std::vector<std::string> unfinished;
    for (const auto* p : active) {
        if (!finish[p->id]) {
            all_finished = false;
            unfinished.push_back(p->id);
        }
    }

    report.is_safe = all_finished;
    if (all_finished) {
        std::ostringstream oss;
        oss << "System is SAFE. Valid safe execution sequence: ";
        for (std::size_t i = 0; i < report.safe_sequence.size(); ++i) {
            if (i > 0) oss << " -> ";
            oss << report.safe_sequence[i];
        }
        oss << ".";
        report.explanation = oss.str();
    } else {
        DetectionStep fail_step;
        fail_step.step_index = step_idx;
        fail_step.work_before = work;
        fail_step.work_after = work;
        fail_step.selected_process = std::nullopt;
        fail_step.finish_snapshot = finish;
        fail_step.note = "No remaining unfinished process has Need <= Work.";
        report.steps.push_back(std::move(fail_step));

        std::ostringstream oss;
        oss << "System is UNSAFE: no safe sequence can guarantee completion for ";
        for (std::size_t i = 0; i < unfinished.size(); ++i) {
            if (i > 0) oss << ", ";
            oss << unfinished[i];
        }
        oss << ". Note: An unsafe state means deadlock is possible if processes request their full Need, not that a deadlock has already occurred.";
        report.explanation = oss.str();
    }

    return report;
}

RequestEvaluation BankersAlgorithm::evaluate_request(
    const std::vector<Process>& processes,
    const std::vector<ResourceType>& resources,
    const std::string& process_id,
    const ResourceVector& request,
    bool enforce_safety
) const {
    RequestEvaluation eval;

    const Process* target = nullptr;
    for (const auto& p : processes) {
        if (p.id == process_id) {
            target = &p;
            break;
        }
    }
    if (!target) {
        eval.error_code = "PROCESS_NOT_FOUND";
        eval.reason = "Process not found: " + process_id;
        return eval;
    }
    if (target->state == ProcessState::TERMINATED) {
        eval.error_code = "PROCESS_TERMINATED";
        eval.reason = "Terminated process cannot request resources: " + process_id;
        return eval;
    }

    // Validate request keys and positive total
    int total_requested = 0;
    for (const auto& [rid, qty] : request) {
        if (qty < 0) {
            eval.error_code = "INVALID_REQUEST";
            eval.reason = "Negative request quantity for resource " + rid;
            return eval;
        }
        bool known = false;
        for (const auto& r : resources) {
            if (r.id == rid) {
                known = true;
                break;
            }
        }
        if (!known) {
            eval.error_code = "RESOURCE_NOT_FOUND";
            eval.reason = "Unknown resource ID in request: " + rid;
            return eval;
        }
        total_requested += qty;
    }
    if (total_requested <= 0) {
        eval.error_code = "INVALID_REQUEST";
        eval.reason = "Resource request must request at least 1 unit.";
        return eval;
    }

    // Step 1: Verify Request <= Need
    for (const auto& r : resources) {
        const int req_qty = get_val(request, r.id);
        const int max_qty = get_val(target->max_demand, r.id);
        const int alloc_qty = get_val(target->allocated, r.id);
        const int need_qty = std::max(0, max_qty - alloc_qty);
        if (req_qty > need_qty) {
            eval.error_code = "REQUEST_EXCEEDS_NEED";
            eval.reason = "Process " + process_id + " requested " + std::to_string(req_qty) +
                          " units of " + r.id + ", exceeding remaining Need (" +
                          std::to_string(need_qty) + ").";
            eval.banker_report = check_safety(processes, resources);
            return eval;
        }
    }

    // Step 2: Verify Request <= Available
    for (const auto& r : resources) {
        const int req_qty = get_val(request, r.id);
        if (req_qty > r.available_instances) {
            eval.waited = true;
            eval.error_code = "INSUFFICIENT_RESOURCES";
            eval.reason = "Process " + process_id + " must wait: requested " + std::to_string(req_qty) +
                          " units of " + r.id + ", only " + std::to_string(r.available_instances) +
                          " available.";
            eval.banker_report = check_safety(processes, resources);
            return eval;
        }
    }

    if (!enforce_safety) {
        eval.approved = true;
        eval.reason = "Request granted directly (Banker's avoidance disabled).";
        return eval;
    }

    // Step 3: Temporarily allocate and run Safety Algorithm
    auto temp_processes = processes;
    auto temp_resources = resources;

    for (auto& p : temp_processes) {
        if (p.id == process_id) {
            for (const auto& r : temp_resources) {
                const int req_qty = get_val(request, r.id);
                p.allocated[r.id] = get_val(p.allocated, r.id) + req_qty;
                p.need[r.id] = std::max(0, get_val(p.max_demand, r.id) - p.allocated[r.id]);
            }
            break;
        }
    }
    for (auto& r : temp_resources) {
        const int req_qty = get_val(request, r.id);
        r.available_instances -= req_qty;
        r.allocated_instances += req_qty;
    }

    eval.banker_report = check_safety(temp_processes, temp_resources);
    if (eval.banker_report.is_safe) {
        eval.approved = true;
        eval.reason = "Banker's Algorithm approved request: resulting state remains SAFE.";
    } else {
        eval.approved = false;
        eval.error_code = "UNSAFE_STATE_REJECTED";
        eval.reason = "Banker's Algorithm rejected request and rolled back temporary allocation: resulting state would be UNSAFE.";
    }

    return eval;
}

} // namespace deadlock_city
