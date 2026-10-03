"""Find a small set of deletions that changes the model's answer.

1. Measure every piece on its own (the same leave-one-out pass as the X-ray).
2. Remove the pieces that were holding the current answer up, strongest first, until a different
   option comes out on top.
3. Put pieces back one at a time; keep any that aren't needed for the change.

The result is locally minimal: no single removed piece can be restored without undoing the flip.
It is not guaranteed to be the global minimum, which would need far more calls.
"""

from __future__ import annotations

from typing import Iterator

from ..backends import Backend
from ..question import Question
from ..text import segments, without


def top(probs: dict[str, float]) -> str:
    return max(probs, key=probs.get)


def flip(
    backend: Backend,
    state: str,
    question: Question,
    granularity: str = "word",
    max_removed: int = 30,
) -> Iterator[dict]:
    parts = segments(state, granularity)
    base = backend.read(state, question)
    winner = top(base.probs)
    yield {
        "event": "base",
        "probs": base.probs,
        "answer": winner,
        "segments": [{"i": p.index, "start": p.start, "end": p.end, "text": p.text} for p in parts],
    }

    calls = 1
    effects: dict[int, float] = {}
    variants = [without(state, parts, {p.index}) for p in parts]
    for i, reading in backend.read_many(variants, question):
        calls += 1
        effects[i] = base.probs[winner] - reading.probs[winner]
        yield {"event": "scan", "i": i, "effect": effects[i]}

    # Pieces whose removal weakens the current answer, strongest first.
    ranked = sorted((i for i in effects if effects[i] > 0), key=lambda i: -effects[i])[:max_removed]

    removed: list[int] = []
    probs = base.probs
    for i in ranked:
        removed.append(i)
        probs = backend.read(without(state, parts, set(removed)), question).probs
        calls += 1
        yield {"event": "remove", "removed": list(removed), "probs": probs, "answer": top(probs)}
        if top(probs) != winner:
            break

    if top(probs) == winner:
        yield {"event": "done", "flipped": False, "removed": removed, "probs": probs,
               "answer": winner, "calls": calls}
        return

    for i in reversed(list(removed)):
        trial = [j for j in removed if j != i]
        trial_probs = backend.read(without(state, parts, set(trial)), question).probs
        calls += 1
        if top(trial_probs) != winner:
            removed, probs = trial, trial_probs
            yield {"event": "restore", "i": i, "removed": list(removed), "probs": probs, "answer": top(probs)}

    yield {
        "event": "done",
        "flipped": True,
        "removed": sorted(removed),
        "probs": probs,
        "from": winner,
        "answer": top(probs),
        "text": without(state, parts, set(removed)),
        "calls": calls,
    }
