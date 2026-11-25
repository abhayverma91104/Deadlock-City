#include "DeadlockDetector.hpp"

#include <algorithm>
#include <map>
#include <set>
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

std::vector<std::string> canonicalize_cycle(const std::vector<std::string>& cycle) {
    if (cycle.empty()) return cycle;
    auto min_it = std::min_element(cycle.begin(), cycle.end());
    std::vector<std::string> rotated;
    rotated.reserve(cycle.size());
    rotated.insert(rotated.end(), min_it, cycle.end());
    rotated.insert(rotated.end(), cycle.begin(), min_it);
    return rotated;
}

void find_rag_cycles(
    const std::map<std::string, std::vector<std::string>>& adj,
    std::vector<std::vector<std::string>>& out_cycles
) {
    constexpr std::size_t kMaxCycles = 32;
    constexpr std::size_t kMaxExpansions = 10000;
    std::set<std::vector<std::string>> unique_cycles;
    std::size_t expansions = 0;

    auto strip_prefix = [](const std::string& node) {
        return node.size() > 2 ? node.substr(2) : node;
    };

    // Johnson-style canonical start-node search: only traverse nodes >= start_node so
    // secondary overlapping cycles are never skipped by a global visited set.
    for (const auto& entry : adj) {
        const std::string& start_node = entry.first;
        if (unique_cycles.size() >= kMaxCycles || expansions >= kMaxExpansions) break;

        std::vector<std::string> path;
        std::set<std::string> on_stack;

        auto dfs = [&](auto& self, const std::string& u) -> void {
            if (unique_cycles.size() >= kMaxCycles || expansions >= kMaxExpansions) return;
            expansions++;
            path.push_back(u);
            on_stack.insert(u);

            auto it = adj.find(u);
            if (it != adj.end()) {
                for (const auto& v : it->second) {
                    if (v < start_node) continue;
                    if (v == start_node) {
                        std::vector<std::string> raw;
                        raw.reserve(path.size());
                        for (const auto& node : path) {
                            raw.push_back(strip_prefix(node));
                        }
                        auto canon = canonicalize_cycle(raw);
                        if (unique_cycles.insert(canon).second) {
                            out_cycles.push_back(std::move(canon));
                        }
                    } else if (!on_stack.count(v)) {
                        self(self, v);
                    }
                }
            }

            on_stack.erase(u);
            path.pop_back();
        };

        dfs(dfs, start_node);
    }
}

} // namespace

DeadlockReport DeadlockDetector::detect(
    const std::vector<Process>& processes,
    const std::vector<ResourceType>& resources
) const {
    DeadlockReport report;

    std::vector<const Process*> active;
    for (const auto& p : processes) {
        if (p.state != ProcessState::TERMINATED) {
            active.push_back(&p);
        }
    }

    // 1. Build Resource Allocation Graph (RAG) adjacency & Wait-For edges
    std::map<std::string, std::vector<std::string>> rag_adj;
    std::set<std::pair<std::string, std::pair<std::string, std::string>>> seen_wfg;

    for (const auto* p : active) {
        const std::string p_node = "P:" + p->id;
        for (const auto& r : resources) {
            const std::string r_node = "R:" + r.id;
            if (get_val(p->allocated, r.id) > 0) {
                rag_adj[r_node].push_back(p_node);
            }
            if (get_val(p->pending_request, r.id) > 0) {
                rag_adj[p_node].push_back(r_node);
                // Wait-for edge: p waits for every holder q of resource r
                for (const auto* q : active) {
                    if (q->id != p->id && get_val(q->allocated, r.id) > 0) {
                        auto key = std::make_pair(p->id, std::make_pair(q->id, r.id));
                        if (seen_wfg.insert(key).second) {
                            report.wait_for_edges.push_back(WaitForEdge{p->id, q->id, r.id});
                        }
                    }
                }
            }
        }
    }

    find_rag_cycles(rag_adj, report.cycles);
    report.has_cycle_in_rag = !report.cycles.empty();

    if (active.empty()) {
        report.detected = false;
        report.explanation = "No active processes in system; no deadlock present.";
        return report;
    }

    // 2. Work/Finish Deadlock Detection Algorithm (handles both single- and multi-instance resources)
    ResourceVector work;
    for (const auto& r : resources) {
        work[r.id] = r.available_instances;
    }

    std::map<std::string, bool> finish;
    for (const auto* p : active) {
        int total_alloc = 0;
        for (const auto& r : resources) {
            total_alloc += get_val(p->allocated, r.id);
        }
        finish[p->id] = (total_alloc == 0);
    }

    int step_idx = 0;
    bool progress = true;
    while (progress) {
        progress = false;
        for (const auto* p : active) {
            if (finish[p->id]) continue;

            if (leq_vector(p->pending_request, work, resources)) {
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
                step.note = "Request(" + p->id + ") <= Work; process can finish and release held resources.";
                report.steps.push_back(std::move(step));
                progress = true;
            }
        }
    }

    std::set<std::string> involved_res_set;
    for (const auto* p : active) {
        if (!finish[p->id]) {
            report.deadlocked_processes.push_back(p->id);
            for (const auto& r : resources) {
                if (get_val(p->allocated, r.id) > 0 || get_val(p->pending_request, r.id) > 0) {
                    involved_res_set.insert(r.id);
                }
            }
        }
    }
    report.involved_resources.assign(involved_res_set.begin(), involved_res_set.end());
    report.detected = !report.deadlocked_processes.empty();

    if (report.detected) {
        DetectionStep dead_step;
        dead_step.step_index = step_idx;
        dead_step.work_before = work;
        dead_step.work_after = work;
        dead_step.selected_process = std::nullopt;
        dead_step.finish_snapshot = finish;
        dead_step.note = "Halted: unfinished processes cannot satisfy their outstanding requests with Work.";
        report.steps.push_back(std::move(dead_step));

        std::ostringstream oss;
        oss << "DEADLOCK DETECTED involving processes: ";
        for (std::size_t i = 0; i < report.deadlocked_processes.size(); ++i) {
            if (i > 0) oss << ", ";
            oss << report.deadlocked_processes[i];
        }
        oss << ". These processes hold resources (";
        for (std::size_t i = 0; i < report.involved_resources.size(); ++i) {
            if (i > 0) oss << ", ";
            oss << report.involved_resources[i];
        }
        oss << ") while blocked waiting on requests that cannot be satisfied by available instances.";
        report.explanation = oss.str();
    } else if (report.has_cycle_in_rag) {
        report.explanation =
            "A cycle exists in the Resource Allocation Graph, but NO deadlock is present: "
            "multiple resource instances allow an independent holder to finish and release "
            "resources, satisfying the remaining requests.";
    } else {
        report.explanation = "No deadlock detected. All active processes with held resources can complete.";
    }

    return report;
}

} // namespace deadlock_city
