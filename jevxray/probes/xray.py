"""Leave-one-out attribution.

Remove one piece of the input, ask the same question again, and see how far the tracked
probability moves. A piece whose removal drops the probability was holding the decision up.
"""

from __future__ import annotations

from typing import Iterator

from ..backends import Backend
from ..question import Question
from ..text import segments, without


def xray(
    backend: Backend, state: str, question: Question, granularity: str = "word"
) -> Iterator[dict]:
    """Yield events: one `base`, one `segment` per piece (as soon as it is measured), one `done`."""
    parts = segments(state, granularity)
    base = backend.read(state, question)
    yield {
        "event": "base",
        "value": base.value,
        "probs": base.probs,
        "seconds": base.seconds,
        "segments": [{"i": p.index, "start": p.start, "end": p.end, "text": p.text} for p in parts],
    }
    variants = [without(state, parts, {p.index}) for p in parts]
    total_seconds = base.seconds
    for i, reading in backend.read_many(variants, question):
        total_seconds += reading.seconds
        yield {
            "event": "segment",
            "i": i,
            "value": reading.value,
            # positive: this piece pushed the answer towards the target
            "effect": base.value - reading.value,
            "seconds": reading.seconds,
        }
    yield {"event": "done", "calls": len(parts) + 1, "seconds": total_seconds}


def collect(events: Iterator[dict]) -> dict:
    """Run a probe to completion and return its events gathered into one dict."""
    out: dict = {"segments_measured": []}
    for event in events:
        kind = event["event"]
        if kind == "segment":
            out["segments_measured"].append(event)
        else:
            out[kind] = event
    out["segments_measured"].sort(key=lambda e: e["i"])
    return out
