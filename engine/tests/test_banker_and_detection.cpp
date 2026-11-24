#include <gtest/gtest.h>

#include "BankersAlgorithm.hpp"
#include "DeadlockDetector.hpp"
#include "ProcessManager.hpp"
#include "ResourceManager.hpp"

using namespace deadlock_city;

namespace {

Process make_proc_with_alloc(
    ProcessManager& pm,
    ResourceManager& rm,
    const std::string& id,
    const ResourceVector& max_d,
    const ResourceVector& alloc,
    const ResourceVector& pending = {}
) {
    auto p = pm.add_process(id, 0, 5, 3, max_d, rm.resources(), 2, id);
    auto* mut = pm.find_mut(id);
    std::string err;
    for (const auto& [rid, qty] : alloc) {
        if (qty > 0) {
            EXPECT_TRUE(rm.allocate(rid, qty, err)) << err;
            mut->allocated[rid] = qty;
        }
    }
    for (const auto& [rid, qty] : pending) {
        mut->pending_request[rid] = qty;
        if (qty > 0) {
            mut->state = ProcessState::BLOCKED;
        }
    }
    pm.recompute_need(*mut, rm.resources());
    return *mut;
}

} // namespace

// MANDATORY TEST 1: Classic Banker's Algorithm Safe State
TEST(BankersAlgorithmTest, ClassicSafeState) {
    ResourceManager rm;
    rm.add_resource("CPU", ResourceCategory::COMPUTE, 10, false, "R0");
    rm.add_resource("RAM", ResourceCategory::MEMORY, 5, false, "R1");
    rm.add_resource("IO", ResourceCategory::IO, 7, false, "R2");

    ProcessManager pm;
    make_proc_with_alloc(pm, rm, "P0", {{"R0", 7}, {"R1", 5}, {"R2", 3}}, {{"R0", 0}, {"R1", 1}, {"R2", 0}});
    make_proc_with_alloc(pm, rm, "P1", {{"R0", 3}, {"R1", 2}, {"R2", 2}}, {{"R0", 2}, {"R1", 0}, {"R2", 0}});
    make_proc_with_alloc(pm, rm, "P2", {{"R0", 9}, {"R1", 0}, {"R2", 2}}, {{"R0", 3}, {"R1", 0}, {"R2", 2}});
    make_proc_with_alloc(pm, rm, "P3", {{"R0", 2}, {"R1", 2}, {"R2", 2}}, {{"R0", 2}, {"R1", 1}, {"R2", 1}});
    make_proc_with_alloc(pm, rm, "P4", {{"R0", 4}, {"R1", 3}, {"R2", 3}}, {{"R0", 0}, {"R1", 0}, {"R2", 2}});

    // Verify Available = [3, 3, 2]
    EXPECT_EQ(rm.find("R0")->available_instances, 3);
    EXPECT_EQ(rm.find("R1")->available_instances, 3);
    EXPECT_EQ(rm.find("R2")->available_instances, 2);

    BankersAlgorithm banker;
    auto report = banker.check_safety(pm.processes(), rm.resources());
    EXPECT_TRUE(report.is_safe);
    std::vector<std::string> expected_seq = {"P1", "P3", "P4", "P0", "P2"};
    EXPECT_EQ(report.safe_sequence, expected_seq);
    EXPECT_EQ(report.steps.size(), 5u);
}

// MANDATORY TEST 6: Invalid resource request exceeding remaining Need
TEST(BankersAlgorithmTest, RejectRequestExceedingNeed) {
    ResourceManager rm;
    rm.add_resource("CPU", ResourceCategory::COMPUTE, 4, false, "R0");
    ProcessManager pm;
    make_proc_with_alloc(pm, rm, "P0", {{"R0", 2}}, {{"R0", 1}});

    BankersAlgorithm banker;
    auto eval = banker.evaluate_request(pm.processes(), rm.resources(), "P0", {{"R0", 2}}, true);
    EXPECT_FALSE(eval.approved);
    EXPECT_EQ(eval.error_code, "REQUEST_EXCEEDS_NEED");
}

