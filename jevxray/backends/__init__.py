from __future__ import annotations

import os
from pathlib import Path

from ..cache import Cache
from .base import Backend, Reading

DEFAULT_CACHE = Path(os.environ.get("JEVXRAY_CACHE", Path.home() / ".cache" / "jev-xray" / "answers.db"))


def make_backend(name: str | None = None, *, cache: bool = True) -> Backend:
    """Build a backend from a name or the JEVXRAY_BACKEND environment variable.

    jevk5    - local JevK5 behind llama-server (JEVK5_URL, default http://127.0.0.1:8080)
    typesafe - hosted Jev (TYPESAFE_API_KEY)
    fake     - deterministic keyword model, for tests and offline UI work
    """
    name = (name or os.environ.get("JEVXRAY_BACKEND") or "jevk5").lower()
    store = Cache(DEFAULT_CACHE) if cache else None
    if name == "jevk5":
        from .jevk5 import DEFAULT_KNOCKOUT_TEMPERATURE, DEFAULT_TEMPERATURE, JevK5Backend

        return JevK5Backend(
            url=os.environ.get("JEVK5_URL", "http://127.0.0.1:8080"),
            temperature=float(os.environ.get("JEVK5_TEMPERATURE", DEFAULT_TEMPERATURE)),
            knockout_temperature=float(
                os.environ.get("JEVK5_KNOCKOUT_TEMPERATURE", DEFAULT_KNOCKOUT_TEMPERATURE)
            ),
            cache=store,
        )
    if name == "typesafe":
        from .typesafe import TypeSafeBackend

        return TypeSafeBackend(model=os.environ.get("TYPESAFE_MODEL", "jev-latest"), cache=store)
    if name == "fake":
        from .fake import FakeBackend

        return FakeBackend(cache=None)
    raise ValueError(f"unknown backend {name!r}; use jevk5, typesafe or fake")


__all__ = ["Backend", "Reading", "make_backend"]
