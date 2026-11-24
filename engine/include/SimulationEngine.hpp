#pragma once

#include "BankersAlgorithm.hpp"
#include "CPUScheduler.hpp"
#include "DeadlockDetector.hpp"
#include "ProcessManager.hpp"
#include "RecoveryManager.hpp"
#include "ResourceManager.hpp"
#include "SyncLab.hpp"
#include "Types.hpp"

#include <nlohmann/json.hpp>
#include <string>

namespace deadlock_city {

class SimulationEngine {
public:
    SimulationEngine() = default;

    nlohmann::json execute_command(const nlohmann::json& request);

    SimulationState create_simulation(unsigned int seed = 42, const std::optional<std::string>& preset = std::nullopt);
    SimulationState load_preset(const std::string& preset_name, unsigned int seed = 42);
    SimulationState generate_random_workload(int process_count, int resource_count, unsigned int seed);

private:
    void refresh_diagnostics(SimulationState& state, ProcessManager& pm, ResourceManager& rm, bool record_metric);
    void append_event(
        SimulationState& state,
        const std::string& type,
        const std::string& severity,
        const std::string& message,
        const std::map<std::string, std::string>& meta = {}
    );
    void save_checkpoint(SimulationState& state);
    void step_internal(SimulationState& state, ProcessManager& pm, ResourceManager& rm);

    BankersAlgorithm banker_;
    DeadlockDetector detector_;
    RecoveryManager recovery_;
    CPUScheduler scheduler_;
    SyncLab sync_lab_;
};

} // namespace deadlock_city
