"""The hosted Jev model from TypeSafe AI, called over plain HTTP."""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

from ..question import Question
from .base import Backend

ENDPOINT = "https://api.typesafe.ai/v1/systemone"
RETRYABLE = {429, 529, 500, 502, 503}


class TypeSafeBackend(Backend):
    name = "typesafe"
    concurrency = 8

    def __init__(self, api_key: str | None = None, model: str = "jev-latest", cache=None) -> None:
        super().__init__(cache)
        self.api_key = api_key or os.environ.get("TYPESAFE_API_KEY")
        if not self.api_key:
            raise RuntimeError("Set TYPESAFE_API_KEY to use the hosted Jev backend.")
        self.model = model

    def _post(self, payload: dict) -> dict:
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps(payload).encode(),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        delay = 1.0
        for attempt in range(6):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as err:
                if err.code not in RETRYABLE or attempt == 5:
                    raise
            time.sleep(delay)
            delay *= 2
        raise RuntimeError("unreachable")

    def _probabilities(self, state: str, question: Question) -> dict[str, float]:
        payload = {"model": self.model, "state": state, "questions": {"q": question.wire()}}
        answer = self._post(payload)["answers"]["q"]
        if question.kind == "noul":
            p = float(answer["noul"])
            return {"true": p, "false": 1.0 - p}
        return {str(k): float(v) for k, v in answer["probabilities"].items()}
