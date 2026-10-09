"""Split text into removable pieces while remembering where each piece sits in the original."""

from __future__ import annotations

import re
from dataclasses import dataclass

WORD = re.compile(r"\S+")
# Punctuation only ends a piece when whitespace (or the end) follows, so "2:14", "1,000" and
# "No.17" stay whole.
_CLOSE = r"[\"')\]]*"
SENTENCE = re.compile(r"(?:[^\n.!?]|[.!?](?=\S))+(?:[.!?]+" + _CLOSE + r"(?=\s|$))?")
# A phrase also ends at a comma, semicolon or colon: small enough to point at, big enough to mean something.
PHRASE = re.compile(r"(?:[^\n.!?,;:]|[.!?,;:](?=\S))+(?:[.!?,;:]+" + _CLOSE + r"(?=\s|$))?")


@dataclass(frozen=True)
class Segment:
    index: int
    start: int
    end: int
    text: str

    def as_dict(self) -> dict:
        return {"i": self.index, "start": self.start, "end": self.end, "text": self.text}


def segments(text: str, granularity: str = "word") -> list[Segment]:
    if granularity == "word":
        matches = WORD.finditer(text)
    elif granularity in ("sentence", "phrase"):
        pattern = SENTENCE if granularity == "sentence" else PHRASE
        matches = (m for m in pattern.finditer(text) if m.group().strip())
    else:
        raise ValueError("granularity must be 'word', 'phrase' or 'sentence'")
    spans = []
    for m in matches:
        raw = m.group()
        lead = len(raw) - len(raw.lstrip())
        start = m.start() + lead
        spans.append((start, start + len(raw.strip())))
    if granularity == "phrase":
        spans = _attach_labels(text, spans)
    return [Segment(i, s, e, text[s:e]) for i, (s, e) in enumerate(spans)]


def _attach_labels(text: str, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Glue a short label like "Customer address:" to what follows it on the same line.

    On its own a label carries no meaning, so removing it only measures how confused the model
    gets by a dangling value.
    """
    out: list[tuple[int, int]] = []
    pending = None
    for s, e in spans:
        if pending is not None:
            if "\n" not in text[pending[1] : s]:
                s = pending[0]
            else:
                out.append(pending)
            pending = None
        piece = text[s:e]
        if piece.endswith(":") and len(piece.split()) <= 3:
            pending = (s, e)
        else:
            out.append((s, e))
    if pending is not None:
        out.append(pending)
    return out


def without(text: str, parts: list[Segment], drop: set[int]) -> str:
    """The text with the given segments cut out, whitespace tidied so the model sees clean input."""
    pieces, cursor = [], 0
    for seg in parts:
        if seg.index in drop:
            pieces.append(text[cursor:seg.start])
            cursor = seg.end
    pieces.append(text[cursor:])
    joined = "".join(pieces)
    joined = re.sub(r"[ \t]{2,}", " ", joined)
    joined = re.sub(r" +([,.;:!?])", r"\1", joined)
    joined = re.sub(r"\n[ \t]+", "\n", joined)
    return joined.strip()