TEST(BankersAlgorithmTest, RejectsUnsafeRequestAndRollsBack) {
    ResourceManager rm;
    rm.add_resource("CPU", ResourceCategory::COMPUTE, 3, false, "R0");

    ProcessManager pm;
    make_proc_with_alloc(pm, rm, "P0", {{"R0", 3}}, {{"R0", 1}});
    make_proc_with_alloc(pm, rm, "P1", {{"R0", 2}}, {{"R0", 1}});
    // Available = 1. If P0 requests 1 more, Available=0, P0 needs 1, P1 needs 1 -> UNSAFE!

    BankersAlgorithm banker;
    auto eval = banker.evaluate_request(pm.processes(), rm.resources(), "P0", {{"R0", 1}}, true);
    EXPECT_FALSE(eval.approved);
    EXPECT_EQ(eval.error_code, "UNSAFE_STATE_REJECTED");
    EXPECT_FALSE(eval.banker_report.is_safe);
    // Original available must remain untouched
    EXPECT_EQ(rm.find("R0")->available_instances, 1);
}

// MANDATORY TEST 2: Single-instance circular deadlock
TEST(DeadlockDetectorTest, SingleInstanceCircularDeadlock) {
    ResourceManager rm;
    rm.add_resource("Printer A", ResourceCategory::IO, 1, false, "R1");
    rm.add_resource("DB Lock B", ResourceCategory::LOCK, 1, false, "R2");

    ProcessManager pm;
    make_proc_with_alloc(pm, rm, "P1", {{"R1", 1}, {"R2", 1}}, {{"R1", 1}}, {{"R2", 1}});
    make_proc_with_alloc(pm, rm, "P2", {{"R1", 1}, {"R2", 1}}, {{"R2", 1}}, {{"R1", 1}});

    DeadlockDetector detector;
    auto report = detector.detect(pm.processes(), rm.resources());
    EXPECT_TRUE(report.detected);
    EXPECT_TRUE(report.has_cycle_in_rag);
    EXPECT_EQ(report.deadlocked_processes, (std::vector<std::string>{"P1", "P2"}));
    EXPECT_EQ(report.involved_resources, (std::vector<std::string>{"R1", "R2"}));
    EXPECT_FALSE(report.wait_for_edges.empty());
}

// MANDATORY TEST 3: Multi-instance RAG cycle WITHOUT deadlock
TEST(DeadlockDetectorTest, MultiInstanceCycleWithoutDeadlock) {
    ResourceManager rm;
    rm.add_resource("Pool R0", ResourceCategory::COMPUTE, 2, false, "R0");
    rm.add_resource("Lock R1", ResourceCategory::LOCK, 1, false, "R1");

    ProcessManager pm;
    // P0 holds 1 R0, requests 1 R1; P1 holds 1 R1, requests 1 R0; P2 holds 1 R0, requests nothing.
    make_proc_with_alloc(pm, rm, "P0", {{"R0", 1}, {"R1", 1}}, {{"R0", 1}}, {{"R1", 1}});
    make_proc_with_alloc(pm, rm, "P1", {{"R0", 1}, {"R1", 1}}, {{"R1", 1}}, {{"R0", 1}});
    make_proc_with_alloc(pm, rm, "P2", {{"R0", 1}}, {{"R0", 1}}, {});

    DeadlockDetector detector;
    auto report = detector.detect(pm.processes(), rm.resources());
    EXPECT_TRUE(report.has_cycle_in_rag);
    EXPECT_FALSE(report.detected);
    EXPECT_TRUE(report.deadlocked_processes.empty());
}

// MANDATORY TEST 4: Unsafe state without deadlock
TEST(DeadlockDetectorTest, UnsafeStateWithoutDeadlock) {
    ResourceManager rm;
    rm.add_resource("Tape", ResourceCategory::STORAGE, 4, false, "R0");

    ProcessManager pm;
    // Total=4. P0 holds 2 (Max 4, Need 2, Pending 0). P1 holds 1 (Max 3, Need 2, Pending 0). Available=1.
    make_proc_with_alloc(pm, rm, "P0", {{"R0", 4}}, {{"R0", 2}}, {});
    make_proc_with_alloc(pm, rm, "P1", {{"R0", 3}}, {{"R0", 1}}, {});

    BankersAlgorithm banker;
    auto b_report = banker.check_safety(pm.processes(), rm.resources());
    EXPECT_FALSE(b_report.is_safe);

    DeadlockDetector detector;
    auto d_report = detector.detect(pm.processes(), rm.resources());
    EXPECT_FALSE(d_report.detected);
    EXPECT_TRUE(d_report.deadlocked_processes.empty());
}
