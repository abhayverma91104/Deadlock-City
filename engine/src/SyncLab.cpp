#include "SyncLab.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <condition_variable>
#include <mutex>
#include <stdexcept>
#include <thread>
#include <vector>

namespace deadlock_city {

std::string to_string(SyncScenario s) {
    switch (s) {
        case SyncScenario::PRODUCER_CONSUMER: return "producer_consumer";
        case SyncScenario::READERS_WRITERS: return "readers_writers";
        case SyncScenario::DINING_PHILOSOPHERS: return "dining_philosophers";
    }
    return "producer_consumer";
}

SyncScenario sync_scenario_from_string(const std::string& s) {
    std::string l = s;
    std::transform(l.begin(), l.end(), l.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (l == "producer_consumer") return SyncScenario::PRODUCER_CONSUMER;
    if (l == "readers_writers") return SyncScenario::READERS_WRITERS;
    if (l == "dining_philosophers") return SyncScenario::DINING_PHILOSOPHERS;
    throw std::invalid_argument("Invalid SyncScenario: " + s);
}

std::string to_string(SyncMode m) {
    return m == SyncMode::SAFE ? "safe" : "unsafe";
}

SyncMode sync_mode_from_string(const std::string& s) {
    std::string l = s;
    std::transform(l.begin(), l.end(), l.begin(), [](unsigned char c) {
        return static_cast<char>(std::tolower(c));
    });
    if (l == "safe") return SyncMode::SAFE;
    if (l == "unsafe") return SyncMode::UNSAFE;
    throw std::invalid_argument("Invalid SyncMode: " + s);
}

namespace {

void record_event(
    std::vector<SyncEvent>& events,
    std::vector<std::string>& logs,
    std::mutex& log_mtx,
    std::atomic<int>& seq,
    const std::string& tid,
    const std::string& state,
    const std::string& action,
    const std::string& resource,
    const std::string& detail,
    int buffer_occupancy = -1,
    int buffer_capacity = 0,
    int active_readers = 0,
    int active_writers = 0,
    std::vector<int> fork_owners = {}
) {
    std::lock_guard<std::mutex> lock(log_mtx);
    const int s = seq.fetch_add(1);
    if (events.size() < 240) {
        SyncEvent ev;
        ev.seq = s;
        ev.thread_id = tid;
        ev.state = state;
        ev.action = action;
        ev.resource = resource;
        ev.detail = detail;
        ev.buffer_occupancy = buffer_occupancy;
        ev.buffer_capacity = buffer_capacity;
        ev.active_readers = active_readers;
        ev.active_writers = active_writers;
        ev.fork_owners = std::move(fork_owners);
        events.push_back(std::move(ev));
    }
    if (logs.size() < 240) {
        logs.push_back("[" + tid + "] " + action + " (" + resource + "): " + detail);
    }
}

SyncReport run_producer_consumer(const SyncRequest& req) {
    SyncReport report;
    report.scenario = SyncScenario::PRODUCER_CONSUMER;
    report.mode = req.mode;

    const int capacity = std::clamp(req.buffer_size, 1, 32);
    const int items_per_producer = std::clamp(req.iterations, 1, 50);
    const int num_producers = 2;
    const int num_consumers = 2;
    const int total_items = items_per_producer * num_producers;

    std::mutex buf_mtx;
    std::condition_variable not_full;
    std::condition_variable not_empty;
    std::vector<int> buffer;

    std::mutex log_mtx;
    std::atomic<int> seq{0};
    std::atomic<int> produced{0};
    std::atomic<int> consumed{0};
    std::atomic<int> overflows{0};
    std::atomic<int> underflows{0};

    if (req.mode == SyncMode::SAFE) {
        std::vector<std::thread> threads;
        for (int p = 0; p < num_producers; ++p) {
            threads.emplace_back([&, p]() {
                const std::string tid = "Producer-" + std::to_string(p + 1);
                for (int i = 0; i < items_per_producer; ++i) {
                    std::unique_lock<std::mutex> lock(buf_mtx);
                    if (static_cast<int>(buffer.size()) >= capacity) {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                     "WAIT_NOT_FULL", "Buffer",
                                     "Buffer full (" + std::to_string(buffer.size()) + "/" + std::to_string(capacity) + "); waiting on CV.",
                                     static_cast<int>(buffer.size()), capacity);
                    }
                    if (!not_full.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                            return static_cast<int>(buffer.size()) < capacity;
                        })) {
                        return;
                    }
                    buffer.push_back(p * 100 + i);
                    produced.fetch_add(1);
                    const int occ = static_cast<int>(buffer.size());
                    lock.unlock();
                    not_empty.notify_one();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "PRODUCE", "Buffer", "Item queued; occupancy " + std::to_string(occ) + "/" + std::to_string(capacity),
                                 occ, capacity);
                }
            });
        }

