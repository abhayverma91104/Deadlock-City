#pragma once

#include "CPUScheduler.hpp"
#include "RecoveryManager.hpp"
#include "SyncLab.hpp"
#include "Types.hpp"

#include <nlohmann/json.hpp>

namespace deadlock_city {

class SimulationSerializer {
public:
    static nlohmann::json to_json(const CityPosition& pos);
    static CityPosition city_position_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const Process& p);
    static Process process_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const ResourceType& r);
    static ResourceType resource_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const DetectionStep& s);
    static DetectionStep detection_step_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const WaitForEdge& e);
    static WaitForEdge wait_for_edge_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const DeadlockReport& d);
    static DeadlockReport deadlock_report_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const BankerReport& b);
    static BankerReport banker_report_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const SimulationEvent& e);
    static SimulationEvent event_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const MetricPoint& m);
    static MetricPoint metric_from_json(const nlohmann::json& j);

    static nlohmann::json snapshot_to_json(const SimulationStateSnapshot& s);
    static SimulationStateSnapshot snapshot_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const SimulationState& s);
    static SimulationState state_from_json(const nlohmann::json& j);

    static nlohmann::json to_json(const RecoveryResult& r);
    static nlohmann::json to_json(const ScheduleResult& s);
    static nlohmann::json to_json(const SyncReport& r);
};

} // namespace deadlock_city
