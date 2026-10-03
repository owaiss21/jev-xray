import pytest

from jevxray.backends.fake import FakeBackend
from jevxray.probes import collect, flip, swap, xray
from jevxray.question import Question
from jevxray.text import segments, without

SPAM = Question("noul", "Is this a scam asking for money or bank details?")


def test_segments_keep_offsets():
    text = "Send   the money now. Or else!"
    parts = segments(text, "word")
    assert [p.text for p in parts] == ["Send", "the", "money", "now.", "Or", "else!"]
    assert all(text[p.start : p.end] == p.text for p in parts)


def test_sentence_segments():
    text = "First one. Second one!\nThird line without a stop"
    assert [p.text for p in segments(text, "sentence")] == [
        "First one.",
        "Second one!",
        "Third line without a stop",
    ]


def test_without_tidies_spacing():
    text = "Please send money , now ."
    parts = segments(text, "word")
    assert without(text, parts, {2}) == "Please send, now."


def test_question_validation():
    with pytest.raises(ValueError):
        Question("maybe", "?")
    with pytest.raises(ValueError):
        Question("choice", "Which?", {"a": "A"}, target="b")
    q = Question("score", "How good?", ["bad", "ok", "good"])
    assert q.value({"0": 0.0, "1": 0.0, "2": 1.0}) == 1.0
    assert q.value({"0": 1.0, "1": 0.0, "2": 0.0}) == 0.0


def test_xray_reports_every_segment():
    backend = FakeBackend()
    state = "Urgent: send your bank details and money to claim the prize"
    result = collect(xray(backend, state, SPAM))
    n = len(segments(state))
    assert len(result["segments_measured"]) == n
    assert result["done"]["calls"] == n + 1
    assert any(abs(e["effect"]) > 0 for e in result["segments_measured"])


def test_flip_crosses_threshold_and_is_minimal():
    backend = FakeBackend()
    state = "Send money and bank details now to claim your money prize, bank transfer only"
    q = Question("noul", "Is this a scam asking for money or bank details?", {"true": "scam money bank details", "false": "normal message"})
    events = list(flip(backend, state, q))
    base, done = events[0], events[-1]
    assert done["event"] == "done"
    if done["flipped"]:
        above = base["value"] >= 0.5
        assert (done["value"] < 0.5) if above else (done["value"] >= 0.5)
        parts = segments(state)
        for i in done["removed"]:
            kept = [j for j in done["removed"] if j != i]
            value = backend.read(without(state, parts, set(kept)), q).value
            assert (value >= 0.5) if above else (value < 0.5)


def test_swap_summarizes_groups():
    backend = FakeBackend()
    events = list(
        swap(
            backend,
            "Applicant Sam Lee has five years of experience. We met sam  lee last week.",
            "Sam Lee",
            {"A": ["Alice", "Ann"], "B": ["Bob", "Ben", "Bill"]},
            Question("noul", "Should we interview this applicant?"),
        )
    )
    start, done = events[0], events[-1]
    assert start["occurrences"] == 2
    assert done["calls"] == 6
    assert done["summary"]["A"]["n"] == 2 and done["summary"]["B"]["n"] == 3
    assert "_gap" in done["summary"]


def test_replace_every_occurrence():
    from jevxray.probes.swap import replace

    assert replace("Sam Lee met SAM LEE.", "sam lee", "Ann") == "Ann met Ann."


def test_swap_errors_are_readable():
    with pytest.raises(ValueError, match="Couldn't find"):
        list(swap(FakeBackend(), "no name here", "Emily", {"A": ["x"]}, SPAM))
    with pytest.raises(ValueError, match="at least one"):
        list(swap(FakeBackend(), "Emily applied", "Emily", {"A": [" "]}, SPAM))


def test_phrase_segments_split_on_commas():
    text = "Hi Sarah, please confirm your details: it takes a minute."
    assert [p.text for p in segments(text, "phrase")] == [
        "Hi Sarah,",
        "please confirm your details:",
        "it takes a minute.",
    ]
