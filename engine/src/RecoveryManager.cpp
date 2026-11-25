#include "RecoveryManager.hpp"

#include <algorithm>
#include <limits>
#include <sstream>

namespace deadlock_city {

namespace {

int sum_vector(const ResourceVector& v) {
    int total = 0;
    for (const auto& [rid, qty] : v) {
        (void)rid;
        total += qty;
    }
    return total;
}

const Process* select_victim_process(
    const std::vector<std::string>& candidates,
    const ProcessManager& pm,
    VictimCriteria criteria
) {
    const Process* best = nullptr;
    int best_score = std::numeric_limits<int>::max();

    for (const auto& pid : candidates) {
        const auto* p = pm.find(pid);
        if (!p || p->state == ProcessState::TERMINATED) continue;

        int score = 0;
        switch (criteria) {
            case VictimCriteria::LOWEST_PRIORITY:
                // Higher priority number means lower priority; negate to pick lowest priority first
                score = -p->priority;
                break;
            case VictimCriteria::LOWEST_COST:
                score = p->termination_cost;
                break;
            case VictimCriteria::LEAST_ALLOCATED:
                score = sum_vector(p->allocated);
                break;
            case VictimCriteria::LOWEST_REMAINING_WORK:
                score = p->remaining_time;
                break;
        }

        if (!best || score < best_score || (score == best_score && p->id < best->id)) {
            best = p;
            best_score = score;
        }
    }
    return best;
}

void merge_recovered(ResourceVector& acc, const ResourceVector& delta) {
    for (const auto& [rid, qty] : delta) {
        if (qty > 0) {
            acc[rid] += qty;
        }
    }
}

void sync_state_vectors(
    SimulationState& state,
    ProcessManager& pm,
    ResourceManager& rm,
    const DeadlockDetector& detector,
    const BankersAlgorithm& banker
) {
    rm.refresh_statuses(pm.processes());
    state.processes = pm.processes();
    state.resources = rm.resources();
    state.deadlock_report = detector.detect(state.processes, state.resources);
    state.banker_report = banker.check_safety(state.processes, state.resources);

    if (state.deadlock_report.detected) {
        state.safety_status = SafetyStatus::DEADLOCKED;
    } else if (!state.banker_report.is_safe) {
        state.safety_status = SafetyStatus::UNSAFE;
    } else {
        state.safety_status = SafetyStatus::SAFE;
    }
}

} // namespace

std::vector<std::string> RecoveryManager::grant_satisfied_pending_requests(
    ProcessManager& pm,
    ResourceManager& rm
) {
    std::vector<std::string> unblocked;
    for (auto& p : pm.mutable_processes()) {
        if (p.state == ProcessState::TERMINATED) continue;

        bool has_pending = false;
        bool can_satisfy = true;
        for (const auto& r : rm.resources()) {
            const int req_qty = p.pending_request.count(r.id) ? p.pending_request.at(r.id) : 0;
            if (req_qty > 0) {
                has_pending = true;
                if (req_qty > r.available_instances) {
                    can_satisfy = false;
                    break;
                }
            }
        }

        if (has_pending && can_satisfy) {
            for (const auto& r : rm.resources()) {
                const int req_qty = p.pending_request.count(r.id) ? p.pending_request.at(r.id) : 0;
                if (req_qty > 0) {
                    std::string err;
                    if (rm.allocate(r.id, req_qty, err)) {
                        p.allocated[r.id] += req_qty;
                        p.pending_request[r.id] = 0;
                    }
                }
            }
            pm.recompute_need(p, rm.resources());
            if (p.state == ProcessState::BLOCKED || p.state == ProcessState::WAITING) {
                p.state = ProcessState::READY;
            }
            unblocked.push_back(p.id);
        }
    }
    return unblocked;
}

RecoveryResult RecoveryManager::recover(
    SimulationState& state,
    ProcessManager& pm,
    ResourceManager& rm,
    const DeadlockDetector& detector,
    const BankersAlgorithm& banker,
    const RecoveryRequest& req
) const {
    RecoveryResult res;
    auto current_deadlock = detector.detect(pm.processes(), rm.resources());

    switch (req.strategy) {
        case RecoveryStrategy::TERMINATE_ALL: {
            if (!current_deadlock.detected) {
                res.error_code = "NO_DEADLOCK_DETECTED";
                res.message = "No deadlocked processes found to terminate.";
                return res;
            }
            for (const auto& pid : current_deadlock.deadlocked_processes) {
                const auto* p = pm.find(pid);
                if (!p || p->state == ProcessState::TERMINATED) continue;
                auto held = p->allocated;
                std::string err;
                if (pm.terminate_process(pid, rm, err)) {
                    res.terminated_processes.push_back(pid);
                    merge_recovered(res.recovered_units, held);
                }
            }
            res.unblocked_processes = grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(res.unblocked_processes.size());
            state.recovery_terminated_count += static_cast<int>(res.terminated_processes.size());
            state.recovery_count += 1;
            sync_state_vectors(state, pm, rm, detector, banker);
            res.ok = true;
            res.message = "Terminated all " + std::to_string(res.terminated_processes.size()) +
                          " deadlocked processes and reclaimed their resources.";
            break;
        }

        case RecoveryStrategy::TERMINATE_VICTIM: {
            std::string victim_id;
            if (req.target_process_id.has_value() && !req.target_process_id->empty()) {
                const auto* p = pm.find(*req.target_process_id);
                if (!p) {
                    res.error_code = "PROCESS_NOT_FOUND";
                    res.message = "Target victim process not found: " + *req.target_process_id;
                    return res;
                }
                if (p->state == ProcessState::TERMINATED) {
                    res.error_code = "PROCESS_TERMINATED";
                    res.message = "Target process is already terminated: " + *req.target_process_id;
                    return res;
                }
                victim_id = p->id;
            } else {
                if (!current_deadlock.detected) {
                    res.error_code = "NO_DEADLOCK_DETECTED";
                    res.message = "No deadlock detected; specify target_process_id to terminate manually.";
                    return res;
                }
                const auto* victim = select_victim_process(
                    current_deadlock.deadlocked_processes, pm, req.victim_criteria
                );
                if (!victim) {
                    res.error_code = "NO_VICTIM_AVAILABLE";
                    res.message = "No eligible deadlocked victim process found.";
                    return res;
                }
                victim_id = victim->id;
            }

            auto held = pm.find(victim_id)->allocated;
            std::string err;
            if (!pm.terminate_process(victim_id, rm, err)) {
                res.error_code = "TERMINATION_FAILED";
                res.message = err;
                return res;
            }
            res.terminated_processes.push_back(victim_id);
            merge_recovered(res.recovered_units, held);
            res.unblocked_processes = grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(res.unblocked_processes.size());
            state.recovery_terminated_count += static_cast<int>(res.terminated_processes.size());
            state.recovery_count += 1;
            sync_state_vectors(state, pm, rm, detector, banker);
            if (state.deadlock_report.detected) {
                res.ok = false;
                res.error_code = "DEADLOCK_UNRESOLVED";
                res.message = "Terminated victim " + victim_id + ", but deadlock remains unresolved (" +
                              state.deadlock_report.explanation + ").";
            } else {
                res.ok = true;
                res.message = "Terminated victim process " + victim_id +
                              " (" + to_string(req.victim_criteria) + ") and reclaimed held resources.";
            }
            break;
        }

        case RecoveryStrategy::PREEMPT_RESOURCE: {
            // Pick resource to preempt (explicit or first preemptible involved resource)
            std::string rid;
            if (req.target_resource_id.has_value() && !req.target_resource_id->empty()) {
                rid = *req.target_resource_id;
            } else {
                for (const auto& candidate_rid : current_deadlock.involved_resources) {
                    const auto* r = rm.find(candidate_rid);
                    if (r && r->preemptible && r->allocated_instances > 0) {
                        rid = r->id;
                        break;
                    }
                }
                if (rid.empty()) {
                    for (const auto& r : rm.resources()) {
                        if (r.preemptible && r.allocated_instances > 0) {
                            rid = r.id;
                            break;
                        }
                    }
                }
            }

            if (rid.empty()) {
                res.error_code = "NO_PREEMPTIBLE_RESOURCE";
                res.message = "No preemptible allocated resource is available for preemption.";
                return res;
            }

            const auto* r_ptr = rm.find(rid);
            if (!r_ptr) {
                res.error_code = "RESOURCE_NOT_FOUND";
                res.message = "Resource not found: " + rid;
                return res;
            }
            if (!r_ptr->preemptible) {
                res.error_code = "RESOURCE_NOT_PREEMPTIBLE";
                res.message = "Resource " + rid + " (" + r_ptr->name + ") is marked non-preemptible.";
                return res;
            }

            // Pick holder process
            std::vector<std::string> holders;
            if (req.target_process_id.has_value() && !req.target_process_id->empty()) {
                holders.push_back(*req.target_process_id);
            } else {
                for (const auto& pid : current_deadlock.deadlocked_processes) {
                    const auto* p = pm.find(pid);
                    if (p && p->allocated.count(rid) && p->allocated.at(rid) > 0) {
                        holders.push_back(pid);
                    }
                }
                if (holders.empty()) {
                    for (const auto& p : pm.processes()) {
                        if (p.state != ProcessState::TERMINATED &&
                            p.allocated.count(rid) && p.allocated.at(rid) > 0) {
                            holders.push_back(p.id);
                        }
                    }
                }
            }

            const auto* victim = select_victim_process(holders, pm, req.victim_criteria);
            if (!victim || !victim->allocated.count(rid) || victim->allocated.at(rid) <= 0) {
                res.error_code = "NO_HOLDER_FOUND";
                res.message = "No active process holds resource " + rid + " for preemption.";
                return res;
            }

            auto* victim_mut = pm.find_mut(victim->id);
            const int held_qty = victim_mut->allocated.at(rid);
            std::string err;
            if (!rm.release(rid, held_qty, err)) {
                res.error_code = "PREEMPTION_FAILED";
                res.message = err;
                return res;
            }
            victim_mut->allocated[rid] = 0;
            victim_mut->preemption_count += 1;
            // Re-queue the preempted units as pending so victim can continue later
            victim_mut->pending_request[rid] += held_qty;
            victim_mut->state = ProcessState::BLOCKED;
            pm.recompute_need(*victim_mut, rm.resources());

            state.preemption_count += 1;
            state.recovery_count += 1;
            res.preempted_resources.push_back(rid);
            res.recovered_units[rid] = held_qty;
            res.unblocked_processes = grant_satisfied_pending_requests(pm, rm);
            state.granted_request_count += static_cast<int>(res.unblocked_processes.size());
            sync_state_vectors(state, pm, rm, detector, banker);
            if (state.deadlock_report.detected) {
                res.ok = false;
                res.error_code = "DEADLOCK_UNRESOLVED";
                res.message = "Preempted " + std::to_string(held_qty) + " unit(s) of " + rid +
                              " from " + victim->id + ", but deadlock remains unresolved.";
            } else {
                res.ok = true;
                res.message = "Preempted " + std::to_string(held_qty) + " unit(s) of " + rid +
                              " from process " + victim->id + ".";
            }
            break;
        }

        case RecoveryStrategy::ROLLBACK: {
            if (state.checkpoints.empty()) {
                res.error_code = "NO_CHECKPOINTS";
                res.message = "No saved checkpoints available for rollback recovery.";
                return res;
            }
            const std::size_t idx = req.checkpoint_index.has_value()
                ? *req.checkpoint_index
                : (state.checkpoints.size() - 1);
            if (idx >= state.checkpoints.size()) {
                res.error_code = "INVALID_CHECKPOINT";
                res.message = "Checkpoint index out of range: " + std::to_string(idx);
                return res;
            }

            const int prev_recoveries = state.recovery_count;
            const int prev_preemptions = state.preemption_count;
            const int prev_rec_term = state.recovery_terminated_count;
            const auto restored = state.checkpoints[idx];
            state.checkpoints.resize(idx);
            static_cast<SimulationStateSnapshot&>(state) = restored;
            state.recovery_count = prev_recoveries + 1;
            state.preemption_count = std::max(prev_preemptions, state.preemption_count);
            state.recovery_terminated_count = std::max(prev_rec_term, state.recovery_terminated_count);

            rm = ResourceManager(state.resources);
            pm = ProcessManager(state.processes);
            sync_state_vectors(state, pm, rm, detector, banker);

            res.restored_checkpoint_index = idx;
            if (state.deadlock_report.detected) {
                res.ok = false;
                res.error_code = "DEADLOCK_UNRESOLVED";
                res.message = "Rolled back to checkpoint #" + std::to_string(idx) +
                              ", but that checkpoint is still deadlocked.";
            } else {
                res.ok = true;
                res.message = "Rolled back simulation state to checkpoint #" + std::to_string(idx) +
                              " (tick " + std::to_string(state.tick) + ").";
            }
            break;
        }
    }

    for (const auto& p : pm.processes()) {
        if (p.state != ProcessState::TERMINATED) {
            res.surviving_processes.push_back(p.id);
        }
    }
    return res;
}

} // namespace deadlock_city
