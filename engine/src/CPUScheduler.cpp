#include "CPUScheduler.hpp"

#include <algorithm>
#include <cctype>
#include <deque>
#include <limits>
#include <stdexcept>

namespace deadlock_city {

std::string to_string(SchedulingAlgorithm alg) {
    switch (alg) {
        case SchedulingAlgorithm::FCFS: return "FCFS";
        case SchedulingAlgorithm::SJF: return "SJF";
        case SchedulingAlgorithm::SRTF: return "SRTF";
        case SchedulingAlgorithm::PRIORITY: return "PRIORITY";
        case SchedulingAlgorithm::RR: return "RR";
    }
    return "FCFS";
}

SchedulingAlgorithm scheduling_algorithm_from_string(const std::string& s) {
    std::string u = s;
    std::transform(u.begin(), u.end(), u.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    if (u == "FCFS") return SchedulingAlgorithm::FCFS;
    if (u == "SJF") return SchedulingAlgorithm::SJF;
    if (u == "SRTF") return SchedulingAlgorithm::SRTF;
    if (u == "PRIORITY") return SchedulingAlgorithm::PRIORITY;
    if (u == "RR" || u == "ROUND_ROBIN") return SchedulingAlgorithm::RR;
    throw std::invalid_argument("Invalid scheduling algorithm: " + s);
}

namespace {

struct SimProc {
    ScheduleInputProcess spec;
    int remaining{0};
    int first_start{-1};
    int completion{0};
    bool done{false};
};

void append_gantt(std::vector<GanttSegment>& gantt, const SimProc& p, int start, int end) {
    if (!gantt.empty() && gantt.back().process_id == p.spec.id && gantt.back().end_time == start) {
        gantt.back().end_time = end;
    } else {
        gantt.push_back(GanttSegment{p.spec.id, p.spec.name, start, end});
    }
}

ScheduleResult finalize_result(
    SchedulingAlgorithm alg,
    int quantum,
    const std::vector<SimProc>& procs,
    std::vector<GanttSegment> gantt,
    int context_switches,
    int total_time
) {
    ScheduleResult res;
    res.algorithm = alg;
    res.quantum = quantum;
    res.gantt = std::move(gantt);
    res.context_switches = context_switches;
    res.total_time = total_time;

    double sum_wait = 0.0;
    double sum_tat = 0.0;
    double sum_resp = 0.0;
    int busy_time = 0;

    for (const auto& sp : procs) {
        const int tat = sp.completion - sp.spec.arrival_time;
        const int wait = tat - sp.spec.burst_time;
        const int resp = sp.first_start - sp.spec.arrival_time;
        busy_time += sp.spec.burst_time;
        sum_wait += wait;
        sum_tat += tat;
        sum_resp += resp;

        res.process_metrics.push_back(ProcessScheduleMetrics{
            sp.spec.id,
            sp.spec.name,
            sp.spec.arrival_time,
            sp.spec.burst_time,
            sp.spec.priority,
            sp.completion,
            tat,
            wait,
            resp
        });
    }

    const double n = static_cast<double>(procs.size());
    if (n > 0.0) {
        res.avg_waiting_time = sum_wait / n;
        res.avg_turnaround_time = sum_tat / n;
        res.avg_response_time = sum_resp / n;
    }
    res.cpu_utilization_pct = total_time > 0
        ? (static_cast<double>(busy_time) / static_cast<double>(total_time)) * 100.0
        : 0.0;
    return res;
}

} // namespace

ScheduleResult CPUScheduler::run(
    SchedulingAlgorithm algorithm,
    const std::vector<ScheduleInputProcess>& processes,
    int quantum
) const {
    if (processes.empty()) {
        throw std::invalid_argument("At least one process is required for CPU scheduling.");
    }
    if (quantum < 1) {
        throw std::invalid_argument("Round Robin quantum must be at least 1.");
    }

    std::vector<SimProc> procs;
    procs.reserve(processes.size());
    for (const auto& p : processes) {
        if (p.arrival_time < 0) throw std::invalid_argument("Arrival time cannot be negative.");
        if (p.burst_time < 1) throw std::invalid_argument("Burst time must be at least 1.");
        SimProc sp;
        sp.spec = p;
        sp.remaining = p.burst_time;
        procs.push_back(std::move(sp));
    }

    // Sort indices by arrival_time then id for deterministic tie breaking
    std::vector<std::size_t> order(procs.size());
    for (std::size_t i = 0; i < procs.size(); ++i) order[i] = i;
    std::stable_sort(order.begin(), order.end(), [&](std::size_t a, std::size_t b) {
        if (procs[a].spec.arrival_time != procs[b].spec.arrival_time) {
            return procs[a].spec.arrival_time < procs[b].spec.arrival_time;
        }
        return procs[a].spec.id < procs[b].spec.id;
    });

    std::vector<GanttSegment> gantt;
    int time = 0;
    int completed = 0;
    int context_switches = 0;
    std::string prev_pid;
    const int n = static_cast<int>(procs.size());

    if (algorithm == SchedulingAlgorithm::FCFS ||
        algorithm == SchedulingAlgorithm::SJF ||
        algorithm == SchedulingAlgorithm::PRIORITY) {
        while (completed < n) {
            int chosen = -1;
            for (std::size_t idx : order) {
                auto& p = procs[idx];
                if (p.done || p.spec.arrival_time > time) continue;
                if (chosen == -1) {
                    chosen = static_cast<int>(idx);
                    continue;
                }
                const auto& cur = procs[chosen];
                if (algorithm == SchedulingAlgorithm::SJF) {
                    if (p.spec.burst_time < cur.spec.burst_time ||
                        (p.spec.burst_time == cur.spec.burst_time &&
                         p.spec.arrival_time < cur.spec.arrival_time)) {
                        chosen = static_cast<int>(idx);
                    }
                } else if (algorithm == SchedulingAlgorithm::PRIORITY) {
                    if (p.spec.priority < cur.spec.priority ||
                        (p.spec.priority == cur.spec.priority &&
                         p.spec.arrival_time < cur.spec.arrival_time)) {
                        chosen = static_cast<int>(idx);
                    }
                }
                // For FCFS, `order` is already sorted by arrival_time then id, so first ready wins.
            }

            if (chosen == -1) {
                int next_arrival = std::numeric_limits<int>::max();
                for (const auto& p : procs) {
                    if (!p.done) next_arrival = std::min(next_arrival, p.spec.arrival_time);
                }
                time = next_arrival;
                continue;
            }

            auto& p = procs[chosen];
            if (!prev_pid.empty() && prev_pid != p.spec.id) {
                context_switches++;
            }
            prev_pid = p.spec.id;
            if (p.first_start == -1) p.first_start = time;
            const int start = time;
            time += p.spec.burst_time;
            p.remaining = 0;
            p.completion = time;
            p.done = true;
            completed++;
            append_gantt(gantt, p, start, time);
        }
    } else if (algorithm == SchedulingAlgorithm::SRTF) {
        while (completed < n) {
            int chosen = -1;
            for (std::size_t idx : order) {
                const auto& p = procs[idx];
                if (p.done || p.spec.arrival_time > time) continue;
                if (chosen == -1 ||
                    p.remaining < procs[chosen].remaining ||
                    (p.remaining == procs[chosen].remaining &&
                     p.spec.arrival_time < procs[chosen].spec.arrival_time)) {
                    chosen = static_cast<int>(idx);
                }
            }

            if (chosen == -1) {
                int next_arrival = std::numeric_limits<int>::max();
                for (const auto& p : procs) {
                    if (!p.done) next_arrival = std::min(next_arrival, p.spec.arrival_time);
                }
                time = next_arrival;
                continue;
            }

            auto& p = procs[chosen];
            if (!prev_pid.empty() && prev_pid != p.spec.id) {
                context_switches++;
            }
            prev_pid = p.spec.id;
            if (p.first_start == -1) p.first_start = time;
            append_gantt(gantt, p, time, time + 1);
            time += 1;
            p.remaining -= 1;
            if (p.remaining == 0) {
                p.completion = time;
                p.done = true;
                completed++;
            }
        }
    } else { // Round Robin
        std::deque<std::size_t> ready_q;
        std::size_t next_arrival_pos = 0;

        auto enqueue_arrivals = [&](int upto_time) {
            while (next_arrival_pos < order.size() &&
                   procs[order[next_arrival_pos]].spec.arrival_time <= upto_time) {
                ready_q.push_back(order[next_arrival_pos]);
                next_arrival_pos++;
            }
        };

        enqueue_arrivals(time);
        while (completed < n) {
            if (ready_q.empty()) {
                if (next_arrival_pos < order.size()) {
                    time = procs[order[next_arrival_pos]].spec.arrival_time;
                    enqueue_arrivals(time);
                }
                continue;
            }

            const std::size_t idx = ready_q.front();
            ready_q.pop_front();
            auto& p = procs[idx];

            if (!prev_pid.empty() && prev_pid != p.spec.id) {
                context_switches++;
            }
            prev_pid = p.spec.id;
            if (p.first_start == -1) p.first_start = time;

            const int slice = std::min(quantum, p.remaining);
            const int start = time;
            time += slice;
            p.remaining -= slice;
            append_gantt(gantt, p, start, time);

            enqueue_arrivals(time);
            if (p.remaining == 0) {
                p.completion = time;
                p.done = true;
                completed++;
            } else {
                ready_q.push_back(idx);
            }
        }
    }

    return finalize_result(algorithm, quantum, procs, std::move(gantt), context_switches, time);
}

std::vector<ScheduleResult> CPUScheduler::compare_all(
    const std::vector<ScheduleInputProcess>& processes,
    int quantum
) const {
    return {
        run(SchedulingAlgorithm::FCFS, processes, quantum),
        run(SchedulingAlgorithm::SJF, processes, quantum),
        run(SchedulingAlgorithm::SRTF, processes, quantum),
        run(SchedulingAlgorithm::PRIORITY, processes, quantum),
        run(SchedulingAlgorithm::RR, processes, quantum)
    };
}

} // namespace deadlock_city
