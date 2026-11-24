cmake_minimum_required(VERSION 3.16)
project(deadlock_engine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(MSVC)
    add_compile_options(/W4)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

include(FetchContent)

find_package(nlohmann_json 3.11 QUIET)
if(NOT nlohmann_json_FOUND)
    FetchContent_Declare(
        nlohmann_json
        URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    FetchContent_MakeAvailable(nlohmann_json)
endif()

find_package(GTest QUIET)
if(NOT GTest_FOUND)
    FetchContent_Declare(
        googletest
        URL https://github.com/google/googletest/archive/refs/tags/v1.14.0.tar.gz
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    )
    set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
    FetchContent_MakeAvailable(googletest)
endif()

find_package(Threads REQUIRED)

set(ENGINE_CORE_SOURCES
    src/Types.cpp
    src/ResourceManager.cpp
    src/ProcessManager.cpp
    src/BankersAlgorithm.cpp
    src/DeadlockDetector.cpp
    src/RecoveryManager.cpp
    src/CPUScheduler.cpp
    src/SyncLab.cpp
    src/SimulationSerializer.cpp
    src/SimulationEngine.cpp
)

add_library(deadlock_core STATIC ${ENGINE_CORE_SOURCES})
target_include_directories(deadlock_core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(deadlock_core PUBLIC nlohmann_json::nlohmann_json Threads::Threads)

add_executable(deadlock_engine src/main.cpp)
target_link_libraries(deadlock_engine PRIVATE deadlock_core)

enable_testing()
add_executable(deadlock_tests
    tests/test_managers.cpp
    tests/test_banker_and_detection.cpp
    tests/test_recovery_scheduling_sync.cpp
    tests/test_engine_ipc.cpp
)
target_link_libraries(deadlock_tests PRIVATE deadlock_core GTest::gtest_main)

include(GoogleTest)
gtest_discover_tests(deadlock_tests)
