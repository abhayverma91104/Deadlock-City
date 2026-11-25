from __future__ import annotations

import sys
from pathlib import Path
import pytest

from app.engine.bridge import (
    EngineBridge,
    EngineBridgeError,
    EngineDomainError,
    EngineTimeoutError,
    EngineUnavailableError,
)


@pytest.mark.asyncio
async def test_real_engine_health_and_preset_execution():
    bridge = EngineBridge()
    health = await bridge.health()
    assert health["ok"] is True
    assert health["engine_version"] == "1.0.0"

    resp = await bridge.execute("load_preset", payload={"preset": "classic_banker_safe", "seed": 42})
    assert resp["ok"] is True
    assert resp["state"]["banker_report"]["safe_sequence"] == ["P1", "P3", "P4", "P0", "P2"]


@pytest.mark.asyncio
async def test_engine_domain_error_handling():
    bridge = EngineBridge()
    with pytest.raises(EngineDomainError) as exc_info:
        await bridge.execute("load_preset", payload={"preset": "does_not_exist"})
    assert exc_info.value.code == "VALIDATION_ERROR"
    assert exc_info.value.status_code == 400


@pytest.mark.asyncio
async def test_engine_unavailable_binary(tmp_path: Path):
    bridge = EngineBridge(binary_path=tmp_path / "missing_binary")
    with pytest.raises(EngineUnavailableError) as exc_info:
        await bridge.health()
    assert exc_info.value.status_code == 503


@pytest.mark.asyncio
async def test_engine_timeout_and_malformed_json(tmp_path: Path):
    slow_script = tmp_path / "slow_engine.py"
    slow_script.write_text("#!/usr/bin/env python3\nimport time; time.sleep(2)\n")
    slow_script.chmod(0o755)

    # Wrap via python executable? No, script has shebang, or test malformed output directly:
    bad_script = tmp_path / "bad_json.sh"
    bad_script.write_text("#!/bin/sh\necho 'not-valid-json'\n")
    bad_script.chmod(0o755)

    bridge_bad = EngineBridge(binary_path=bad_script)
    with pytest.raises(EngineBridgeError) as bad_exc:
        await bridge_bad.execute("health")
    assert bad_exc.value.code == "ENGINE_MALFORMED_JSON"

    slow_sh = tmp_path / "slow.sh"
    slow_sh.write_text("#!/bin/sh\nsleep 2\n")
    slow_sh.chmod(0o755)
    bridge_slow = EngineBridge(binary_path=slow_sh, default_timeout=0.15)
    with pytest.raises(EngineTimeoutError) as to_exc:
        await bridge_slow.execute("step_simulation")
    assert to_exc.value.status_code == 504
