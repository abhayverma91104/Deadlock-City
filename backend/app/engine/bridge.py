from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("deadlock_city.engine_bridge")


class EngineBridgeError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 500, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details or {}


class EngineUnavailableError(EngineBridgeError):
    def __init__(self, message: str):
        super().__init__("ENGINE_UNAVAILABLE", message, status_code=503)


class EngineTimeoutError(EngineBridgeError):
    def __init__(self, command: str, timeout_seconds: float):
        super().__init__(
            "ENGINE_TIMEOUT",
            f"C++ simulation engine timed out after {timeout_seconds:.1f}s executing '{command}'.",
            status_code=504,
        )


class EngineDomainError(EngineBridgeError):
    def __init__(
        self,
        code: str,
        message: str,
        state: Optional[Dict[str, Any]] = None,
        result: Optional[Dict[str, Any]] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        status = 400
        if code in {"PROCESS_NOT_FOUND", "RESOURCE_NOT_FOUND"}:
            status = 404
        elif code in {
            "NO_DEADLOCK_DETECTED",
            "DEADLOCK_UNRESOLVED",
            "NO_CHECKPOINTS",
            "NO_PREEMPTIBLE_RESOURCE",
            "RESOURCE_NOT_PREEMPTIBLE",
        }:
            status = 409
        super().__init__(code, message, status_code=status, details=details)
        self.state = state
        self.result = result


def resolve_default_engine_path() -> Path:
    env_path = os.environ.get("DEADLOCK_ENGINE_PATH")
    if env_path:
        return Path(env_path)
    # backend/app/engine/bridge.py -> repo root -> engine/build/deadlock_engine
    repo_root = Path(__file__).resolve().parents[3]
    return repo_root / "engine" / "build" / "deadlock_engine"


class EngineBridge:
    """Safe async subprocess bridge to the C++17 deadlock_engine executable."""

    def __init__(
        self,
        binary_path: Optional[Path] = None,
        default_timeout: float = 5.0,
        sync_timeout: float = 15.0,
        max_concurrency: Optional[int] = None,
    ):
        self.binary_path = Path(binary_path) if binary_path else resolve_default_engine_path()
        self.default_timeout = default_timeout
        self.sync_timeout = sync_timeout
        env_conc = int(os.environ.get("DEADLOCK_MAX_ENGINE_CONCURRENCY", "8"))
        effective_conc = max(1, max_concurrency if max_concurrency is not None else env_conc)
        self._semaphore = asyncio.Semaphore(effective_conc)

    def _ensure_binary(self) -> Path:
        if not self.binary_path.exists():
            raise EngineUnavailableError(
                f"C++ engine binary not found at '{self.binary_path}'. Build engine/ first."
            )
        if not os.access(self.binary_path, os.X_OK):
            raise EngineUnavailableError(
                f"C++ engine binary at '{self.binary_path}' is not executable."
            )
        return self.binary_path

    async def health(self) -> Dict[str, Any]:
        binary = self._ensure_binary()
        proc = await asyncio.create_subprocess_exec(
            str(binary),
            "--health",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.default_timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            raise EngineTimeoutError("health", self.default_timeout)

        if proc.returncode != 0:
            err_txt = stderr.decode("utf-8", errors="replace").strip()
            raise EngineBridgeError("ENGINE_CRASH", f"Engine health check failed: {err_txt}", status_code=500)

        try:
            data = json.loads(stdout.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise EngineBridgeError("ENGINE_MALFORMED_OUTPUT", f"Malformed health JSON: {exc}", status_code=500)

        return data

    async def execute(
        self,
        command: str,
        state: Optional[Dict[str, Any]] = None,
        payload: Optional[Dict[str, Any]] = None,
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        binary = self._ensure_binary()
        effective_timeout = timeout if timeout is not None else (
            self.sync_timeout if command == "run_synchronization" else self.default_timeout
        )

        request_obj = {
            "command": command,
            "state": state,
            "payload": payload or {},
        }
        stdin_bytes = json.dumps(request_obj).encode("utf-8")

        async with self._semaphore:
            proc = await asyncio.create_subprocess_exec(
                str(binary),
                "--json-stdio",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(input=stdin_bytes), timeout=effective_timeout)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                logger.error("C++ engine timed out for command=%s after %.1fs", command, effective_timeout)
                raise EngineTimeoutError(command, effective_timeout)

        if proc.returncode != 0:
            err_txt = stderr.decode("utf-8", errors="replace").strip()
            logger.error("C++ engine exited non-zero (%s) on command=%s: %s", proc.returncode, command, err_txt)
            raise EngineBridgeError(
                "ENGINE_PROCESS_FAILED",
                f"C++ engine crashed or exited with code {proc.returncode}: {err_txt or 'no stderr'}",
                status_code=500,
            )

        raw_out = stdout.decode("utf-8", errors="replace").strip()
        if not raw_out:
            raise EngineBridgeError("ENGINE_EMPTY_OUTPUT", "C++ engine returned empty output.", status_code=500)

        try:
            response = json.loads(raw_out)
        except json.JSONDecodeError as exc:
            logger.error("Malformed JSON from C++ engine: %s | raw=%s", exc, raw_out[:300])
            raise EngineBridgeError("ENGINE_MALFORMED_JSON", f"Malformed JSON from C++ engine: {exc}", status_code=500)

        if not isinstance(response, dict) or "ok" not in response:
            raise EngineBridgeError("ENGINE_INVALID_ENVELOPE", "C++ engine response missing required 'ok' field.", status_code=500)

        if not response["ok"]:
            err = response.get("error") or {}
            raise EngineDomainError(
                code=err.get("code", "ENGINE_ERROR"),
                message=err.get("message", "Unknown engine error."),
                state=response.get("state"),
                result=response.get("result"),
            )

        return response
