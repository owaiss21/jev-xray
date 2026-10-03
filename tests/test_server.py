import json

from fastapi.testclient import TestClient

from jevxray.backends.fake import FakeBackend
from jevxray.server import create_app

client = TestClient(create_app(FakeBackend()))
QUESTION = {"type": "choice", "instructions": "Which team?", "criteria": {"billing": "payments", "tech": "bugs"}, "target": "billing"}


def lines(response):
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_health_and_scenarios():
    assert client.get("/api/health").json()["backend"] == "fake"
    scenarios = client.get("/api/scenarios").json()
    assert [s["id"] for s in scenarios][:2] == ["parcel", "hiring"]
    for s in scenarios:
        assert s["checks"] and s["swaps"]
        for test in s["swaps"]:
            assert test["original"] in s["state"]


def test_ask_answers_every_question_in_order():
    questions = [QUESTION, {"type": "noul", "instructions": "Was the customer charged?"}]
    events = lines(client.post("/api/ask", json={"state": "I was charged twice", "questions": questions}))
    assert [e["i"] for e in events] == [0, 1]
    assert set(events[1]["probs"]) == {"true", "false"}


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
    body = {"text": "no name here", "original": "Emily", "groups": {"A": ["x"]}, "question": QUESTION}
    response = client.post("/api/swap", json=body)
    assert response.status_code == 422
    assert "Couldn't find" in response.json()["detail"]


def test_index_served():
    assert "jev-xray" in client.get("/").text


def test_cli_parses():
    from jevxray import cli

    assert cli.main(["--backend", "fake", "flip", "scenarios/ticket.json"]) == 0