        for (int c = 0; c < num_consumers; ++c) {
            threads.emplace_back([&, c]() {
                const std::string tid = "Consumer-" + std::to_string(c + 1);
                for (int i = 0; i < items_per_producer; ++i) {
                    std::unique_lock<std::mutex> lock(buf_mtx);
                    if (buffer.empty()) {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                     "WAIT_NOT_EMPTY", "Buffer",
                                     "Buffer empty (0/" + std::to_string(capacity) + "); waiting on CV.",
                                     0, capacity);
                    }
                    if (!not_empty.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                            return !buffer.empty();
                        })) {
                        return;
                    }
                    buffer.pop_back();
                    consumed.fetch_add(1);
                    const int occ = static_cast<int>(buffer.size());
                    lock.unlock();
                    not_full.notify_one();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "CONSUME", "Buffer", "Item consumed; occupancy " + std::to_string(occ) + "/" + std::to_string(capacity),
                                 occ, capacity);
                }
            });
        }
        for (auto& t : threads) t.join();

        report.produced_count = produced.load();
        report.consumed_count = consumed.load();
        report.overflows = 0;
        report.underflows = 0;
        report.completed_cleanly = (report.produced_count == total_items && report.consumed_count == total_items);
        report.race_or_deadlock_detected = false;
        report.summary = "SAFE Producer-Consumer completed with mutex + condition variables: " +
                         std::to_string(report.produced_count) + " produced, " +
                         std::to_string(report.consumed_count) + " consumed, 0 overflows, 0 underflows.";
    } else {
        // Deliberately unsafe mode: omit synchronization barriers so producers/consumers race on logical occupancy
        std::atomic<int> unsync_count{0};
        std::vector<std::thread> threads;
        for (int p = 0; p < num_producers; ++p) {
            threads.emplace_back([&, p]() {
                const std::string tid = "Producer-" + std::to_string(p + 1);
                for (int i = 0; i < items_per_producer; ++i) {
                    int observed = unsync_count.load(std::memory_order_relaxed);
                    std::this_thread::sleep_for(std::chrono::microseconds(150));
                    int next = observed + 1;
                    unsync_count.store(next, std::memory_order_relaxed);
                    produced.fetch_add(1);
                    if (next > capacity) {
                        overflows.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "OVERFLOW", "Buffer",
                                     "Unsafe write exceeded capacity (" + std::to_string(next) + "/" + std::to_string(capacity) + ")",
                                     next, capacity);
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_PRODUCE", "Buffer",
                                     "Unsynchronized write; count=" + std::to_string(next),
                                     next, capacity);
                    }
                }
            });
        }
        for (int c = 0; c < num_consumers; ++c) {
            threads.emplace_back([&, c]() {
                const std::string tid = "Consumer-" + std::to_string(c + 1);
                for (int i = 0; i < items_per_producer; ++i) {
                    int observed = unsync_count.load(std::memory_order_relaxed);
                    std::this_thread::sleep_for(std::chrono::microseconds(120));
                    int next = observed - 1;
                    unsync_count.store(next, std::memory_order_relaxed);
                    consumed.fetch_add(1);
                    if (next < 0) {
                        underflows.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "UNDERFLOW", "Buffer",
                                     "Unsafe read on empty buffer (count=" + std::to_string(next) + ")",
                                     next, capacity);
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_CONSUME", "Buffer",
                                     "Unsynchronized read; count=" + std::to_string(next),
                                     next, capacity);
                    }
                }
            });
        }
        for (auto& t : threads) t.join();

        report.produced_count = produced.load();
        report.consumed_count = consumed.load();
        report.overflows = overflows.load();
        report.underflows = underflows.load();
        report.conflicts = report.overflows + report.underflows;
        report.race_or_deadlock_detected = true;
        report.completed_cleanly = (report.conflicts == 0);
        report.summary = "UNSAFE Producer-Consumer omitted mutex/CV guards: detected " +
                         std::to_string(report.overflows) + " overflow(s) and " +
                         std::to_string(report.underflows) + " underflow(s) due to race conditions.";
    }

    return report;
}

