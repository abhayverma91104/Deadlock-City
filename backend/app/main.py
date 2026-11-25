from __future__ import annotations

import json
import logging
import os
import re
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import health_router, labs_router, simulation_router
from app.engine.bridge import EngineBridge, EngineBridgeError
from app.services.session_manager import SessionLimitError, SessionManager, SessionNotFoundError
from app.websocket.hub import WebSocketHub

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
LOCAL_ORIGIN_REGEX = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$")


def _load_allowed_origins() -> list[str]:
    extra = os.environ.get("ALLOWED_ORIGINS", "")
    extras = [o.strip().rstrip("/") for o in extra.split(",") if o.strip()]
    seen: list[str] = []
    for origin in [*DEFAULT_ALLOWED_ORIGINS, *extras]:
        if origin not in seen:
            seen.append(origin)
    return seen


def _is_origin_allowed(origin: Optional[str], allowed_origins: list[str]) -> bool:
    if not origin:
        return True
    normalized = origin.strip().rstrip("/")
    return normalized in allowed_origins or bool(LOCAL_ORIGIN_REGEX.match(normalized))


class RequestBodySizeLimitMiddleware:
    """Rejects oversized HTTP request bodies with HTTP 413 cleanly."""

    def __init__(self, app, max_bytes: int) -> None:  # type: ignore[no-untyped-def]
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:  # type: ignore[no-untyped-def]
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        cl_raw = headers.get("content-length")
        if cl_raw is not None:
            try:
                if int(cl_raw) > self.max_bytes:
                    resp = JSONResponse(
                        status_code=413,
                        content={
                            "error": {
                                "code": "PAYLOAD_TOO_LARGE",
                                "message": f"Request body exceeds maximum allowed size ({self.max_bytes} bytes).",
                                "details": {"max_bytes": self.max_bytes},
                            }
                        },
                    )
                    await resp(scope, receive, send)
                    return
            except ValueError:
                pass

        received = 0

        async def limited_receive():  # type: ignore[no-untyped-def]
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _PayloadTooLargeError(self.max_bytes)
            return message

        try:
            await self.app(scope, limited_receive, send)
        except _PayloadTooLargeError as exc:
            resp = JSONResponse(
                status_code=413,
                content={
                    "error": {
                        "code": "PAYLOAD_TOO_LARGE",
                        "message": f"Request body exceeds maximum allowed size ({exc.max_bytes} bytes).",
                        "details": {"max_bytes": exc.max_bytes},
                    }
                },
            )
            await resp(scope, receive, send)


class _PayloadTooLargeError(Exception):
    def __init__(self, max_bytes: int) -> None:
        self.max_bytes = max_bytes


def create_app(bridge: Optional[EngineBridge] = None) -> FastAPI:
    engine_bridge = bridge or EngineBridge()
    ws_hub = WebSocketHub()
    session_manager = SessionManager(engine_bridge, ws_hub)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.bridge = engine_bridge
        app.state.ws_hub = ws_hub
        app.state.session_manager = session_manager
        try:
            yield
        finally:
            await session_manager.shutdown()

    app = FastAPI(
        title="Deadlock City Orchestration API",
        version="1.0.0",
        description="FastAPI orchestration layer over the C++17 Deadlock City simulation engine.",
        lifespan=lifespan,
    )

    allowed_origins = _load_allowed_origins()
    max_body_bytes = max(1024, int(os.environ.get("MAX_REQUEST_BODY_BYTES", str(1024 * 1024))))

    app.add_middleware(RequestBodySizeLimitMiddleware, max_bytes=max_body_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Ensure app.state is populated even when TestClient calls without lifespan or before lifespan
    app.state.bridge = engine_bridge
    app.state.ws_hub = ws_hub
    app.state.session_manager = session_manager

    @app.exception_handler(SessionNotFoundError)
    async def session_not_found_handler(_request: Request, exc: SessionNotFoundError) -> JSONResponse:
        return JSONResponse(
            status_code=404,
            content={"error": {"code": "SESSION_NOT_FOUND", "message": str(exc), "details": {"session_id": exc.session_id}}},
        )

    @app.exception_handler(SessionLimitError)
    async def session_limit_handler(_request: Request, exc: SessionLimitError) -> JSONResponse:
        return JSONResponse(
            status_code=503,
            content={"error": {"code": "SESSION_LIMIT_REACHED", "message": str(exc), "details": {"max_sessions": exc.max_sessions}}},
        )

    @app.exception_handler(EngineBridgeError)
    async def engine_bridge_error_handler(_request: Request, exc: EngineBridgeError) -> JSONResponse:
        from app.engine.bridge import EngineDomainError

        body: dict = {"error": {"code": exc.code, "message": exc.message, "details": exc.details}}
        if isinstance(exc, EngineDomainError):
            if exc.state is not None:
                body["state"] = exc.state
            if exc.result is not None:
                body["result"] = exc.result
                if isinstance(exc.details, dict) and "session_id" in exc.details:
                    body["session_id"] = exc.details["session_id"]
        return JSONResponse(status_code=exc.status_code, content=body)

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={"error": {"code": "VALIDATION_ERROR", "message": "Invalid request payload.", "details": {"errors": exc.errors()}}},
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": {"code": f"HTTP_{exc.status_code}", "message": str(exc.detail), "details": {}}},
        )

    app.include_router(health_router)
    app.include_router(simulation_router)
    app.include_router(labs_router)

    @app.websocket("/ws/simulation/{session_id}")
    async def simulation_websocket(websocket: WebSocket, session_id: str) -> None:
        origin = websocket.headers.get("origin")
        if not _is_origin_allowed(origin, allowed_origins):
            await websocket.close(code=1008)
            return

        await ws_hub.connect(session_id, websocket)
        try:
            env = await session_manager.get_state(session_id)
            runtime_meta = (env.get("result") or {}).get("runtime", {"is_running": False, "speed": 1.0})
            await websocket.send_json({
                "type": "STATE_SYNC",
                "session_id": session_id,
                "state": env["state"],
                "runtime": runtime_meta,
            })
        except SessionNotFoundError as exc:
            await websocket.send_json({
                "type": "ERROR",
                "session_id": session_id,
                "error": {"code": "SESSION_NOT_FOUND", "message": str(exc)},
            })
            ws_hub.disconnect(session_id, websocket)
            await websocket.close(code=4404)
            return

        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    msg = json.loads(raw)
                    if isinstance(msg, dict) and msg.get("type") == "PING":
                        await websocket.send_json({"type": "PONG"})
                except json.JSONDecodeError:
                    await websocket.send_json({
                        "type": "ERROR",
                        "error": {"code": "INVALID_WS_MESSAGE", "message": "Expected JSON message."},
                    })
        except WebSocketDisconnect:
            ws_hub.disconnect(session_id, websocket)

    return app


app = create_app()
