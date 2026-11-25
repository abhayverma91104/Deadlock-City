from __future__ import annotations

from fastapi import APIRouter, Depends

from app.dependencies import get_bridge, get_session_manager
from app.engine.bridge import EngineBridge, EngineBridgeError
from app.schemas import HealthResponse
from app.services.session_manager import SessionManager

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check(
    bridge: EngineBridge = Depends(get_bridge),
    sessions: SessionManager = Depends(get_session_manager),
) -> HealthResponse:
    try:
        info = await bridge.health()
        return HealthResponse(
            status="ok",
            engine_available=bool(info.get("ok")),
            engine_version=info.get("engine_version"),
            active_sessions=sessions.active_session_count,
        )
    except EngineBridgeError:
        return HealthResponse(
            status="degraded",
            engine_available=False,
            engine_version=None,
            active_sessions=sessions.active_session_count,
        )
