#include "ResourceManager.hpp"

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace deadlock_city {

ResourceManager::ResourceManager(std::vector<ResourceType> initial)
    : resources_(std::move(initial)) {}

bool ResourceManager::exists(const std::string& id) const {
    return find(id) != nullptr;
}

const ResourceType* ResourceManager::find(const std::string& id) const {
    for (const auto& r : resources_) {
        if (r.id == id) return &r;
    }
    return nullptr;
}

ResourceType* ResourceManager::find_mut(const std::string& id) {
    for (auto& r : resources_) {
        if (r.id == id) return &r;
    }
    return nullptr;
}

std::string ResourceManager::generate_next_id() const {
    int max_idx = -1;
    for (const auto& r : resources_) {
        if (r.id.size() >= 2 && r.id[0] == 'R') {
            try {
                int val = std::stoi(r.id.substr(1));
                if (val > max_idx) max_idx = val;
            } catch (...) {
            }
        }
    }
    return "R" + std::to_string(max_idx + 1);
}

CityPosition ResourceManager::assign_city_position(std::size_t index) const {
    // Place resource facilities along an outer civic perimeter ring
    constexpr double kPi = 3.14159265358979323846;
    const double angle = (static_cast<double>(index) * 2.0 * kPi) / 8.0 + (kPi / 8.0);
    const double radius = 14.0 + (static_cast<double>(index / 8) * 5.0);
    const double x = std::round(std::cos(angle) * radius * 100.0) / 100.0;
    const double z = std::round(std::sin(angle) * radius * 100.0) / 100.0;
    return CityPosition{x, 0.0, z, "RES-PLOT-" + std::to_string(index)};
}

ResourceType ResourceManager::add_resource(
    const std::string& name,
    ResourceCategory category,
    int total_instances,
    bool preemptible,
    std::optional<std::string> explicit_id
) {
    if (name.empty()) {
        throw std::invalid_argument("Resource name cannot be empty.");
    }
    if (total_instances < 1) {
        throw std::invalid_argument("Resource total_instances must be at least 1.");
    }

    std::string id = explicit_id.value_or(generate_next_id());
    if (exists(id)) {
        throw std::invalid_argument("Resource ID already exists: " + id);
    }

    ResourceType res;
    res.id = std::move(id);
    res.name = name;
    res.category = category;
    res.total_instances = total_instances;
    res.available_instances = total_instances;
    res.allocated_instances = 0;
    res.preemptible = preemptible;
    res.status = ResourceStatus::AVAILABLE;
    res.city_position = assign_city_position(resources_.size());

    resources_.push_back(res);
    return res;
}

bool ResourceManager::modify_resource(
    const std::string& id,
    std::optional<int> new_total_instances,
    std::optional<bool> new_preemptible,
    std::string& error_message
) {
    auto* r = find_mut(id);
    if (!r) {
        error_message = "Resource not found: " + id;
        return false;
    }
    if (new_total_instances.has_value()) {
        if (*new_total_instances < 1) {
            error_message = "Total instances must be at least 1.";
            return false;
        }
        if (*new_total_instances < r->allocated_instances) {
            error_message = "Cannot reduce total instances below currently allocated count (" +
                            std::to_string(r->allocated_instances) + ").";
            return false;
        }
        r->total_instances = *new_total_instances;
        r->available_instances = r->total_instances - r->allocated_instances;
    }
    if (new_preemptible.has_value()) {
        r->preemptible = *new_preemptible;
    }
    return true;
}

bool ResourceManager::allocate(const std::string& id, int count, std::string& error_message) {
    if (count < 0) {
        error_message = "Allocation count cannot be negative.";
        return false;
    }
    if (count == 0) return true;
    auto* r = find_mut(id);
    if (!r) {
        error_message = "Resource not found: " + id;
        return false;
    }
    if (count > r->available_instances) {
        error_message = "Insufficient available instances of " + id + " (requested " +
                        std::to_string(count) + ", available " +
                        std::to_string(r->available_instances) + ").";
        return false;
    }
    r->available_instances -= count;
    r->allocated_instances += count;
    return true;
}

bool ResourceManager::release(const std::string& id, int count, std::string& error_message) {
    if (count < 0) {
        error_message = "Release count cannot be negative.";
        return false;
    }
    if (count == 0) return true;
    auto* r = find_mut(id);
    if (!r) {
        error_message = "Resource not found: " + id;
        return false;
    }
    if (count > r->allocated_instances) {
        error_message = "Cannot release more instances than allocated for " + id + ".";
        return false;
    }
    r->allocated_instances -= count;
    r->available_instances += count;
    return true;
}

ResourceVector ResourceManager::available_vector() const {
    ResourceVector vec;
    for (const auto& r : resources_) {
        vec[r.id] = r.available_instances;
    }
    return vec;
}

void ResourceManager::refresh_statuses(const std::vector<Process>& processes) {
    for (auto& r : resources_) {
        bool has_pending_request = false;
        for (const auto& p : processes) {
            if (p.state == ProcessState::TERMINATED) continue;
            auto it = p.pending_request.find(r.id);
            if (it != p.pending_request.end() && it->second > 0) {
                has_pending_request = true;
                break;
            }
        }
        if (r.available_instances == 0 && has_pending_request) {
            r.status = ResourceStatus::UNAVAILABLE;
        } else if (has_pending_request) {
            r.status = ResourceStatus::REQUESTED;
        } else if (r.allocated_instances > 0) {
            r.status = ResourceStatus::ALLOCATED;
        } else {
            r.status = ResourceStatus::AVAILABLE;
        }
    }
}

void ResourceManager::clear() {
    resources_.clear();
}

} // namespace deadlock_city
