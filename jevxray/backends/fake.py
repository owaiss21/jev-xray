"""A deterministic stand-in model.

It is not smart. It scores each option by how many words of the state overlap with the option's
own wording, plus a stable per-word nudge, and softmaxes the result. That is enough to exercise every
probe, run the test suite and click around the UI without downloading anything.
"""

from __future__ import annotations

import hashlib
import math
import re

from ..question import Question
from .base import Backend

WORD = re.compile(r"[a-z0-9']+")
STOP = set("a an the and or of to in on for is are was were be it this that with as at by from".split())


def _words(text: str) -> list[str]:
    return [w for w in WORD.findall(text.lower()) if w not in STOP]


def _nudge(word: str, option: str) -> float:
    digest = hashlib.blake2b(f"{word}|{option}".encode(), digest_size=2).digest()
    return (int.from_bytes(digest, "big") / 65535 - 0.5) * 0.6


class FakeBackend(Backend):
    name = "fake"
    model = "keyword-overlap"

    def _probabilities(self, state: str, question: Question) -> dict[str, float]:
        words = _words(state)
        options = question.option_ids
        descriptions = self._descriptions(question)
        logits = []
        for option in options:
            vocab = set(_words(descriptions.get(option, option))) | {option.lower()}
            overlap = sum(1.0 for w in words if w in vocab)
            logits.append(1.5 * overlap + sum(_nudge(w, option) for w in words))
        top = max(logits)
        weights = [math.exp(z - top) for z in logits]
        total = sum(weights)
        return {o: w / total for o, w in zip(options, weights)}

    @staticmethod
    def _descriptions(question: Question) -> dict[str, str]:
        crit = question.criteria
        if question.kind == "noul":
            crit = crit or {}
            return {"true": crit.get("true", question.instructions), "false": crit.get("false", "")}
        if question.kind == "score":
            return {str(i): level for i, level in enumerate(crit)}
        if isinstance(crit, dict):
            return {k: (v or k) for k, v in crit.items()}
        return {k: k for k in crit}
