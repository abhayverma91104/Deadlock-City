#pragma once

#include "Types.hpp"

#include <vector>

namespace deadlock_city {

class DeadlockDetector {
public:
    DeadlockReport detect(
        const std::vector<Process>& processes,
        const std::vector<ResourceType>& resources
    ) const;
};

} // namespace deadlock_city
