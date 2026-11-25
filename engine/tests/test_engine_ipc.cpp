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

TEST(SimulationEngineIPCTest, Phase7PresetCatalogMetricsAndRollback) {
    SimulationEngine engine;
    auto catalog = engine.execute_command({
        {"command", "list_presets"},
        {"payload", nlohmann::json::object()}
    });
    ASSERT_TRUE(catalog["ok"].get<bool>());
    ASSERT_EQ(catalog["result"]["presets"].size(), 9u);

    for (const auto& entry : catalog["result"]["presets"]) {
        const std::string pid = entry.at("id").get<std::string>();
        auto loaded = engine.execute_command({
            {"command", "load_preset"},
            {"payload", {{"preset", pid}, {"seed", entry.at("default_seed").get<unsigned int>()}}}
        });
        ASSERT_TRUE(loaded["ok"].get<bool>()) << pid;
        ASSERT_FALSE(loaded["state"]["metrics_history"].empty()) << pid;
        EXPECT_TRUE(loaded["state"]["metrics_history"][0].contains("available_count")) << pid;
        EXPECT_TRUE(loaded["state"]["metrics_history"][0].contains("safety_status")) << pid;
    }

    // Exercise granted + rejected request counters and process completion counters
    auto safe_sim = engine.execute_command({
        {"command", "load_preset"},
        {"payload", {{"preset", "classic_banker_safe"}, {"seed", 42}}}
    });
    ASSERT_TRUE(safe_sim["ok"].get<bool>());

    auto bad_req = engine.execute_command({
        {"command", "request_resources"},
        {"state", safe_sim["state"]},
        {"payload", {{"process_id", "P0"}, {"request", {{"R0", 99}}}, {"use_banker", true}}}
    });
    ASSERT_FALSE(bad_req["ok"].get<bool>());
    EXPECT_EQ(bad_req["state"]["rejected_request_count"].get<int>(), 1);

    auto good_req = engine.execute_command({
        {"command", "request_resources"},
        {"state", bad_req["state"]},
        {"payload", {{"process_id", "P1"}, {"request", {{"R0", 1}, {"R2", 2}}}, {"use_banker", true}}}
    });
    ASSERT_TRUE(good_req["ok"].get<bool>());
    EXPECT_EQ(good_req["state"]["granted_request_count"].get<int>(), 1);

    // Step until completion happens (P1 has remaining_time = 4, P3 has 3, priority picks P3 or P1)
    auto st = good_req["state"];
    for (int i = 0; i < 6; ++i) {
        auto step = engine.execute_command({{"command", "step_simulation"}, {"state", st}, {"payload", nlohmann::json::object()}});
        ASSERT_TRUE(step["ok"].get<bool>());
        st = step["state"];
    }
    EXPECT_GE(st["completed_count"].get<int>(), 1);

    // Recovery termination + checkpoint rollback preserves recovery_count and restores tick/history
    auto rec_sim = engine.execute_command({
        {"command", "load_preset"},
        {"payload", {{"preset", "recovery_demo"}, {"seed", 42}}}
    });
    ASSERT_TRUE(rec_sim["ok"].get<bool>());
    auto term = engine.execute_command({
        {"command", "recover_deadlock"},
        {"state", rec_sim["state"]},
        {"payload", {{"strategy", "terminate_victim"}, {"victim_criteria", "lowest_cost"}}}
    });
    ASSERT_TRUE(term["ok"].get<bool>());
    EXPECT_EQ(term["state"]["recovery_terminated_count"].get<int>(), 1);

    auto rb = engine.execute_command({
        {"command", "recover_deadlock"},
        {"state", rec_sim["state"]},
        {"payload", {{"strategy", "rollback"}, {"checkpoint_index", 0}}}
    });
    ASSERT_TRUE(rb["ok"].get<bool>());
    EXPECT_EQ(rb["state"]["tick"].get<int>(), 0);
    EXPECT_EQ(rb["state"]["recovery_count"].get<int>(), 1);
    EXPECT_FALSE(rb["state"]["deadlock_report"]["detected"].get<bool>());
}
