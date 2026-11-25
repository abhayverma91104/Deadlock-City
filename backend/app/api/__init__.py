from .health import router as health_router
from .labs import router as labs_router
from .simulation import router as simulation_router

__all__ = ["health_router", "labs_router", "simulation_router"]
