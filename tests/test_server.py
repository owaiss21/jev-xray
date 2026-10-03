import json

from fastapi.testclient import TestClient

from jevxray.backends.fake import FakeBackend
from jevxray.server import create_app

client = TestClient(create_app(FakeBackend()))
QUESTION = {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "payments", "tech": "bugs"}, "target": "billing"}


def lines(response):
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_health_and_examples():
    assert client.get("/api/health").json()["backend"] == "fake"
    examples = client.get("/api/examples").json()
    assert {e["id"] for e in examples} >= {"spam", "hiring_names"}


def test_decide():
    out = client.post("/api/decide", json={"state": "I was charged twice", "question": QUESTION}).json()
    assert abs(sum(out["probs"].values()) - 1) < 1e-9
    assert out["value"] == out["probs"]["billing"]


def test_xray_stream():
    events = lines(client.post("/api/xray", json={"state": "charged twice for payments", "question": QUESTION}))
    assert events[0]["event"] == "base" and events[-1]["event"] == "done"
    assert sum(e["event"] == "segment" for e in events) == 4


def test_bad_question_is_422():
    bad = {**QUESTION, "target": "nope"}
    assert client.post("/api/decide", json={"state": "x", "question": bad}).status_code == 422


def test_swap_without_slot_is_422():
    body = {"template": "no slot", "slot": "name", "groups": {"A": ["x"]}, "question": QUESTION}
    assert client.post("/api/swap", json=body).status_code == 422


def test_index_served():
    assert "jev-xray" in client.get("/").text
