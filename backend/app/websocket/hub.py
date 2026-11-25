from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Dict, Set
from fastapi import WebSocket

logger = logging.getLogger("deadlock_city.ws")


class WebSocketHub:
    """Manages active WebSocket clients per simulation session."""

    def __init__(self) -> None:
        self._connections: Dict[str, Set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        conns = self._connections.get(session_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            self._connections.pop(session_id, None)

    def connection_count(self, session_id: str) -> int:
        return len(self._connections.get(session_id, set()))

    async def broadcast(self, session_id: str, message: Dict[str, Any]) -> None:
        conns = list(self._connections.get(session_id, set()))
        if not conns:
            return
        stale: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception as exc:
                logger.debug("Pruning disconnected websocket for session %s: %s", session_id, exc)
                stale.append(ws)
        for ws in stale:
            self.disconnect(session_id, ws)
