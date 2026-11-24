#include <gtest/gtest.h>

#include "BankersAlgorithm.hpp"
#include "CPUScheduler.hpp"
#include "DeadlockDetector.hpp"
#include "ProcessManager.hpp"
#include "RecoveryManager.hpp"
#include "ResourceManager.hpp"
#include "SyncLab.hpp"

using namespace deadlock_city;

// MANDATORY TEST 5: Deadlock recovery via victim termination & resource preemption
TEST(RecoveryManagerTest, TerminatesVictimAndResolvesDeadlock) {
    SimulationState state;
    ResourceManager rm;
    rm.add_resource("Printer", ResourceCategory::IO, 1, false, "R1");
    rm.add_resource("DB Lock", ResourceCategory::LOCK, 1, true, "R2");

    ProcessManager pm;
    pm.add_process("WorkerA", 0, 8, 2, {{"R1", 1}, {"R2", 1}}, rm.resources(), 10, "P1");
    pm.add_process("WorkerB", 0, 3, 8, {{"R1", 1}, {"R2", 1}}, rm.resources(), 2, "P2");

    std::string err;
    ASSERT_TRUE(rm.allocate("R1", 1, err));
    ASSERT_TRUE(rm.allocate("R2", 1, err));

    auto* p1 = pm.find_mut("P1");
    auto* p2 = pm.find_mut("P2");
    p1->allocated["R1"] = 1;
    p1->pending_request["R2"] = 1;
    p1->state = ProcessState::BLOCKED;
    pm.recompute_need(*p1, rm.resources());

    p2->allocated["R2"] = 1;
    p2->pending_request["R1"] = 1;
    p2->state = ProcessState::BLOCKED;
    pm.recompute_need(*p2, rm.resources());

    DeadlockDetector detector;
    BankersAlgorithm banker;
    ASSERT_TRUE(detector.detect(pm.processes(), rm.resources()).detected);

    RecoveryManager recovery;
    RecoveryRequest req;
    req.strategy = RecoveryStrategy::TERMINATE_VICTIM;
    req.victim_criteria = VictimCriteria::LOWEST_COST; // P2 cost=2 < P1 cost=10

    auto res = recovery.recover(state, pm, rm, detector, banker, req);
    EXPECT_TRUE(res.ok) << res.message;
    EXPECT_EQ(res.terminated_processes, (std::vector<std::string>{"P2"}));
    EXPECT_EQ(pm.find("P2")->state, ProcessState::TERMINATED);
    // P1's pending request for R2 should now be satisfied automatically
    EXPECT_EQ(pm.find("P1")->allocated.at("R2"), 1);
    EXPECT_EQ(pm.find("P1")->state, ProcessState::READY);
    EXPECT_FALSE(state.deadlock_report.detected);
    EXPECT_EQ(state.recovery_count, 1);
}

TEST(RecoveryManagerTest, PreemptResourceAndRollbackCheckpoint) {
    SimulationState state;
    ResourceManager rm;
    rm.add_resource("GPU", ResourceCategory::COMPUTE, 1, true, "R0");
    rm.add_resource("Bus", ResourceCategory::IO, 1, false, "R1");

    ProcessManager pm;
    pm.add_process("Render", 0, 5, 3, {{"R0", 1}, {"R1", 1}}, rm.resources(), 5, "P0");
    pm.add_process("Train", 0, 5, 6, {{"R0", 1}, {"R1", 1}}, rm.resources(), 5, "P1");

    // Save clean checkpoint before deadlock
    SimulationStateSnapshot clean_snap;
    clean_snap.tick = 1;
    clean_snap.processes = pm.processes();
    clean_snap.resources = rm.resources();
    state.checkpoints.push_back(clean_snap);

    std::string err;
    ASSERT_TRUE(rm.allocate("R0", 1, err));
    ASSERT_TRUE(rm.allocate("R1", 1, err));
    pm.find_mut("P0")->allocated["R0"] = 1;
    pm.find_mut("P0")->pending_request["R1"] = 1;
    pm.find_mut("P0")->state = ProcessState::BLOCKED;
    pm.find_mut("P1")->allocated["R1"] = 1;
    pm.find_mut("P1")->pending_request["R0"] = 1;
    pm.find_mut("P1")->state = ProcessState::BLOCKED;

    DeadlockDetector detector;
    BankersAlgorithm banker;
    RecoveryManager recovery;

    // Preempt R0 (preemptible) from P0 -> unblocks P1
    RecoveryRequest preempt_req;
    preempt_req.strategy = RecoveryStrategy::PREEMPT_RESOURCE;
    preempt_req.target_resource_id = "R0";
    auto p_res = recovery.recover(state, pm, rm, detector, banker, preempt_req);
    EXPECT_TRUE(p_res.ok) << p_res.message;
    EXPECT_EQ(state.preemption_count, 1);
    EXPECT_FALSE(state.deadlock_report.detected);

    // Now test rollback to clean checkpoint
    RecoveryRequest rb_req;
    rb_req.strategy = RecoveryStrategy::ROLLBACK;
    auto rb_res = recovery.recover(state, pm, rm, detector, banker, rb_req);
    EXPECT_TRUE(rb_res.ok) << rb_res.message;
    EXPECT_EQ(state.tick, 1);
    EXPECT_EQ(rm.find("R0")->available_instances, 1);
    EXPECT_EQ(rm.find("R1")->available_instances, 1);
}

