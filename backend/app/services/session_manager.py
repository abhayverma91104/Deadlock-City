from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.engine.bridge import EngineBridge, EngineBridgeError, EngineDomainError
from app.websocket.hub import WebSocketHub

logger = logging.getLogger("deadlock_city.sessions")


class SessionNotFoundError(Exception):
    def __init__(self, session_id: str):
        super().__init__(f"Simulation session '{session_id}' not found.")
        self.session_id = session_id


class SessionLimitError(Exception):
    def __init__(self, max_sessions: int):
        super().__init__(
            f"Active simulation session capacity ({max_sessions}) reached; all sessions are currently busy."
        )
        self.max_sessions = max_sessions


@dataclass
class SessionRecord:
    session_id: str
    state: Dict[str, Any]
    speed: float = 1.0
    is_running: bool = False
    seq: int = 1
    last_accessed: float = field(default_factory=time.monotonic)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    wakeup_event: asyncio.Event = field(default_factory=asyncio.Event)
    runner_task: Optional[asyncio.Task[None]] = None
    metric_timestamps: List[Tuple[Tuple[Any, ...], str]] = field(default_factory=list)
    event_timestamps: Dict[Tuple[str, str], str] = field(default_factory=dict)


def _metric_key(mp: Dict[str, Any]) -> Tuple[Any, ...]:
    return (
        mp.get("tick"),
        mp.get("allocation_count"),
        mp.get("active_count"),
        mp.get("blocked_count"),
        mp.get("deadlocked_count"),
        mp.get("recovery_count"),
        mp.get("safety_status"),
    )


def _stamp_session_timestamps(rec: SessionRecord, reset: bool = False) -> None:
    if reset:
        rec.metric_timestamps.clear()
        rec.event_timestamps.clear()

    now_iso = datetime.now(timezone.utc).isoformat()
    hist = rec.state.get("metrics_history") or []
    next_metrics: List[Tuple[Tuple[Any, ...], str]] = []
    for idx, mp in enumerate(hist):
        key = _metric_key(mp)
        if idx < len(rec.metric_timestamps) and rec.metric_timestamps[idx][0] == key:
            ts = rec.metric_timestamps[idx][1]
        else:
            ts = now_iso
        mp["recorded_at"] = ts
        next_metrics.append((key, ts))
    rec.metric_timestamps = next_metrics[-240:]

    events = rec.state.get("events") or []
    next_events: Dict[Tuple[str, str], str] = {}
    for ev in events:
        ekey = (str(ev.get("id", "")), str(ev.get("message", "")))
        ts = rec.event_timestamps.get(ekey, now_iso)
        ev["recorded_at"] = ts
        next_events[ekey] = ts
    rec.event_timestamps = next_events


