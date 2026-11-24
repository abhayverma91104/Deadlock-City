#pragma once

#include "Types.hpp"

#include <string>
#include <vector>

namespace deadlock_city {

struct RequestEvaluation {
    bool approved{false};
    bool waited{false};
    std::string error_code;
    std::string reason;
    BankerReport banker_report;
};

class BankersAlgorithm {
public:
    BankerReport check_safety(
        const std::vector<Process>& processes,
        const std::vector<ResourceType>& resources
    ) const;

    RequestEvaluation evaluate_request(
        const std::vector<Process>& processes,
        const std::vector<ResourceType>& resources,
        const std::string& process_id,
        const ResourceVector& request,
        bool enforce_safety
    ) const;
};

} // namespace deadlock_city