// MANDATORY TEST 7: CPU scheduling Gantt chart & manually verified metrics
TEST(CPUSchedulerTest, VerifiedGanttAndMetrics) {
    CPUScheduler scheduler;
    std::vector<ScheduleInputProcess> procs = {
        {"P1", "Alpha", 0, 5, 2},
        {"P2", "Beta", 1, 3, 1},
        {"P3", "Gamma", 2, 1, 3}
    };

    // FCFS: P1[0..5], P2[5..8], P3[8..9]
    // WT: P1=0, P2=4, P3=6 -> avg = 10/3 = 3.3333
    // TAT: P1=5, P2=7, P3=7 -> avg = 19/3 = 6.3333
    auto fcfs = scheduler.run(SchedulingAlgorithm::FCFS, procs, 2);
    EXPECT_EQ(fcfs.total_time, 9);
    EXPECT_NEAR(fcfs.avg_waiting_time, 10.0 / 3.0, 1e-4);
    EXPECT_NEAR(fcfs.avg_turnaround_time, 19.0 / 3.0, 1e-4);
    EXPECT_EQ(fcfs.context_switches, 2);

    // SJF: P1[0..5], P3(burst 1)[5..6], P2(burst 3)[6..9]
    // Completion: P1=5 (WT=0), P3=6 (WT=3), P2=9 (WT=5) -> avg WT = 8/3
    auto sjf = scheduler.run(SchedulingAlgorithm::SJF, procs, 2);
    EXPECT_NEAR(sjf.avg_waiting_time, 8.0 / 3.0, 1e-4);

    // SRTF: P1[0..1], P2[1..2], P3[2..3], P2[3..5], P1[5..9]
    // Completion: P3=3 (WT=0), P2=5 (WT=1), P1=9 (WT=4) -> avg WT = 5/3
    auto srtf = scheduler.run(SchedulingAlgorithm::SRTF, procs, 2);
    EXPECT_NEAR(srtf.avg_waiting_time, 5.0 / 3.0, 1e-4);
    EXPECT_EQ(srtf.context_switches, 4);

    // Priority (1 highest): P1 starts at 0 -> P1[0..5], then P2(prio1)[5..8], P3(prio3)[8..9]
    auto prio = scheduler.run(SchedulingAlgorithm::PRIORITY, procs, 2);
    EXPECT_NEAR(prio.avg_waiting_time, 10.0 / 3.0, 1e-4);

    // Round Robin (q=2): P1[0..2], P2[2..4], P3[4..5], P1[5..7], P2[7..8], P1[8..9]
    // Completion: P3=5 (WT=2), P2=8 (WT=4), P1=9 (WT=4) -> avg WT = 10/3
    auto rr = scheduler.run(SchedulingAlgorithm::RR, procs, 2);
    EXPECT_NEAR(rr.avg_waiting_time, 10.0 / 3.0, 1e-4);
    EXPECT_EQ(rr.total_time, 9);
}

// MANDATORY TEST 8: Bounded Synchronization Lab (Safe vs Unsafe)
TEST(SyncLabTest, ProducerConsumerSafeHasNoOverflowOrUnderflow) {
    SyncLab lab;
    SyncRequest req;
    req.scenario = SyncScenario::PRODUCER_CONSUMER;
    req.mode = SyncMode::SAFE;
    req.iterations = 8;
    req.buffer_size = 3;

    auto report = lab.run(req);
    EXPECT_TRUE(report.completed_cleanly);
    EXPECT_FALSE(report.race_or_deadlock_detected);
    EXPECT_EQ(report.produced_count, 16);
    EXPECT_EQ(report.consumed_count, 16);
    EXPECT_EQ(report.overflows, 0);
    EXPECT_EQ(report.underflows, 0);
}

TEST(SyncLabTest, DiningPhilosophersSafeCompletesAllMeals) {
    SyncLab lab;
    SyncRequest req;
    req.scenario = SyncScenario::DINING_PHILOSOPHERS;
    req.mode = SyncMode::SAFE;
    req.iterations = 4;

    auto report = lab.run(req);
    EXPECT_TRUE(report.completed_cleanly);
    EXPECT_EQ(report.completed_meals, 20);
    EXPECT_EQ(report.conflicts, 0);
}

TEST(SyncLabTest, ReadersWritersSafeHasZeroConflicts) {
    SyncLab lab;
    SyncRequest req;
    req.scenario = SyncScenario::READERS_WRITERS;
    req.mode = SyncMode::SAFE;
    req.iterations = 6;

    auto report = lab.run(req);
    EXPECT_TRUE(report.completed_cleanly);
    EXPECT_EQ(report.conflicts, 0);
}

TEST(SyncLabTest, UnsafeModesTerminateBoundedlyAndReportAnomalies) {
    SyncLab lab;
    SyncRequest pc;
    pc.scenario = SyncScenario::PRODUCER_CONSUMER;
    pc.mode = SyncMode::UNSAFE;
    pc.iterations = 6;
    pc.buffer_size = 2;
    auto pc_rep = lab.run(pc);
    EXPECT_TRUE(pc_rep.race_or_deadlock_detected);

    SyncRequest dp;
    dp.scenario = SyncScenario::DINING_PHILOSOPHERS;
    dp.mode = SyncMode::UNSAFE;
    dp.iterations = 2;
    auto dp_rep = lab.run(dp);
    EXPECT_FALSE(dp_rep.completed_cleanly);
}
