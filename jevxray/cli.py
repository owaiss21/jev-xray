"""Command line entry point.

    jev-xray serve                      start the UI on http://127.0.0.1:8000
    jev-xray xray examples/spam.json    print a word-by-word attribution table
    jev-xray flip examples/spam.json    find a small set of deletions that flips the answer
    jev-xray swap examples/hiring.json  run the counterfactual swap in an example file
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .backends import make_backend
from .question import Question


def _load(path: str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _bar(value: float, width: int = 20) -> str:
    filled = round(abs(value) * width)
    return ("+" if value >= 0 else "-") * filled


def cmd_serve(args) -> int:
    import uvicorn

    from .server import create_app

    app = create_app(make_backend(args.backend))
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


def cmd_xray(args) -> int:
    from .probes import xray

    example = _load(args.example)
    question = Question.from_dict(example["question"])
    backend = make_backend(args.backend)
    parts, effects = [], {}
    for event in xray(backend, example["state"], question, args.granularity or example.get("granularity", "word")):
        if event["event"] == "base":
            parts = event["segments"]
            print(f"{question.target_id}: {event['value']:.3f}  ({backend.name} / {backend.model})\n")
        elif event["event"] == "segment":
            effects[event["i"]] = event["effect"]
            print(f"\r  measured {len(effects)}/{len(parts)}", end="", file=sys.stderr)
        elif event["event"] == "done":
            print(f"\r  {event['calls']} calls in {event['seconds']:.1f}s          ", file=sys.stderr)
    ranked = sorted(parts, key=lambda p: -abs(effects[p["i"]]))[: args.top]
    for p in ranked:
        e = effects[p["i"]]
        print(f"  {e:+.3f}  {_bar(e):<20}  {p['text']}")
    return 0


def cmd_flip(args) -> int:
    from .probes import flip

    example = _load(args.example)
    question = Question.from_dict(example["question"])
    backend = make_backend(args.backend)
    parts = []
    for event in flip(backend, example["state"], question, args.granularity or example.get("granularity", "word"), args.threshold):
        if event["event"] == "base":
            parts = event["segments"]
            print(f"start: {event['value']:.3f}, pushing {event['direction']} past {event['threshold']}")
        elif event["event"] == "remove":
            print(f"  removed {len(event['removed'])} -> {event['value']:.3f}")
        elif event["event"] == "restore":
            print(f"  restored '{parts[event['i']]['text']}' -> still flipped at {event['value']:.3f}")
        elif event["event"] == "done":
            verdict = "flipped" if event["flipped"] else "did not flip"
            print(f"\n{verdict} at {event['value']:.3f} after {event['calls']} calls by removing:")
            for i in event["removed"]:
                print(f"  - {parts[i]['text']}")
    return 0


def cmd_swap(args) -> int:
    from .probes import swap

    example = _load(args.example)
    question = Question.from_dict(example["question"])
    backend = make_backend(args.backend)
    for event in swap(backend, example["state"], example["swap"], example["groups"], question):
        if event["event"] == "start":
            o = event["original"]
            print(f"  {'original':<12} {o['value']:<24} {o['p']:.3f}")
        elif event["event"] == "value":
            print(f"  {event['group']:<12} {event['value']:<24} {event['p']:.3f}")
        elif event["event"] == "done":
            print()
            for group, s in event["summary"].items():
                if group != "_gap":
                    print(f"  {group:<12} mean {s['mean']:.3f}  (n={s['n']}, sd {s['stdev']:.3f})")
            if "_gap" in event["summary"]:
                print(f"  gap between groups: {event['summary']['_gap']:.3f}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jev-xray")
    parser.add_argument("--backend", help="jevk5 (default), typesafe or fake")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("serve", help="start the web UI")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("xray", help="leave-one-out attribution for an example file")
    p.add_argument("example")
    p.add_argument("--granularity", choices=["word", "phrase", "sentence"])
    p.add_argument("--top", type=int, default=12)
    p.set_defaults(func=cmd_xray)

    p = sub.add_parser("flip", help="find deletions that flip the decision")
    p.add_argument("example")
    p.add_argument("--granularity", choices=["word", "phrase", "sentence"])
    p.add_argument("--threshold", type=float, default=0.5)
    p.set_defaults(func=cmd_flip)

    p = sub.add_parser("swap", help="run a counterfactual swap example")
    p.add_argument("example")
    p.set_defaults(func=cmd_swap)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
