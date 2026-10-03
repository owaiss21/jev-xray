"""Counterfactual swaps.

Write the input once with a slot in it, e.g. "{name} has five years of experience...", give a few
groups of values for the slot, and measure the tracked probability for every value. If the groups
differ, the only thing that can explain it is the slot.
"""

from __future__ import annotations

import statistics
from typing import Iterator

from ..backends import Backend
from ..question import Question


def fill(template: str, slot: str, value: str) -> str:
    return template.replace("{" + slot + "}", value)


def swap(
    backend: Backend,
    template: str,
    slot: str,
    groups: dict[str, list[str]],
    question: Question,
) -> Iterator[dict]:
    if "{" + slot + "}" not in template:
        raise ValueError(f"the template has no {{{slot}}} placeholder")
    jobs = [(group, value) for group, values in groups.items() for value in values if value.strip()]
    yield {"event": "start", "total": len(jobs), "groups": list(groups)}
    states = [fill(template, slot, value) for _, value in jobs]
    results: dict[str, list[float]] = {g: [] for g in groups}
    seconds = 0.0
    for i, reading in backend.read_many(states, question):
        group, value = jobs[i]
        results[group].append(reading.value)
        seconds += reading.seconds
        yield {"event": "value", "group": group, "value": value, "p": reading.value}
    yield {"event": "done", "summary": summarize(results), "calls": len(jobs), "seconds": seconds}


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
