"""HTTP API and static UI.

Long-running probes stream newline-delimited JSON, so the page can paint each word the moment
its measurement comes back instead of waiting a minute for the whole thing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterator

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .backends import Backend, make_backend
from .probes import flip, swap, xray
from .question import Question

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EXAMPLES = ROOT / "examples"


class QuestionIn(BaseModel):
    type: str
    instructions: str
    criteria: dict | list | None = None
    target: str | None = None

    def build(self) -> Question:
        try:
            return Question.from_dict(self.model_dump())
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc


class DecideIn(BaseModel):
    state: str
    question: QuestionIn


class XrayIn(DecideIn):
    granularity: str = Field("word", pattern="^(word|phrase|sentence)$")


class FlipIn(XrayIn):
    threshold: float = 0.5
    max_removed: int = Field(30, ge=1, le=200)


class SwapIn(BaseModel):
    template: str
    slot: str = "name"
    groups: dict[str, list[str]]
    question: QuestionIn


def stream(events: Iterator[dict]) -> StreamingResponse:
    def lines():
        try:
            for event in events:
                yield json.dumps(event) + "\n"
        except Exception as exc:  # surface model errors to the page instead of a dead socket
            yield json.dumps({"event": "error", "message": str(exc)}) + "\n"

    return StreamingResponse(lines(), media_type="application/x-ndjson")


def create_app(backend: Backend | None = None) -> FastAPI:
    app = FastAPI(title="jev-xray")
    model = backend or make_backend()

    @app.get("/api/health")
    def health():
        return model.info()

    @app.get("/api/examples")
    def examples():
        items = []
        for path in sorted(EXAMPLES.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            data["id"] = path.stem
            items.append(data)
        return sorted(items, key=lambda e: (e.get("order", 99), e["id"]))

    @app.post("/api/decide")
    def decide(body: DecideIn):
        question = body.question.build()
        reading = model.read(body.state, question)
        return {
            "probs": reading.probs,
            "value": reading.value,
            "seconds": reading.seconds,
            "cached": reading.cached,
        }

    @app.post("/api/xray")
    def run_xray(body: XrayIn):
        return stream(xray(model, body.state, body.question.build(), body.granularity))

    @app.post("/api/flip")
    def run_flip(body: FlipIn):
        q = body.question.build()
        return stream(flip(model, body.state, q, body.granularity, body.threshold, body.max_removed))

    @app.post("/api/swap")
    def run_swap(body: SwapIn):
        q = body.question.build()
        try:
            events = swap(model, body.template, body.slot, body.groups, q)
            first = next(events)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

        def chained():
            yield first
            yield from events

        return stream(chained())

    @app.exception_handler(ConnectionError)
    def backend_down(_request, exc):
        return JSONResponse({"detail": f"model backend unreachable: {exc}"}, status_code=503)

    @app.get("/")
    def index():
        return FileResponse(WEB / "index.html")

    app.mount("/", StaticFiles(directory=WEB), name="web")
    return app