class SessionManager:
    """Thread-safe / asyncio-safe registry of isolated simulation sessions."""

    def __init__(
        self,
        bridge: EngineBridge,
        ws_hub: WebSocketHub,
        max_sessions: Optional[int] = None,
    ) -> None:
        self.bridge = bridge
        self.ws_hub = ws_hub
        env_max = int(os.environ.get("DEADLOCK_MAX_SESSIONS", "100"))
        self.max_sessions = max(1, max_sessions if max_sessions is not None else env_max)
        self._sessions: Dict[str, SessionRecord] = {}

    @property
    def active_session_count(self) -> int:
        return len(self._sessions)

    def _get_record(self, session_id: str) -> SessionRecord:
        rec = self._sessions.get(session_id)
        if not rec:
            raise SessionNotFoundError(session_id)
        rec.last_accessed = time.monotonic()
        return rec

    def _evict_idle_session_if_needed(self) -> None:
        if len(self._sessions) < self.max_sessions:
            return
        idle_candidates = [
            (rec.last_accessed, sid)
            for sid, rec in self._sessions.items()
            if not rec.is_running and self.ws_hub.connection_count(sid) == 0 and not rec.lock.locked()
        ]
        if not idle_candidates:
            raise SessionLimitError(self.max_sessions)
        idle_candidates.sort(key=lambda item: item[0])
        _, victim_sid = idle_candidates[0]
        self._sessions.pop(victim_sid, None)
        logger.info("Evicted idle session %s (capacity=%d)", victim_sid, self.max_sessions)

    async def _broadcast_locked(self, rec: SessionRecord) -> None:
        await self.ws_hub.broadcast(rec.session_id, {
            "type": "STATE_SYNC",
            "session_id": rec.session_id,
            "state": rec.state,
            "runtime": {
                "is_running": rec.is_running,
                "speed": rec.speed,
                "seq": rec.seq,
            },
        })

    async def create_session(
        self,
        preset: Optional[str] = None,
        seed: int = 42,
        speed: float = 1.0,
    ) -> Dict[str, Any]:
        # Verify capacity (and evict an idle LRU session if possible) before spawning engine work
        self._evict_idle_session_if_needed()
        resp = await self.bridge.execute(
            "create_simulation",
            payload={"preset": preset, "seed": seed},
        )
        self._evict_idle_session_if_needed()
        sid = f"sim_{uuid.uuid4().hex[:8]}"
        rec = SessionRecord(session_id=sid, state=resp["state"], speed=speed, is_running=False, seq=1)
        _stamp_session_timestamps(rec, reset=True)
        self._sessions[sid] = rec
        return self._envelope(rec, resp.get("result"))

    async def get_state(self, session_id: str) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        async with rec.lock:
            return self._envelope(rec)

    async def execute_session_command(
        self,
        session_id: str,
        command: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        async with rec.lock:
            try:
                resp = await self.bridge.execute(command, state=rec.state, payload=payload or {})
            except EngineDomainError as exc:
                if exc.state is not None:
                    rec.state = exc.state
                    _stamp_session_timestamps(rec, reset=False)
                    rec.seq += 1
                    envelope = self._envelope(rec, exc.result)
                    await self._broadcast_locked(rec)
                    raise EngineDomainError(
                        exc.code,
                        exc.message,
                        state=rec.state,
                        result=envelope["result"],
                        details={"session_id": rec.session_id},
                    ) from exc
                raise
            if resp.get("state") is not None:
                rec.state = resp["state"]
                _stamp_session_timestamps(rec, reset=False)
                rec.seq += 1
            envelope = self._envelope(rec, resp.get("result"))
            await self._broadcast_locked(rec)
            return envelope

    async def _stop_runner_quietly(self, session_id: str) -> None:
        rec = self._get_record(session_id)
        task_to_cancel: Optional[asyncio.Task[None]] = None
        async with rec.lock:
            rec.is_running = False
            rec.wakeup_event.set()
            if rec.runner_task and not rec.runner_task.done():
                task_to_cancel = rec.runner_task
            rec.runner_task = None

        if task_to_cancel:
            task_to_cancel.cancel()
            try:
                await task_to_cancel
            except asyncio.CancelledError:
                pass

    async def reset_session(
        self,
        session_id: str,
        preset: Optional[str] = None,
        seed: Optional[int] = None,
    ) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        await self._stop_runner_quietly(session_id)
        async with rec.lock:
            use_preset = preset if preset is not None else rec.state.get("preset")
            use_seed = seed if seed is not None else rec.state.get("seed", 42)
            resp = await self.bridge.execute(
                "reset_simulation",
                payload={"preset": use_preset, "seed": use_seed},
            )
            rec.state = resp["state"]
            _stamp_session_timestamps(rec, reset=True)
            rec.seq += 1
            envelope = self._envelope(rec, resp.get("result"))
            await self._broadcast_locked(rec)
            return envelope

    async def load_random_workload(
        self,
        session_id: str,
        process_count: int,
        resource_count: int,
        seed: int,
    ) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        await self._stop_runner_quietly(session_id)
        async with rec.lock:
            resp = await self.bridge.execute(
                "generate_random_workload",
                payload={"process_count": process_count, "resource_count": resource_count, "seed": seed},
            )
            rec.state = resp["state"]
            _stamp_session_timestamps(rec, reset=True)
            rec.seq += 1
            envelope = self._envelope(rec, resp.get("result"))
            await self._broadcast_locked(rec)
            return envelope

    async def run_experiment(self, session_id: str, preset: str, seed: int) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        await self._stop_runner_quietly(session_id)
        async with rec.lock:
            resp = await self.bridge.execute(
                "load_preset",
                payload={"preset": preset, "seed": seed},
            )
            rec.state = resp["state"]
            _stamp_session_timestamps(rec, reset=True)
            rec.seq += 1
            envelope = self._envelope(rec, resp.get("result"))
            await self._broadcast_locked(rec)
            return envelope

    async def start_session(self, session_id: str, speed: Optional[float] = None) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        async with rec.lock:
            if speed is not None:
                rec.speed = speed
                rec.wakeup_event.set()
            if not rec.is_running:
                rec.is_running = True
                rec.wakeup_event.clear()
                rec.runner_task = asyncio.create_task(self._auto_tick_loop(session_id))
            rec.seq += 1
            envelope = self._envelope(rec, {"is_running": rec.is_running, "speed": rec.speed})
            await self._broadcast_locked(rec)
            return envelope

    async def pause_session(self, session_id: str) -> Dict[str, Any]:
        rec = self._get_record(session_id)
        task_to_cancel: Optional[asyncio.Task[None]] = None
        async with rec.lock:
            rec.is_running = False
            rec.wakeup_event.set()
            if rec.runner_task and not rec.runner_task.done():
                task_to_cancel = rec.runner_task
            rec.runner_task = None

        if task_to_cancel:
            task_to_cancel.cancel()
            try:
                await task_to_cancel
            except asyncio.CancelledError:
                pass

        async with rec.lock:
            rec.seq += 1
            envelope = self._envelope(rec, {"is_running": False, "speed": rec.speed})
            await self._broadcast_locked(rec)
            return envelope

    async def stop_session(self, session_id: str) -> Dict[str, Any]:
        return await self.pause_session(session_id)

    async def shutdown(self) -> None:
        for sid in list(self._sessions.keys()):
            try:
                await self.pause_session(sid)
            except Exception:
                pass

    async def _auto_tick_loop(self, session_id: str) -> None:
        try:
            while True:
                rec = self._sessions.get(session_id)
                if not rec:
                    break
                async with rec.lock:
                    if not rec.is_running:
                        break
                    interval = max(0.25, 1.0 / max(0.25, rec.speed))
                    rec.wakeup_event.clear()

                try:
                    await asyncio.wait_for(rec.wakeup_event.wait(), timeout=interval)
                    # Woken up by speed change or pause; re-evaluate loop state
                    continue
                except asyncio.TimeoutError:
                    pass

                rec = self._sessions.get(session_id)
                if not rec:
                    break

                try:
                    async with rec.lock:
                        if not rec.is_running:
                            break

                        if rec.state.get("safety_status") == "DEADLOCKED":
                            rec.is_running = False
                            rec.seq += 1
                            await self._broadcast_locked(rec)
                            break

                        active = [p for p in rec.state.get("processes", []) if p.get("state") != "TERMINATED"]
                        if not active:
                            rec.is_running = False
                            rec.seq += 1
                            await self._broadcast_locked(rec)
                            break

                        resp = await self.bridge.execute("step_simulation", state=rec.state, payload={})
                        if resp.get("state") is not None:
                            rec.state = resp["state"]
                            _stamp_session_timestamps(rec, reset=False)
                            rec.seq += 1
                        await self._broadcast_locked(rec)
                except EngineBridgeError as exc:
                    logger.warning("Auto-tick stopped for %s due to engine error: %s", session_id, exc)
                    async with rec.lock:
                        rec.is_running = False
                        rec.seq += 1
                    await self.ws_hub.broadcast(session_id, {
                        "type": "ERROR",
                        "session_id": session_id,
                        "error": {"code": exc.code, "message": exc.message},
                    })
                    break
        except asyncio.CancelledError:
            return

    @staticmethod
    def _envelope(rec: SessionRecord, result: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        merged_result = dict(result) if result else {}
        merged_result["runtime"] = {
            "is_running": rec.is_running,
            "speed": rec.speed,
            "seq": rec.seq,
        }
        return {
            "session_id": rec.session_id,
            "state": rec.state,
            "result": merged_result,
        }
