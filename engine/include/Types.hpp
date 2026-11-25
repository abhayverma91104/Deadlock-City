#pragma once

#include <map>
#include <optional>
#include <string>
#include <vector>

namespace deadlock_city {

enum class ProcessState {
    NEW,
    READY,
    RUNNING,
    WAITING,
    BLOCKED,
    TERMINATED
};

enum class ResourceCategory {
    IO,
    LOCK,
    COMPUTE,
    MEMORY,
    STORAGE
};

enum class ResourceStatus {
    AVAILABLE,
    ALLOCATED,
    REQUESTED,
    UNAVAILABLE
};

enum class SafetyStatus {
    SAFE,
    UNSAFE,
    DEADLOCKED
};

enum class SimStatus {
    IDLE,
    RUNNING,
    PAUSED
};

enum class VictimCriteria {
    LOWEST_PRIORITY,
    LOWEST_COST,
    LEAST_ALLOCATED,
    LOWEST_REMAINING_WORK
};

enum class RecoveryStrategy {
    TERMINATE_ALL,
    TERMINATE_VICTIM,
    PREEMPT_RESOURCE,
    ROLLBACK
};

std::string to_string(ProcessState s);
ProcessState process_state_from_string(const std::string& s);

std::string to_string(ResourceCategory c);
ResourceCategory resource_category_from_string(const std::string& s);

std::string to_string(ResourceStatus s);
ResourceStatus resource_status_from_string(const std::string& s);

std::string to_string(SafetyStatus s);
SafetyStatus safety_status_from_string(const std::string& s);

std::string to_string(SimStatus s);
SimStatus sim_status_from_string(const std::string& s);

std::string to_string(VictimCriteria c);
VictimCriteria victim_criteria_from_string(const std::string& s);

std::string to_string(RecoveryStrategy s);
RecoveryStrategy recovery_strategy_from_string(const std::string& s);

struct CityPosition {
    double x{0.0};
    double y{0.0};
    double z{0.0};
    std::string plot_id;
};

using ResourceVector = std::map<std::string, int>;

struct Process {
    std::string id;
    std::string name;
    int arrival_time{0};
    int burst_time{1};
    int remaining_time{1};
    int priority{5};
    ProcessState state{ProcessState::READY};
    ResourceVector max_demand;
    ResourceVector allocated;
    ResourceVector need;
    ResourceVector pending_request;
    CityPosition city_position;
    int termination_cost{1};
    int waiting_ticks{0};
    int preemption_count{0};
};

struct ResourceType {
    std::string id;
    std::string name;
    ResourceCategory category{ResourceCategory::COMPUTE};
    int total_instances{1};
    int available_instances{1};
    int allocated_instances{0};
    bool preemptible{false};
    ResourceStatus status{ResourceStatus::AVAILABLE};
    CityPosition city_position;
};

struct DetectionStep {
    int step_index{0};
    ResourceVector work_before;
    ResourceVector work_after;
    std::optional<std::string> selected_process;
    std::map<std::string, bool> finish_snapshot;
    std::string note;
};

struct WaitForEdge {
    std::string from;
    std::string to;
    std::string resource_id;
};

struct DeadlockReport {
    bool detected{false};
    bool has_cycle_in_rag{false};
    std::vector<std::string> deadlocked_processes;
    std::vector<std::string> involved_resources;
    std::vector<std::vector<std::string>> cycles;
    std::vector<WaitForEdge> wait_for_edges;
    std::vector<DetectionStep> steps;
    std::string explanation;
};

struct BankerReport {
    bool is_safe{true};
    std::vector<std::string> safe_sequence;
    std::vector<DetectionStep> steps;
    std::string explanation;
};

struct SimulationEvent {
    std::string id;
    int tick{0};
    std::string type;
    std::string severity;
    std::string message;
    std::map<std::string, std::string> metadata;
};

struct MetricPoint {
    int tick{0};
    double utilization_pct{0.0};
    int active_count{0};
    int blocked_count{0};
    int deadlocked_count{0};
    int allocation_count{0};
    int available_count{0};
    int waiting_count{0};
    int completed_count{0};
    int terminated_count{0};
    int pending_request_units{0};
    int deadlock_count{0};
    int recovery_count{0};
    SafetyStatus safety_status{SafetyStatus::SAFE};
};

struct EngineError {
    std::string code;
    std::string message;
};

struct SimulationStateSnapshot {
    int tick{0};
    unsigned int seed{42};
    std::optional<std::string> preset;
    SimStatus status{SimStatus::IDLE};
    SafetyStatus safety_status{SafetyStatus::SAFE};
    std::vector<Process> processes;
    std::vector<ResourceType> resources;
    DeadlockReport deadlock_report;
    BankerReport banker_report;
    int deadlock_count{0};
    int recovery_count{0};
    int recovery_terminated_count{0};
    int preemption_count{0};
    int completed_count{0};
    int granted_request_count{0};
    int rejected_request_count{0};
    int total_metric_samples_recorded{0};
    int total_events_recorded{0};
    std::vector<SimulationEvent> events;
    std::vector<MetricPoint> metrics_history;
};

struct SimulationState : SimulationStateSnapshot {
    std::vector<SimulationStateSnapshot> checkpoints;
};

} // namespace deadlock_city
