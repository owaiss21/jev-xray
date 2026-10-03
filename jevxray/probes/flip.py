"""Find a small set of deletions that flips the decision.

1. Measure every piece on its own (the same leave-one-out pass as the X-ray).
2. Remove the pieces that were holding the answer up, strongest first, until the tracked
   probability crosses the threshold.
3. Put pieces back one at a time; keep any that aren't needed for the flip.

The result is locally minimal: no single removed piece can be restored without undoing the flip.
It is not guaranteed to be the global minimum, which would need far more calls.
"""

from __future__ import annotations

from typing import Iterator

from ..backends import Backend
from ..question import Question
from ..text import segments, without


def flip(
    backend: Backend,
    state: str,
    question: Question,
    granularity: str = "word",
    threshold: float = 0.5,
    max_removed: int = 30,
) -> Iterator[dict]:
    parts = segments(state, granularity)
    base = backend.read(state, question)
    above = base.value >= threshold
    yield {
        "event": "base",
        "value": base.value,
        "probs": base.probs,
        "threshold": threshold,
        "direction": "down" if above else "up",
        "segments": [{"i": p.index, "start": p.start, "end": p.end, "text": p.text} for p in parts],
    }

    calls = 1
    effects: dict[int, float] = {}
    variants = [without(state, parts, {p.index}) for p in parts]
    for i, reading in backend.read_many(variants, question):
        calls += 1
        effects[i] = base.value - reading.value
        yield {"event": "scan", "i": i, "effect": effects[i]}

    def crossed(value: float) -> bool:
        return value < threshold if above else value >= threshold

    # A piece helps the flip if removing it moves the value towards the other side.
    sign = 1 if above else -1
    ranked = sorted((i for i in effects if sign * effects[i] > 0), key=lambda i: -sign * effects[i])
    ranked = ranked[:max_removed]

    removed: list[int] = []
    value = base.value
    for i in ranked:
        removed.append(i)
        value = backend.read(without(state, parts, set(removed)), question).value
        calls += 1
        yield {"event": "remove", "removed": list(removed), "value": value}
        if crossed(value):
            break

    if not crossed(value):
        yield {
            "event": "done",
            "flipped": False,
            "removed": removed,
            "value": value,
            "text": without(state, parts, set(removed)),
            "calls": calls,
        }
        return

    for i in reversed(list(removed)):
        trial = [j for j in removed if j != i]
        trial_value = backend.read(without(state, parts, set(trial)), question).value
        calls += 1
        if crossed(trial_value):
            removed, value = trial, trial_value
            yield {"event": "restore", "i": i, "removed": list(removed), "value": value}

    yield {
        "event": "done",
        "flipped": True,
        "removed": sorted(removed),
        "value": value,
        "text": without(state, parts, set(removed)),
        "calls": calls,
    }