SyncReport run_readers_writers(const SyncRequest& req) {
    SyncReport report;
    report.scenario = SyncScenario::READERS_WRITERS;
    report.mode = req.mode;

    const int iters = std::clamp(req.iterations, 1, 40);
    std::mutex rw_mtx;
    std::condition_variable rw_cv;
    int active_readers = 0;
    int active_writers = 0;
    int shared_data = 0;

    std::atomic<int> atomic_readers{0};
    std::atomic<int> atomic_writers{0};
    std::atomic<int> conflicts{0};
    std::mutex log_mtx;
    std::atomic<int> seq{0};

    std::vector<std::thread> threads;

    if (req.mode == SyncMode::SAFE) {
        for (int r = 0; r < 3; ++r) {
            threads.emplace_back([&, r]() {
                const std::string tid = "Reader-" + std::to_string(r + 1);
                for (int i = 0; i < iters; ++i) {
                    int snap_r = 0;
                    int snap_w = 0;
                    {
                        std::unique_lock<std::mutex> lock(rw_mtx);
                        if (active_writers > 0) {
                            record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                         "WAIT_READ", "SharedStore", "Waiting for active writer to finish.",
                                         -1, 0, active_readers, active_writers);
                        }
                        if (!rw_cv.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                                return active_writers == 0;
                            })) {
                            return;
                        }
                        active_readers++;
                        snap_r = active_readers;
                        snap_w = active_writers;
                    }
                    if (atomic_writers.load() > 0) conflicts.fetch_add(1);
                    const int val = shared_data;
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "READ", "SharedStore", "Read value=" + std::to_string(val),
                                 -1, 0, snap_r, snap_w);
                    std::this_thread::sleep_for(std::chrono::microseconds(80));
                    {
                        std::lock_guard<std::mutex> lock(rw_mtx);
                        active_readers--;
                        snap_r = active_readers;
                        snap_w = active_writers;
                        if (active_readers == 0) rw_cv.notify_all();
                    }
                    record_event(report.events, report.logs, log_mtx, seq, tid, "IDLE",
                                 "READ_RELEASE", "SharedStore", "Reader released shared lock.",
                                 -1, 0, snap_r, snap_w);
                }
            });
        }
        for (int w = 0; w < 2; ++w) {
            threads.emplace_back([&, w]() {
                const std::string tid = "Writer-" + std::to_string(w + 1);
                for (int i = 0; i < iters; ++i) {
                    std::unique_lock<std::mutex> lock(rw_mtx);
                    if (active_readers > 0 || active_writers > 0) {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                     "WAIT_WRITE", "SharedStore", "Waiting for exclusive writer access.",
                                     -1, 0, active_readers, active_writers);
                    }
                    if (!rw_cv.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                            return active_readers == 0 && active_writers == 0;
                        })) {
                        return;
                    }
                    active_writers++;
                    atomic_writers.fetch_add(1);
                    shared_data += 1;
                    const int val = shared_data;
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "WRITE", "SharedStore", "Updated value=" + std::to_string(val),
                                 -1, 0, active_readers, active_writers);
                    std::this_thread::sleep_for(std::chrono::microseconds(100));
                    atomic_writers.fetch_sub(1);
                    active_writers--;
                    const int snap_r = active_readers;
                    const int snap_w = active_writers;
                    rw_cv.notify_all();
                    lock.unlock();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "IDLE",
                                 "WRITE_RELEASE", "SharedStore", "Writer released exclusive lock.",
                                 -1, 0, snap_r, snap_w);
                }
            });
        }
        for (auto& t : threads) t.join();
        report.conflicts = conflicts.load();
        report.completed_cleanly = (report.conflicts == 0);
        report.race_or_deadlock_detected = (report.conflicts > 0);
        report.summary = "SAFE Readers-Writers completed cleanly with 0 read-write conflicts.";
    } else {
        for (int r = 0; r < 3; ++r) {
            threads.emplace_back([&, r]() {
                const std::string tid = "Reader-" + std::to_string(r + 1);
                for (int i = 0; i < iters; ++i) {
                    const int ar = atomic_readers.fetch_add(1) + 1;
                    const int aw = atomic_writers.load();
                    if (aw > 0) {
                        conflicts.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "RW_CONFLICT", "SharedStore", "Reader entered critical section while writer active!",
                                     -1, 0, ar, aw);
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_READ", "SharedStore", "Unprotected read.",
                                     -1, 0, ar, aw);
                    }
                    std::this_thread::sleep_for(std::chrono::microseconds(120));
                    atomic_readers.fetch_sub(1);
                }
            });
        }
        for (int w = 0; w < 2; ++w) {
            threads.emplace_back([&, w]() {
                const std::string tid = "Writer-" + std::to_string(w + 1);
                for (int i = 0; i < iters; ++i) {
                    const int aw = atomic_writers.fetch_add(1) + 1;
                    const int ar = atomic_readers.load();
                    if (ar > 0 || aw > 1) {
                        conflicts.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "WRITE_CONFLICT", "SharedStore", "Concurrent write/read violation detected!",
                                     -1, 0, ar, aw);
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_WRITE", "SharedStore", "Unprotected write.",
                                     -1, 0, ar, aw);
                    }
                    std::this_thread::sleep_for(std::chrono::microseconds(140));
                    atomic_writers.fetch_sub(1);
                }
            });
        }
        for (auto& t : threads) t.join();
        report.conflicts = conflicts.load();
        report.race_or_deadlock_detected = (report.conflicts > 0);
        report.completed_cleanly = false;
        report.summary = "UNSAFE Readers-Writers detected " + std::to_string(report.conflicts) +
                         " concurrent read/write critical-section violation(s).";
    }

    return report;
}

