#include "Types.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace deadlock_city {

namespace {
std::string to_upper(std::string v) {
    std::transform(v.begin(), v.end(), v.begin(), [](unsigned char c) {
        return static_cast<char>(std::toupper(c));
    });
    return v;
}
} // namespace

std::string to_string(ProcessState s) {
    switch (s) {
        case ProcessState::NEW: return "NEW";
        case ProcessState::READY: return "READY";
        case ProcessState::RUNNING: return "RUNNING";
        case ProcessState::WAITING: return "WAITING";
        case ProcessState::BLOCKED: return "BLOCKED";
        case ProcessState::TERMINATED: return "TERMINATED";
    }
    return "READY";
}

ProcessState process_state_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "NEW") return ProcessState::NEW;
    if (u == "READY") return ProcessState::READY;
    if (u == "RUNNING") return ProcessState::RUNNING;
    if (u == "WAITING") return ProcessState::WAITING;
    if (u == "BLOCKED") return ProcessState::BLOCKED;
    if (u == "TERMINATED") return ProcessState::TERMINATED;
    throw std::invalid_argument("Invalid ProcessState: " + s);
}

std::string to_string(ResourceCategory c) {
    switch (c) {
        case ResourceCategory::IO: return "IO";
        case ResourceCategory::LOCK: return "LOCK";
        case ResourceCategory::COMPUTE: return "COMPUTE";
        case ResourceCategory::MEMORY: return "MEMORY";
        case ResourceCategory::STORAGE: return "STORAGE";
    }
    return "COMPUTE";
}

ResourceCategory resource_category_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "IO") return ResourceCategory::IO;
    if (u == "LOCK") return ResourceCategory::LOCK;
    if (u == "COMPUTE") return ResourceCategory::COMPUTE;
    if (u == "MEMORY") return ResourceCategory::MEMORY;
    if (u == "STORAGE") return ResourceCategory::STORAGE;
    throw std::invalid_argument("Invalid ResourceCategory: " + s);
}

std::string to_string(ResourceStatus s) {
    switch (s) {
        case ResourceStatus::AVAILABLE: return "AVAILABLE";
        case ResourceStatus::ALLOCATED: return "ALLOCATED";
        case ResourceStatus::REQUESTED: return "REQUESTED";
        case ResourceStatus::UNAVAILABLE: return "UNAVAILABLE";
    }
    return "AVAILABLE";
}

ResourceStatus resource_status_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "AVAILABLE") return ResourceStatus::AVAILABLE;
    if (u == "ALLOCATED") return ResourceStatus::ALLOCATED;
    if (u == "REQUESTED") return ResourceStatus::REQUESTED;
    if (u == "UNAVAILABLE") return ResourceStatus::UNAVAILABLE;
    throw std::invalid_argument("Invalid ResourceStatus: " + s);
}

std::string to_string(SafetyStatus s) {
    switch (s) {
        case SafetyStatus::SAFE: return "SAFE";
        case SafetyStatus::UNSAFE: return "UNSAFE";
        case SafetyStatus::DEADLOCKED: return "DEADLOCKED";
    }
    return "SAFE";
}

SafetyStatus safety_status_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "SAFE") return SafetyStatus::SAFE;
    if (u == "UNSAFE") return SafetyStatus::UNSAFE;
    if (u == "DEADLOCKED") return SafetyStatus::DEADLOCKED;
    throw std::invalid_argument("Invalid SafetyStatus: " + s);
}

std::string to_string(SimStatus s) {
    switch (s) {
        case SimStatus::IDLE: return "IDLE";
        case SimStatus::RUNNING: return "RUNNING";
        case SimStatus::PAUSED: return "PAUSED";
    }
    return "IDLE";
}

SimStatus sim_status_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "IDLE") return SimStatus::IDLE;
    if (u == "RUNNING") return SimStatus::RUNNING;
    if (u == "PAUSED") return SimStatus::PAUSED;
    throw std::invalid_argument("Invalid SimStatus: " + s);
}

std::string to_string(VictimCriteria c) {
    switch (c) {
        case VictimCriteria::LOWEST_PRIORITY: return "LOWEST_PRIORITY";
        case VictimCriteria::LOWEST_COST: return "LOWEST_COST";
        case VictimCriteria::LEAST_ALLOCATED: return "LEAST_ALLOCATED";
        case VictimCriteria::LOWEST_REMAINING_WORK: return "LOWEST_REMAINING_WORK";
    }
    return "LOWEST_COST";
}

VictimCriteria victim_criteria_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "LOWEST_PRIORITY") return VictimCriteria::LOWEST_PRIORITY;
    if (u == "LOWEST_COST") return VictimCriteria::LOWEST_COST;
    if (u == "LEAST_ALLOCATED") return VictimCriteria::LEAST_ALLOCATED;
    if (u == "LOWEST_REMAINING_WORK") return VictimCriteria::LOWEST_REMAINING_WORK;
    throw std::invalid_argument("Invalid VictimCriteria: " + s);
}

std::string to_string(RecoveryStrategy s) {
    switch (s) {
        case RecoveryStrategy::TERMINATE_ALL: return "TERMINATE_ALL";
        case RecoveryStrategy::TERMINATE_VICTIM: return "TERMINATE_VICTIM";
        case RecoveryStrategy::PREEMPT_RESOURCE: return "PREEMPT_RESOURCE";
        case RecoveryStrategy::ROLLBACK: return "ROLLBACK";
    }
    return "TERMINATE_VICTIM";
}

RecoveryStrategy recovery_strategy_from_string(const std::string& s) {
    const auto u = to_upper(s);
    if (u == "TERMINATE_ALL") return RecoveryStrategy::TERMINATE_ALL;
    if (u == "TERMINATE_VICTIM") return RecoveryStrategy::TERMINATE_VICTIM;
    if (u == "PREEMPT_RESOURCE") return RecoveryStrategy::PREEMPT_RESOURCE;
    if (u == "ROLLBACK") return RecoveryStrategy::ROLLBACK;
    throw std::invalid_argument("Invalid RecoveryStrategy: " + s);
}

} // namespace deadlock_city
