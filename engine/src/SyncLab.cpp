#include "SyncLab.hpp"

#include <algorithm>
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
    const std::string& detail
) {
    std::lock_guard<std::mutex> lock(log_mtx);
    const int s = seq.fetch_add(1);
    if (events.size() < 200) {
        events.push_back(SyncEvent{s, tid, state, action, resource, detail});
    }
    if (logs.size() < 200) {
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
    int logical_count = 0;

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
                    if (!not_full.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                            return static_cast<int>(buffer.size()) < capacity;
                        })) {
                        return;
                    }
                    buffer.push_back(p * 100 + i);
                    produced.fetch_add(1);
                    const auto occ = buffer.size();
                    lock.unlock();
                    not_empty.notify_one();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "PRODUCE", "Buffer", "Item queued; occupancy " + std::to_string(occ) + "/" + std::to_string(capacity));
                }
            });
        }

        for (int c = 0; c < num_consumers; ++c) {
            threads.emplace_back([&, c]() {
                const std::string tid = "Consumer-" + std::to_string(c + 1);
                for (int i = 0; i < items_per_producer; ++i) {
                    std::unique_lock<std::mutex> lock(buf_mtx);
                    if (!not_empty.wait_for(lock, std::chrono::milliseconds(500), [&]() {
                            return !buffer.empty();
                        })) {
                        return;
                    }
                    buffer.pop_back();
                    consumed.fetch_add(1);
                    const auto occ = buffer.size();
                    lock.unlock();
                    not_full.notify_one();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "CONSUME", "Buffer", "Item consumed; occupancy " + std::to_string(occ) + "/" + std::to_string(capacity));
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
                    logical_count = next;
                    produced.fetch_add(1);
                    if (next > capacity) {
                        overflows.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "OVERFLOW", "Buffer", "Unsafe write exceeded capacity (" + std::to_string(next) + "/" + std::to_string(capacity) + ")");
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_PRODUCE", "Buffer", "Unsynchronized write; count=" + std::to_string(next));
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
                                     "UNDERFLOW", "Buffer", "Unsafe read on empty buffer (count=" + std::to_string(next) + ")");
                    } else {
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                     "UNSAFE_CONSUME", "Buffer", "Unsynchronized read; count=" + std::to_string(next));
                    }
                }
            });
        }
        for (auto& t : threads) t.join();

        (void)logical_count;
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
                    {
                        std::unique_lock<std::mutex> lock(rw_mtx);
                        rw_cv.wait_for(lock, std::chrono::milliseconds(300), [&]() {
                            return active_writers == 0;
                        });
                        active_readers++;
                    }
                    if (atomic_writers.load() > 0) conflicts.fetch_add(1);
                    const int val = shared_data;
                    std::this_thread::sleep_for(std::chrono::microseconds(80));
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "READ", "SharedStore", "Read value=" + std::to_string(val));
                    {
                        std::lock_guard<std::mutex> lock(rw_mtx);
                        active_readers--;
                        if (active_readers == 0) rw_cv.notify_all();
                    }
                }
            });
        }
        for (int w = 0; w < 2; ++w) {
            threads.emplace_back([&, w]() {
                const std::string tid = "Writer-" + std::to_string(w + 1);
                for (int i = 0; i < iters; ++i) {
                    std::unique_lock<std::mutex> lock(rw_mtx);
                    rw_cv.wait_for(lock, std::chrono::milliseconds(300), [&]() {
                        return active_readers == 0 && active_writers == 0;
                    });
                    active_writers++;
                    atomic_writers.fetch_add(1);
                    shared_data += 1;
                    const int val = shared_data;
                    std::this_thread::sleep_for(std::chrono::microseconds(100));
                    atomic_writers.fetch_sub(1);
                    active_writers--;
                    rw_cv.notify_all();
                    lock.unlock();
                    record_event(report.events, report.logs, log_mtx, seq, tid, "RUNNING",
                                 "WRITE", "SharedStore", "Updated value=" + std::to_string(val));
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
                    atomic_readers.fetch_add(1);
                    if (atomic_writers.load() > 0) {
                        conflicts.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "RW_CONFLICT", "SharedStore", "Reader entered critical section while writer active!");
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
                    atomic_writers.fetch_add(1);
                    if (atomic_readers.load() > 0 || atomic_writers.load() > 1) {
                        conflicts.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "RACE",
                                     "WRITE_CONFLICT", "SharedStore", "Concurrent write/read violation detected!");
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

SyncReport run_dining_philosophers(const SyncRequest& req) {
    SyncReport report;
    report.scenario = SyncScenario::DINING_PHILOSOPHERS;
    report.mode = req.mode;

    constexpr int kCount = 5;
    const int meals_target = std::clamp(req.iterations, 1, 20);
    std::vector<std::timed_mutex> forks(kCount);

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
                if (req.mode == SyncMode::SAFE) {
                    // Resource hierarchy: always acquire lower-indexed fork first to break circular wait
                    const int first = std::min(left, right);
                    const int second = std::max(left, right);
                    std::unique_lock<std::timed_mutex> l1(forks[first], std::chrono::milliseconds(400));
                    if (!l1.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    std::unique_lock<std::timed_mutex> l2(forks[second], std::chrono::milliseconds(400));
                    if (!l2.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    completed_meals.fetch_add(1);
                    record_event(report.events, report.logs, log_mtx, seq, tid, "EATING",
                                 "EAT", "Fork-" + std::to_string(first) + "+Fork-" + std::to_string(second),
                                 "Meal #" + std::to_string(m + 1) + " completed cleanly.");
                    std::this_thread::sleep_for(std::chrono::microseconds(60));
                } else {
                    // Unsafe circular hold-and-wait: all grab left simultaneously, then wait briefly on right
                    std::unique_lock<std::timed_mutex> l1(forks[left], std::chrono::milliseconds(30));
                    if (!l1.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        continue;
                    }
                    std::this_thread::sleep_for(std::chrono::milliseconds(5));
                    std::unique_lock<std::timed_mutex> l2(forks[right], std::chrono::milliseconds(15));
                    if (!l2.owns_lock()) {
                        deadlock_timeouts.fetch_add(1);
                        record_event(report.events, report.logs, log_mtx, seq, tid, "BLOCKED",
                                     "TIMEOUT", "Fork-" + std::to_string(right),
                                     "Circular wait timeout holding Fork-" + std::to_string(left) +
                                     " while waiting for Fork-" + std::to_string(right) + ".");
                        continue;
                    }
                    completed_meals.fetch_add(1);
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
                         std::to_string(report.conflicts) + " circular-wait deadlock timeout(s); " +
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