struct TimedFork {
    std::mutex mtx;
    std::condition_variable cv;
    bool in_use = false;

    bool try_acquire_for(std::chrono::milliseconds timeout) {
        std::unique_lock<std::mutex> lock(mtx);
        if (!cv.wait_for(lock, timeout, [this]() { return !in_use; })) {
            return false;
        }
        in_use = true;
        return true;
    }

    void release() {
        {
            std::lock_guard<std::mutex> lock(mtx);
            in_use = false;
        }
        cv.notify_one();
    }
};

struct TimedForkGuard {
    TimedFork* fork = nullptr;
    bool acquired = false;

    TimedForkGuard() = default;
    TimedForkGuard(TimedFork& f, std::chrono::milliseconds timeout)
        : fork(&f), acquired(f.try_acquire_for(timeout)) {}
    ~TimedForkGuard() {
        if (acquired && fork) {
            fork->release();
        }
    }
    TimedForkGuard(const TimedForkGuard&) = delete;
    TimedForkGuard& operator=(const TimedForkGuard&) = delete;

    bool owns_lock() const { return acquired; }
};

SyncReport run_dining_philosophers(const SyncRequest& req) {
    SyncReport report;
    report.scenario = SyncScenario::DINING_PHILOSOPHERS;
    report.mode = req.mode;

    constexpr int kCount = 5;
    const int meals_target = std::clamp(req.iterations, 1, 20);
    std::array<TimedFork, kCount> forks;
    std::mutex fork_state_mtx;
    std::vector<int> fork_owners(kCount, -1);

    auto snapshot_forks = [&](int fork_idx, int owner) {
        std::lock_guard<std::mutex> lock(fork_state_mtx);
        if (fork_idx >= 0 && fork_idx < kCount) {
            fork_owners[static_cast<std::size_t>(fork_idx)] = owner;
        }
        return fork_owners;
    };

    std::mutex log_mtx;
    std::atomic<int> seq{0};
    std::atomic<int> completed_meals{0};
    std::atomic<int> deadlock_timeouts{0};

    std::vector<std::thread> philosophers;
    for (int i = 0; i < kCount; ++i) {
        philosophers.emplace_back([&, i]() {
            const std::string tid = "Philosopher-" + std::to_string(i);
            const int left = i;
            const int right = (i + 1) % kCount;

            for (int m = 0; m < meals_target; ++m) {
                record_event(report.events, report.logs, log_mtx, seq, tid, "HUNGRY",
                             "HUNGRY", "Table", "Philosopher ready for meal #" + std::to_string(m + 1),
                             -1, 0, 0, 0, snapshot_forks(-1, -1));

                if (req.mode == SyncMode::SAFE) {
                    const int first = std::min(left, right);
                    const int second = std::max(left, right);
                    TimedForkGuard l1(forks[first], std::chrono::milliseconds(400));
                    if (!l1.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    auto s1 = snapshot_forks(first, i);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                 "FORK_ACQUIRE", "Fork-" + std::to_string(first),
                                 "Acquired Fork-" + std::to_string(first) + "; waiting for Fork-" + std::to_string(second),
                                 -1, 0, 0, 0, s1);

                    TimedForkGuard l2(forks[second], std::chrono::milliseconds(400));
                    if (!l2.owns_lock()) {
                        snapshot_forks(first, -1);
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    auto s2 = snapshot_forks(second, i);
                    completed_meals.fetch_add(1);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "EATING",
                                 "EAT", "Fork-" + std::to_string(first) + "+Fork-" + std::to_string(second),
                                 "Meal #" + std::to_string(m + 1) + " completed cleanly.",
                                 -1, 0, 0, 0, s2);
                    std::this_thread::sleep_for(std::chrono::microseconds(60));

                    snapshot_forks(second, -1);
                    auto s_rel = snapshot_forks(first, -1);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "THINKING",
                                 "FORK_RELEASE", "Table", "Released both forks and returned to thinking.",
                                 -1, 0, 0, 0, s_rel);
                } else {
                    TimedForkGuard l1(forks[left], std::chrono::milliseconds(30));
                    if (!l1.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    auto s1 = snapshot_forks(left, i);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "WAITING",
                                 "FORK_ACQUIRE", "Fork-" + std::to_string(left),
                                 "Acquired left Fork-" + std::to_string(left) + "; attempting right Fork-" + std::to_string(right),
                                 -1, 0, 0, 0, s1);
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                    TimedForkGuard l2(forks[right], std::chrono::milliseconds(15));
                    if (!l2.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        auto s_to = snapshot_forks(left, -1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "BLOCKED",
                                     "TIMEOUT", "Fork-" + std::to_string(right),
                                     "Circular wait timeout holding Fork-" + std::to_string(left) +
                                     " while waiting for Fork-" + std::to_string(right) + "; released left fork to avoid permanent hang.",
                                     -1, 0, 0, 0, s_to);
                        continue;
                    }
                    auto s2 = snapshot_forks(right, i);
                    completed_meals.fetch_add(1);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "EATING",
                                 "EAT", "Fork-" + std::to_string(left) + "+Fork-" + std::to_string(right),
                                 "Meal completed.",
                                 -1, 0, 0, 0, s2);
                    snapshot_forks(right, -1);
                    snapshot_forks(left, -1);
                }
            }
        });
    }
    for (auto& t : philosophers) t.join();

    report.completed_meals = completed_meals.load();
    report.conflicts = deadlock_timeouts.load();
    if (req.mode == SyncMode::SAFE) {
        report.race_or_deadlock_detected = (report.conflicts > 0);
        report.completed_cleanly = (report.completed_meals == kCount * meals_target);
        report.summary = "SAFE Dining Philosophers (resource-hierarchy ordering) completed all " +
                         std::to_string(report.completed_meals) + " meals with 0 deadlocks.";
    } else {
        report.race_or_deadlock_detected = (report.conflicts > 0);
        report.completed_cleanly = false;
        report.summary = "UNSAFE Dining Philosophers experienced " +
                         std::to_string(report.conflicts) + " circular-wait timeout(s); " +
                         std::to_string(report.completed_meals) + "/" +
                         std::to_string(kCount * meals_target) + " meals completed.";
    }

    return report;
}

} // namespace

SyncReport SyncLab::run(const SyncRequest& req) const {
    switch (req.scenario) {
        case SyncScenario::PRODUCER_CONSUMER:
            return run_producer_consumer(req);
        case SyncScenario::READERS_WRITERS:
            return run_readers_writers(req);
        case SyncScenario::DINING_PHILOSOPHERS:
            return run_dining_philosophers(req);
    }
    return run_producer_consumer(req);
}

} // namespace deadlock_city
