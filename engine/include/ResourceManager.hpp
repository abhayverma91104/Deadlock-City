#pragma once

#include "Types.hpp"

#include <optional>
#include <string>
#include <vector>

namespace deadlock_city {

class ResourceManager {
public:
    ResourceManager() = default;
    explicit ResourceManager(std::vector<ResourceType> initial);

    const std::vector<ResourceType>& resources() const { return resources_; }
    std::vector<ResourceType>& mutable_resources() { return resources_; }

    bool exists(const std::string& id) const;
    const ResourceType* find(const std::string& id) const;
    ResourceType* find_mut(const std::string& id);

    ResourceType add_resource(
        const std::string& name,
        ResourceCategory category,
        int total_instances,
        bool preemptible = false,
        std::optional<std::string> explicit_id = std::nullopt
    );

    bool modify_resource(
        const std::string& id,
        std::optional<int> new_total_instances,
        std::optional<bool> new_preemptible,
        std::string& error_message
    );

    bool allocate(const std::string& id, int count, std::string& error_message);
    bool release(const std::string& id, int count, std::string& error_message);

    ResourceVector available_vector() const;
    void refresh_statuses(const std::vector<Process>& processes);
    void clear();

private:
    std::string generate_next_id() const;
    CityPosition assign_city_position(std::size_t index) const;

    std::vector<ResourceType> resources_;
};

} // namespace deadlock_city
