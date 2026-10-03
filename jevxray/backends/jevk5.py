"""JevK5, the open-weight Jev alternative, running locally behind llama-server.

The heavy lifting (prompt layout, letter readout, calibration, >16 option knockout) is done by the
`jevk5` package. We only adapt its output to our Reading type.
"""

from __future__ import annotations

import json
import urllib.request

from ..question import Question
from .base import Backend

# Values published for jevk5-4b-v0.3 GGUF files on the JevK5 model card.
DEFAULT_TEMPERATURE = 1.22
DEFAULT_KNOCKOUT_TEMPERATURE = 0.93


class JevK5Backend(Backend):
    name = "jevk5"

    def __init__(
        self,
        url: str = "http://127.0.0.1:8080",
        temperature: float = DEFAULT_TEMPERATURE,
        knockout_temperature: float = DEFAULT_KNOCKOUT_TEMPERATURE,
        cache=None,
    ) -> None:
        super().__init__(cache)
        try:
            from jevk5 import JevK5GGUF
        except ImportError as exc:
            raise RuntimeError(
                "The local backend needs the jevk5 client: "
                'pip install --no-deps "jevk5 @ git+https://github.com/allebee/jevk5@v0.3.0"'
            ) from exc
        self.url = url.rstrip("/")
        self.client = JevK5GGUF(
            url=self.url, temperature=temperature, knockout_temperature=knockout_temperature
        )
        self.model = self._model_name()

    def _model_name(self) -> str:
        try:
            with urllib.request.urlopen(self.url + "/v1/models", timeout=3) as response:
                data = json.loads(response.read())
            model_id = data["data"][0]["id"]
            return model_id.replace("\\", "/").rsplit("/", 1)[-1]
        except Exception:
            return "jevk5 (llama-server)"

    def _probabilities(self, state: str, question: Question) -> dict[str, float]:
        probs, _tokens = self.client.probabilities(state, question.wire())
        return probs
