from __future__ import annotations

from fastapi import Request

from app.engine.bridge import EngineBridge
from app.services.session_manager import SessionManager
from app.websocket.hub import WebSocketHub


def get_bridge(request: Request) -> EngineBridge:
    return request.app.state.bridge


def get_session_manager(request: Request) -> SessionManager:
    return request.app.state.session_manager


def get_ws_hub(request: Request) -> WebSocketHub:
    return request.app.state.ws_hub
