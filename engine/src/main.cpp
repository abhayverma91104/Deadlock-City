#include "SimulationEngine.hpp"

#include <iostream>
#include <nlohmann/json.hpp>
#include <sstream>
#include <string>

int main(int argc, char** argv) {
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--version") {
            std::cout << "1.0.0\n";
            return 0;
        }
        if (arg == "--health") {
            nlohmann::json out = {
                {"ok", true},
                {"engine_version", "1.0.0"},
                {"status", "ok"}
            };
            std::cout << out.dump() << "\n";
            return 0;
        }
    }

    // Default / --json-stdio mode: read complete JSON command from stdin and write JSON response to stdout
    std::ostringstream buffer;
    buffer << std::cin.rdbuf();
    const std::string raw = buffer.str();

    if (raw.empty()) {
        nlohmann::json err = {
            {"ok", false},
            {"command", ""},
            {"error", {{"code", "EMPTY_INPUT"}, {"message", "No JSON input received on stdin."}}},
            {"state", nullptr},
            {"result", nullptr}
        };
        std::cout << err.dump() << "\n";
        return 0;
    }

    try {
        auto req = nlohmann::json::parse(raw);
        deadlock_city::SimulationEngine engine;
        auto resp = engine.execute_command(req);
        std::cout << resp.dump() << "\n";
    } catch (const nlohmann::json::parse_error& e) {
        nlohmann::json err = {
            {"ok", false},
            {"command", ""},
            {"error", {{"code", "JSON_PARSE_ERROR"}, {"message", e.what()}}},
            {"state", nullptr},
            {"result", nullptr}
        };
        std::cout << err.dump() << "\n";
    }
    return 0;
}
