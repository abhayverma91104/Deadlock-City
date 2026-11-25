# Stage 1: Build authoritative C++17 simulation engine binary
FROM debian:bookworm-slim AS engine-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    g++ \
    cmake \
    ninja-build \
    git \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src/engine
COPY engine/CMakeLists.txt ./CMakeLists.txt
COPY engine/include ./include
COPY engine/src ./src
COPY engine/tests ./tests

RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  && cmake --build build --target deadlock_engine deadlock_tests -j4 \
  && ./build/deadlock_tests

# Stage 2: Minimal Python FastAPI runtime container
FROM python:3.12-slim AS runtime

RUN groupadd --system appgroup && useradd --system --gid appgroup --home-dir /app appuser

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN python -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r ./backend/requirements.txt

COPY --from=engine-builder /src/engine/build/deadlock_engine /app/bin/deadlock_engine
COPY backend/app ./backend/app
COPY docs/schemas ./docs/schemas

RUN chmod 755 /app/bin/deadlock_engine && chown -R appuser:appgroup /app /opt/venv

ENV PATH="/opt/venv/bin:${PATH}" \
    PYTHONPATH="/app/backend" \
    DEADLOCK_ENGINE_PATH="/app/bin/deadlock_engine" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEADLOCK_MAX_SESSIONS=100 \
    DEADLOCK_MAX_ENGINE_CONCURRENCY=8 \
    MAX_REQUEST_BODY_BYTES=1048576

USER appuser
WORKDIR /app/backend

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
