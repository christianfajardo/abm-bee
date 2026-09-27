"""FastAPI backend for the bee-colony ABM.

A single BeeColonyModel instance lives in process memory. The UI polls
GET /api/state; while the model is "running" the server advances the
simulation by `speed` step(s) per poll, so the browser drives the clock.
"""

import os
import threading
from typing import Optional

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from bee_colony import BeeColonyModel, rules_as_dicts

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")

app = FastAPI(title="Bee Colony: An ABM Classic Use Case")

# ---------------------------------------------------------------------------
# The one-and-only model (created lazily on first use so a long-running
# process keeps a single stable colony).
# ---------------------------------------------------------------------------
_model: Optional[BeeColonyModel] = None
_lock = threading.Lock()


def get_model() -> BeeColonyModel:
    global _model
    if _model is None:
        _model = BeeColonyModel(width=40, height=40, nectar_patches=150,
                                max_bees=300, seed=42)
        _model.running = True
    return _model


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class StepBody(BaseModel):
    n: int = 1
    speed: int = 1


class ParamsBody(BaseModel):
    n_bees: Optional[int] = None
    temperature: Optional[float] = None
    day_night: Optional[bool] = None
    wasp_count: Optional[int] = None
    nectar_regrowth: Optional[float] = None
    sense_radius: Optional[int] = None
    max_bees: Optional[int] = None
    larvae_days: Optional[int] = None


class FlagBody(BaseModel):
    running: bool


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/state")
def state(step: bool = True, speed: int = 1):
    """Return a snapshot; advance the sim by `speed` while running."""
    m = get_model()
    with _lock:
        if step and m.running:
            for _ in range(max(1, min(speed, 8))):
                m.step()
        snap = m.snapshot(with_positions=True)
    return snap


@app.post("/api/step")
def step(body: StepBody):
    m = get_model()
    with _lock:
        for _ in range(max(1, min(body.n, 50))):
            m.step()
        # compact ack only - the UI gets the real view from its next poll
        return {"step": m.day_step, "population": len(m.bees)}


@app.post("/api/running")
def set_running(body: FlagBody):
    m = get_model()
    with _lock:
        m.running = body.running
    return {"running": m.running}


@app.post("/api/set_params")
def set_params(body: ParamsBody):
    m = get_model()
    with _lock:
        updates = body.dict(exclude_none=True)
        m.set_params(updates)
        # compact ack only - the UI gets the real view from its next poll
        return {"params": m.get_params(), "step": m.day_step,
                "population": len(m.bees)}


@app.post("/api/reset")
def reset():
    m = get_model()
    with _lock:
        m.reset()
        return {"step": 0, "population": len(m.bees)}


@app.post("/api/spawn_wasp")
def spawn_wasp():
    m = get_model()
    with _lock:
        m.p["wasp_count"] = min(12, m.p["wasp_count"] + 1)
        m._spawn_wasp()
        return {"wasp_count": m.p["wasp_count"], "step": m.day_step}


@app.post("/api/injure")
def injure():
    """Manually knock a random healthy bee below the injury threshold
    (watch rule 1 - a neighbour will stop and help it)."""
    m = get_model()
    with _lock:
        candidates = [b for b in m.bees if b.health > 0.9]
        hit = False
        if candidates:
            b = m.random.choice(candidates)
            b.health = 0.5
            b.energy = 0.4
            hit = True
        return {"injured": hit, "step": m.day_step}


@app.get("/api/rules")
def rules():
    return rules_as_dicts()


# ---------------------------------------------------------------------------
# Static UI (Vite/React build output)
# ---------------------------------------------------------------------------
DIST_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)


@app.middleware("http")
async def cache_headers(request, call_next):
    """The SPA shell must never be served stale; hashed build assets
    (immutable content-hashes) may cache for a year."""
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/assets/"):
        response.headers.setdefault(
            "Cache-Control", "public, max-age=31536000, immutable"
        )
    elif path in ("/", "/index.html"):
        # no-store (not just no-cache): never keep a copy of the SPA shell,
        # so a refresh can never re-serve a stale bundle list.
        response.headers.setdefault("Cache-Control", "no-store, max-age=0")
    return response


# Mounted LAST: /api/* routes (registered above) take precedence.
if os.path.isdir(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")
else:  # dev fallback: serve the raw Vite source page hint
    @app.get("/", response_class=HTMLResponse)
    def index():
        return (
            "<h1>Bee Colony</h1><p>Frontend not built yet. Run "
            "<code>cd frontend && npm install && npm run build</code>, "
            "then restart the server.</p>"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8550)