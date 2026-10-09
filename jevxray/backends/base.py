from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from ..cache import Cache
from ..question import Question


@dataclass
class Reading:
    """One answer from the model, reduced to what the probes need."""

    probs: dict[str, float]
    value: float
    seconds: float
    cached: bool = False


class Backend:
    """Anything that turns (state, question) into a probability per option.

    Subclasses implement `_probabilities`. Everything else (caching, timing, batching) lives here so
    the probes never care which model is behind them.
    """

    name = "base"
    model = "unknown"
    concurrency = 1

    def __init__(self, cache: Cache | None = None) -> None:
        self.cache = cache

    def _probabilities(self, state: str, question: Question) -> dict[str, float]:
        raise NotImplementedError

    def read(self, state: str, question: Question) -> Reading:
        key = None
        if self.cache is not None:
            key = self.cache.key(self.name, self.model, state, question.wire())
            hit = self.cache.get(key)
            if hit is not None:
                return Reading(hit, question.value(hit), 0.0, cached=True)
        started = time.perf_counter()
        probs = self._probabilities(state, question)
        seconds = time.perf_counter() - started
        if key is not None:
            self.cache.put(key, probs)
        return Reading(probs, question.value(probs), seconds)

    def read_many(self, states: list[str], question: Question):
        """Yield (index, Reading) as each finishes. Order follows completion, not input."""
        if self.concurrency <= 1:
            for i, state in enumerate(states):
                yield i, self.read(state, question)
            return
        with ThreadPoolExecutor(self.concurrency) as pool:
            futures = {pool.submit(self.read, s, question): i for i, s in enumerate(states)}
            for future in as_completed(futures):
                yield futures[future], future.result()

    def info(self) -> dict:
        return {"backend": self.name, "model": self.model}
