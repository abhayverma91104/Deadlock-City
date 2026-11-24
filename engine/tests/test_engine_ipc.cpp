#include <gtest/gtest.h>

#include "SimulationEngine.hpp"

using namespace deadlock_city;

TEST(SimulationEngineIPCTest, AllEightPresetsProduceValidConsistentStates) {
    SimulationEngine engine;
    const std::vector<std::string> presets = {
        "normal_workload",
        "single_instance_deadlock",
        "multiple_instance_deadlock",
        "classic_banker_safe",
        "unsafe_no_deadlock",
        "resource_starvation",
        "high_contention",
        "recovery_demo"
    };

    for (const auto& preset : presets) {
        auto resp = engine.execute_command({
            {"command", "load_preset"},
            {"payload", {{"preset", preset}, {"seed", 42}}}
        });
        ASSERT_TRUE(resp["ok"].get<bool>()) << "Failed preset: " << preset << " -> " << resp["error"].dump();
        const auto& st = resp["state"];
        EXPECT_FALSE(st["processes"].empty()) << preset;
        EXPECT_FALSE(st["resources"].empty()) << preset;

        if (preset == "single_instance_deadlock" || preset == "multiple_instance_deadlock" || preset == "recovery_demo") {
            EXPECT_EQ(st["safety_status"], "DEADLOCKED") << preset;
            EXPECT_TRUE(st["deadlock_report"]["detected"].get<bool>()) << preset;
        } else if (preset == "unsafe_no_deadlock") {
            EXPECT_EQ(st["safety_status"], "UNSAFE") << preset;
            EXPECT_FALSE(st["deadlock_report"]["detected"].get<bool>()) << preset;
        } else if (preset == "classic_banker_safe" || preset == "normal_workload") {
            EXPECT_EQ(st["safety_status"], "SAFE") << preset;
            EXPECT_TRUE(st["banker_report"]["is_safe"].get<bool>()) << preset;
        }
    }
}

TEST(SimulationEngineIPCTest, DeterministicSeedAndStateRoundTrip) {
    SimulationEngine engine;
    auto r1 = engine.execute_command({
        {"command", "generate_random_workload"},
        {"payload", {{"process_count", 5}, {"resource_count", 3}, {"seed", 777}}}
    });
    auto r2 = engine.execute_command({
        {"command", "generate_random_workload"},
        {"payload", {{"process_count", 5}, {"resource_count", 3}, {"seed", 777}}}
    });
    ASSERT_TRUE(r1["ok"].get<bool>());
    EXPECT_EQ(r1["state"], r2["state"]);

    // Step simulation via serialized state round-trip
    auto step_resp = engine.execute_command({
        {"command", "step_simulation"},
        {"state", r1["state"]},
        {"payload", nlohmann::json::object()}
    });
    ASSERT_TRUE(step_resp["ok"].get<bool>());
    EXPECT_EQ(step_resp["state"]["tick"].get<int>(), 1);
}

TEST(SimulationEngineIPCTest, EndToEndDeadlockRecoveryAndLabsViaJSON) {
    SimulationEngine engine;
    auto init = engine.execute_command({
        {"command", "load_preset"},
        {"payload", {{"preset", "recovery_demo"}, {"seed", 42}}}
    });
    ASSERT_TRUE(init["ok"].get<bool>());
    ASSERT_EQ(init["state"]["safety_status"], "DEADLOCKED");

    auto rec = engine.execute_command({
        {"command", "recover_deadlock"},
        {"state", init["state"]},
        {"payload", {{"strategy", "terminate_victim"}, {"victim_criteria", "lowest_cost"}}}
    });
    ASSERT_TRUE(rec["ok"].get<bool>()) << rec["error"].dump();
    EXPECT_FALSE(rec["state"]["deadlock_report"]["detected"].get<bool>());
    EXPECT_EQ(rec["state"]["recovery_count"].get<int>(), 1);

    auto sched = engine.execute_command({
        {"command", "compare_scheduling"},
        {"payload", {
            {"quantum", 2},
            {"processes", {
                {{"id", "P1"}, {"name", "Alpha"}, {"arrival_time", 0}, {"burst_time", 5}, {"priority", 2}},
                {{"id", "P2"}, {"name", "Beta"}, {"arrival_time", 1}, {"burst_time", 3}, {"priority", 1}}
            }}
        }}
    });
    ASSERT_TRUE(sched["ok"].get<bool>());
    EXPECT_EQ(sched["result"]["comparisons"].size(), 5u);

    auto sync = engine.execute_command({
        {"command", "run_synchronization"},
        {"payload", {{"scenario", "producer_consumer"}, {"mode", "safe"}, {"iterations", 5}, {"buffer_size", 3}}}
    });
    ASSERT_TRUE(sync["ok"].get<bool>());
    EXPECT_TRUE(sync["result"]["completed_cleanly"].get<bool>());
    EXPECT_EQ(sync["result"]["overflows"].get<int>(), 0);
}
