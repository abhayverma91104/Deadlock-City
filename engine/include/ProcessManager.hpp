#pragma once

#include "ResourceManager.hpp"
#include "Types.hpp"

#include <optional>
#include <string>
#include <vector>

namespace deadlock_city {

class ProcessManager {
public:
    ProcessManager() = default;
    explicit ProcessManager(std::vector<Process> initial);

    const std::vector<Process>& processes() const { return processes_; }
    std::vector<Process>& mutable_processes() { return processes_; }

    bool exists(const std::string& id) const;
    const Process* find(const std::string& id) const;
    Process* find_mut(const std::string& id);

    Process add_process(
        const std::string& name,
        int arrival_time,
        int burst_time,
        int priority,
        const ResourceVector& max_demand,
        const std::vector<ResourceType>& resources,
        int termination_cost = 1,
        std::optional<std::string> explicit_id = std::nullopt,
        ProcessState initial_state = ProcessState::READY
    );

    bool terminate_process(const std::string& id, ResourceManager& resource_mgr, std::string& error_message);
    bool suspend_process(const std::string& id, std::string& error_message);
    bool resume_process(const std::string& id, std::string& error_message);

    void sync_resource_keys(const std::vector<ResourceType>& resources);
    void recompute_need(Process& proc, const std::vector<ResourceType>& resources) const;
    void clear();

private:
    std::string generate_next_id() const;
    CityPosition assign_city_position(std::size_t index) const;

    std::vector<Process> processes_;
};

} // namespace deadlock_city
