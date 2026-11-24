#pragma once

#include "BankersAlgorithm.hpp"
#include "DeadlockDetector.hpp"
#include "ProcessManager.hpp"
#include "ResourceManager.hpp"
#include "Types.hpp"

#include <optional>
#include <string>
#include <vector>

namespace deadlock_city {

struct RecoveryRequest {
    RecoveryStrategy strategy{RecoveryStrategy::TERMINATE_VICTIM};
    VictimCriteria victim_criteria{VictimCriteria::LOWEST_COST};
    std::optional<std::string> target_process_id;
    std::optional<std::string> target_resource_id;
    std::optional<std::size_t> checkpoint_index;
};

struct RecoveryResult {
    bool ok{false};
    std::string error_code;
    std::string message;
    std::vector<std::string> terminated_processes;
    std::vector<std::string> preempted_resources;
    ResourceVector recovered_units;
    std::vector<std::string> surviving_processes;
    std::vector<std::string> unblocked_processes;
    std::optional<std::size_t> restored_checkpoint_index;
};

class RecoveryManager {
public:
    RecoveryResult recover(
        SimulationState& state,
        ProcessManager& pm,
        ResourceManager& rm,
        const DeadlockDetector& detector,
        const BankersAlgorithm& banker,
        const RecoveryRequest& req
    ) const;

    static std::vector<std::string> grant_satisfied_pending_requests(
        ProcessManager& pm,
        ResourceManager& rm
    );
};

} // namespace deadlock_city
