"""Split text into removable pieces while remembering where each piece sits in the original."""

from __future__ import annotations

import re
from dataclasses import dataclass

WORD = re.compile(r"\S+")
# A sentence ends at . ! ? (optionally followed by quotes/brackets) and whitespace, or at a blank line.
SENTENCE = re.compile(r"[^.!?\n]+(?:[.!?]+[\"')\]]*|$)|[^\n]+", re.M)
# A phrase also ends at a comma, semicolon or colon: small enough to point at, big enough to mean something.
PHRASE = re.compile(r"[^.!?,;:\n]+(?:[.!?,;:]+[\"')\]]*|$)|[^\n]+", re.M)


@dataclass(frozen=True)
class Segment:
    index: int
    start: int
    end: int
    text: str


def segments(text: str, granularity: str = "word") -> list[Segment]:
    if granularity == "word":
        matches = WORD.finditer(text)
    elif granularity in ("sentence", "phrase"):
        pattern = SENTENCE if granularity == "sentence" else PHRASE
        matches = (m for m in pattern.finditer(text) if m.group().strip())
    else:
        raise ValueError("granularity must be 'word', 'phrase' or 'sentence'")
    out = []
    for m in matches:
        raw = m.group()
        lead = len(raw) - len(raw.lstrip())
        piece = raw.strip()
        start = m.start() + lead
        out.append(Segment(len(out), start, start + len(piece), piece))
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
