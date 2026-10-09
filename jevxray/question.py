"""Typed questions and the single number we watch while poking at the input."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


KINDS = ("noul", "choice", "score")


@dataclass(frozen=True)
class Question:
    """A Jev-style question.

    kind:         "noul" (yes/no), "choice" (pick one) or "score" (ordered levels)
    instructions: what we are asking, in plain words
    criteria:     choice -> {option_id: description}; score -> [level descriptions, lowest first];
                  noul -> optional {"true": ..., "false": ...}
    target:       which option's probability we track. For noul it defaults to "true", for choice
                  to the first option. Score questions track the expected level scaled to 0..1.
    """

    kind: str
    instructions: str
    criteria: Any = None
    target: str | None = None

    def __post_init__(self) -> None:
        if self.kind not in KINDS:
            raise ValueError(f"unknown question type {self.kind!r}, expected one of {KINDS}")
        if not str(self.instructions or "").strip():
            raise ValueError("Write the question you want to ask.")
        if self.kind == "choice" and (not self.criteria or len(self.criteria) < 2):
            raise ValueError("Add at least two options to pick from.")
        if self.kind == "score" and (not isinstance(self.criteria, list) or len(self.criteria) < 2):
            raise ValueError("A rating scale needs at least two levels.")
        if self.kind == "choice" and self.target is not None and self.target not in self.option_ids:
            raise ValueError(f"“{self.target}” isn't one of the options.")

    @property
    def option_ids(self) -> list[str]:
        if self.kind == "noul":
            return ["true", "false"]
        if self.kind == "choice":
            crit = self.criteria
            return list(crit) if isinstance(crit, (list, dict)) else []
        return [str(i) for i in range(len(self.criteria))]

    @property
    def target_id(self) -> str:
        if self.kind == "noul":
            return self.target or "true"
        if self.kind == "choice":
            return self.target or self.option_ids[0]
        return "expected"

    def value(self, probs: dict[str, float]) -> float:
        """The tracked number, always in 0..1."""
        if self.kind == "score":
            top = len(self.criteria) - 1
            return sum(int(k) * p for k, p in probs.items()) / top
        return float(probs.get(self.target_id, 0.0))

    def wire(self) -> dict:
        """The question in the /v1/systemone request shape."""
        out: dict[str, Any] = {"type": self.kind, "instructions": self.instructions}
        if self.criteria is not None:
            out["criteria"] = self.criteria
        return out

    @classmethod
    def from_dict(cls, data: dict) -> "Question":
        return cls(
            kind=data.get("type") or data.get("kind"),
            instructions=data["instructions"],
            criteria=data.get("criteria"),
            target=data.get("target"),
        )
