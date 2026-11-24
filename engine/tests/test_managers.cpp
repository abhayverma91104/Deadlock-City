#include <gtest/gtest.h>

#include "ProcessManager.hpp"
#include "ResourceManager.hpp"

using namespace deadlock_city;

TEST(ResourceManagerTest, CreateAllocateReleaseAndModify) {
    ResourceManager rm;
    auto r0 = rm.add_resource("Printer", ResourceCategory::IO, 3, false);
    EXPECT_EQ(r0.id, "R0");
    EXPECT_EQ(r0.available_instances, 3);
    EXPECT_EQ(r0.allocated_instances, 0);

    std::string err;
    EXPECT_TRUE(rm.allocate("R0", 2, err));
    EXPECT_EQ(rm.find("R0")->available_instances, 1);
    EXPECT_EQ(rm.find("R0")->allocated_instances, 2);

    // Over-allocation fails cleanly
    EXPECT_FALSE(rm.allocate("R0", 2, err));
    EXPECT_FALSE(err.empty());

    // Cannot reduce total below allocated count (2)
    EXPECT_FALSE(rm.modify_resource("R0", 1, std::nullopt, err));
    EXPECT_TRUE(rm.modify_resource("R0", 4, true, err));
    EXPECT_EQ(rm.find("R0")->available_instances, 2);
    EXPECT_TRUE(rm.find("R0")->preemptible);

    EXPECT_TRUE(rm.release("R0", 2, err));
    EXPECT_EQ(rm.find("R0")->available_instances, 4);
}

TEST(ProcessManagerTest, CreateNeedComputationAndTerminateReleasesResources) {
    ResourceManager rm;
    rm.add_resource("DB Lock", ResourceCategory::LOCK, 2, false);
    rm.add_resource("CPU Core", ResourceCategory::COMPUTE, 4, true);

    ProcessManager pm;
    auto p0 = pm.add_process("Indexer", 0, 5, 2, {{"R0", 2}, {"R1", 3}}, rm.resources(), 4);
    EXPECT_EQ(p0.id, "P0");
    EXPECT_EQ(p0.need.at("R0"), 2);
    EXPECT_EQ(p0.need.at("R1"), 3);

    // Max demand exceeding total resource instances must throw
    EXPECT_THROW(
        pm.add_process("TooGreedy", 0, 3, 1, {{"R0", 5}}, rm.resources()),
        std::invalid_argument
    );

    // Simulate allocation and verify termination releases resources back to pool
    std::string err;
    ASSERT_TRUE(rm.allocate("R0", 1, err));
    auto* p0_mut = pm.find_mut("P0");
    ASSERT_NE(p0_mut, nullptr);
    p0_mut->allocated["R0"] = 1;
    pm.recompute_need(*p0_mut, rm.resources());
    EXPECT_EQ(p0_mut->need.at("R0"), 1);

    EXPECT_TRUE(pm.suspend_process("P0", err));
    EXPECT_EQ(pm.find("P0")->state, ProcessState::WAITING);
    EXPECT_TRUE(pm.resume_process("P0", err));
    EXPECT_EQ(pm.find("P0")->state, ProcessState::READY);

    EXPECT_TRUE(pm.terminate_process("P0", rm, err));
    EXPECT_EQ(pm.find("P0")->state, ProcessState::TERMINATED);
    EXPECT_EQ(rm.find("R0")->available_instances, 2);
    EXPECT_EQ(rm.find("R0")->allocated_instances, 0);
}
