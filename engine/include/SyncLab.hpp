#pragma once

#include <string>
#include <vector>

namespace deadlock_city {

enum class SyncScenario {
    PRODUCER_CONSUMER,
    READERS_WRITERS,
    DINING_PHILOSOPHERS
};

enum class SyncMode {
    SAFE,
    UNSAFE
};

std::string to_string(SyncScenario s);
SyncScenario sync_scenario_from_string(const std::string& s);

std::string to_string(SyncMode m);
SyncMode sync_mode_from_string(const std::string& s);

struct SyncRequest {
    SyncScenario scenario{SyncScenario::PRODUCER_CONSUMER};
    SyncMode mode{SyncMode::SAFE};
    int iterations{10};
    int buffer_size{4};
    unsigned int seed{42};
};

struct SyncEvent {
    int seq{0};
    std::string thread_id;
    std::string state;
    std::string action;
    std::string resource;
    std::string detail;
    int buffer_occupancy{-1};
    int buffer_capacity{0};
    int active_readers{0};
    int active_writers{0};
    std::vector<int> fork_owners;
};

struct SyncReport {
    SyncScenario scenario{SyncScenario::PRODUCER_CONSUMER};
    SyncMode mode{SyncMode::SAFE};
    bool completed_cleanly{true};
    bool race_or_deadlock_detected{false};
    int produced_count{0};
    int consumed_count{0};
    int overflows{0};
    int underflows{0};
    int conflicts{0};
    int completed_meals{0};
    std::vector<SyncEvent> events;
    std::vector<std::string> logs;
    std::string summary;
};

class SyncLab {
public:
    SyncReport run(const SyncRequest& req) const;
};

} // namespace deadlock_city
