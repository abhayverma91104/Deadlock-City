#pragma once

#include <string>
#include <vector>

namespace deadlock_city {

enum class SchedulingAlgorithm {
    FCFS,
    SJF,
    SRTF,
    PRIORITY,
    RR
};

std::string to_string(SchedulingAlgorithm alg);
SchedulingAlgorithm scheduling_algorithm_from_string(const std::string& s);

struct ScheduleInputProcess {
    std::string id;
    std::string name;
    int arrival_time{0};
    int burst_time{1};
    int priority{5};
};

struct GanttSegment {
    std::string process_id;
    std::string process_name;
    int start_time{0};
    int end_time{0};
};

struct ProcessScheduleMetrics {
    std::string id;
    std::string name;
    int arrival_time{0};
    int burst_time{0};
    int priority{5};
    int completion_time{0};
    int turnaround_time{0};
    int waiting_time{0};
    int response_time{0};
};

struct ScheduleResult {
    SchedulingAlgorithm algorithm{SchedulingAlgorithm::FCFS};
    int quantum{2};
    std::vector<GanttSegment> gantt;
    std::vector<ProcessScheduleMetrics> process_metrics;
    double avg_waiting_time{0.0};
    double avg_turnaround_time{0.0};
    double avg_response_time{0.0};
    int context_switches{0};
    double cpu_utilization_pct{0.0};
    int total_time{0};
};

class CPUScheduler {
public:
    ScheduleResult run(
        SchedulingAlgorithm algorithm,
        const std::vector<ScheduleInputProcess>& processes,
        int quantum = 2
    ) const;

    std::vector<ScheduleResult> compare_all(
        const std::vector<ScheduleInputProcess>& processes,
        int quantum = 2
    ) const;
};

} // namespace deadlock_city
