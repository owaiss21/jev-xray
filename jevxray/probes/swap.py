"""Counterfactual swaps.

Take a piece of text, pick something in it (a name, a university, a city), and give a few groups
of things to put there instead. Every version is asked the same question. If the groups land in
different places, the swapped words are the only thing that can explain it.
"""

from __future__ import annotations

import re
import statistics
from typing import Iterator

from ..backends import Backend
from ..question import Question


def find(text: str, original: str) -> list[re.Match]:
    """Occurrences of `original`, ignoring case and runs of whitespace."""
    words = original.split()
    if not words:
        return []
    pattern = r"\s+".join(re.escape(w) for w in words)
    return list(re.finditer(pattern, text, flags=re.IGNORECASE))


def replace(text: str, original: str, value: str) -> str:
    out, cursor = [], 0
    for m in find(text, original):
        out.append(text[cursor : m.start()])
        out.append(value)
        cursor = m.end()
    out.append(text[cursor:])
    return "".join(out)


def swap(
    backend: Backend,
    text: str,
    original: str,
    groups: dict[str, list[str]],
    question: Question,
) -> Iterator[dict]:
    original = original.strip()
    if not original:
        raise ValueError("Type the words you want to swap out.")
    hits = find(text, original)
    if not hits:
        raise ValueError(f"Couldn't find “{original}” in the text. Copy it exactly as it appears.")
    jobs = [(group, value.strip()) for group, values in groups.items() for value in values if value.strip()]
    if not jobs:
        raise ValueError("Add at least one value to swap in.")

    base = backend.read(text, question)
    yield {
        "event": "start",
        "total": len(jobs),
        "groups": list(groups),
        "occurrences": len(hits),
        "original": {"value": original, "p": base.value, "probs": base.probs},
    }
    states = [replace(text, original, value) for _, value in jobs]
    results: dict[str, list[float]] = {g: [] for g in groups}
    seconds = base.seconds
    for i, reading in backend.read_many(states, question):
        group, value = jobs[i]
        results[group].append(reading.value)
        seconds += reading.seconds
        yield {"event": "value", "group": group, "value": value, "p": reading.value}
    yield {"event": "done", "summary": summarize(results), "calls": len(jobs) + 1, "seconds": seconds}


def summarize(results: dict[str, list[float]]) -> dict:
    summary = {}
    for group, values in results.items():
        if not values:
            continue
        summary[group] = {
            "n": len(values),
            "mean": statistics.fmean(values),
            "min": min(values),
            "max": max(values),
            "stdev": statistics.stdev(values) if len(values) > 1 else 0.0,
        }
    means = [s["mean"] for s in summary.values()]
    if len(means) >= 2:
        summary["_gap"] = max(means) - min(means)
    return summary
