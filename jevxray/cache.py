"""A small sqlite memo so repeated runs (and live demos) don't pay for the same call twice."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from pathlib import Path


class Cache:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False)
        self._db.execute("create table if not exists answers (key text primary key, probs text)")
        self._db.commit()

    @staticmethod
    def key(*parts) -> str:
        blob = json.dumps(parts, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode()).hexdigest()

    def get(self, key: str) -> dict[str, float] | None:
        with self._lock:
            row = self._db.execute("select probs from answers where key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, key: str, probs: dict[str, float]) -> None:
        with self._lock:
            self._db.execute(
                "insert or replace into answers (key, probs) values (?, ?)", (key, json.dumps(probs))
            )
            self._db.commit()
