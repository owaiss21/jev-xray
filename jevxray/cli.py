"""Command line entry point.

    jev-xray serve                      start the UI on http://127.0.0.1:8000
    jev-xray xray scenarios/parcel.json     print which pieces of the text moved the answer
    jev-xray flip scenarios/parcel.json     find a small set of deletions that changes the answer
    jev-xray swap scenarios/hiring.json     run a scenario's swap test (--which picks one)
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


def _setup(args):
    """Load the scenario file and build the question and backend every command needs."""
    example = _load(args.example)
    return example, Question.from_dict(example["question"]), make_backend(args.backend)


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

    example, question, backend = _setup(args)
    parts, effects = [], {}
    for event in xray(backend, example["state"], question, args.granularity or example.get("granularity", "phrase")):
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

    example, question, backend = _setup(args)
    parts = []
    for event in flip(backend, example["state"], question, args.granularity or example.get("granularity", "phrase")):
        if event["event"] == "base":
            parts = event["segments"]
            print(f"answer: {event['answer']} ({event['probs'][event['answer']]:.3f})")
        elif event["event"] == "remove":
            print(f"  removed {len(event['removed'])} -> {event['answer']} ({event['probs'][event['answer']]:.3f})")
        elif event["event"] == "restore":
            print(f"  restored '{parts[event['i']]['text']}', not needed")
        elif event["event"] == "done":
            if event["flipped"]:
                print(f"\nflips from {event['from']} to {event['answer']} after {event['calls']} calls by removing:")
            else:
                print(f"\ndid not flip after {event['calls']} calls; tried removing:")
            for i in event["removed"]:
                print(f"  - {parts[i]['text']}")
    return 0


def cmd_swap(args) -> int:
    from .probes import swap

    example, question, backend = _setup(args)
    test = example["swaps"][args.which]
    for event in swap(backend, example["state"], test["original"], test["groups"], question):
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
    p.set_defaults(func=cmd_flip)

    p = sub.add_parser("swap", help="run one of a scenario's swap tests")
    p.add_argument("example")
    p.add_argument("--which", type=int, default=0, help="index of the swap test in the scenario file")
    p.set_defaults(func=cmd_swap)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
