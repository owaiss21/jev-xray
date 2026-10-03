"""Does the name matter? Does the tech stack?

For six engineering roles with a clearly qualified candidate, the model is asked "Should this
candidate be invited to a first interview?" while one thing changes at a time:

  name   24 names, 12 Anglo and 12 Muslim, everything else identical
  stack  the required stack on the latest job, then four stacks the job didn't ask for

    python experiments/name_vs_stack/run.py                      # local JevK5
    python experiments/name_vs_stack/run.py --backend typesafe   # hosted Jev (about 180 calls)

Writes results/<model>.json and results/<model>.png.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import statistics
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1]))

from jevxray import Question, make_backend  # noqa: E402

from cases import NAMES, NEUTRAL_NAME, QUESTION, ROLES, resume  # noqa: E402


def bootstrap_ci(values: list[float], reps: int = 5000, seed: int = 7) -> tuple[float, float]:
    rng = random.Random(seed)
    means = sorted(statistics.fmean(rng.choices(values, k=len(values))) for _ in range(reps))
    return means[int(0.025 * reps)], means[int(0.975 * reps)]


def chart(result: dict, path: Path) -> None:
    """Two panels on the same scale: what changing the name does, and what changing the stack does."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    surface, ink, muted, grid = "#ffffff", "#111827", "#6b7280", "#e5e7eb"
    anglo, muslim, stack = "#2a78d6", "#eb6834", "#e34948"
    roles = [r["role"] for r in result["roles"]]
    fig, (left, right) = plt.subplots(1, 2, figsize=(10, 4.4), dpi=160, sharey=True)
    fig.patch.set_facecolor(surface)

    for ax in (left, right):
        ax.set_facecolor(surface)
        ax.set_xlim(-100, 10)
        ax.axvline(0, color=muted, lw=1)
        ax.grid(axis="x", color=grid, lw=0.8)
        ax.tick_params(colors=muted, length=0, labelsize=8.5)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(grid)

    for y, r in enumerate(result["roles"]):
        for name, p in r["names"].items():
            group = "Muslim" if name in NAMES["Muslim"] else "Anglo"
            jitter = ((NAMES["Anglo"] + NAMES["Muslim"]).index(name) % 7 - 3) * 0.04
            left.scatter((p - r["base"]) * 100, y + jitter, s=16, color=muslim if group == "Muslim" else anglo,
                         alpha=0.85, edgecolor="none", zorder=3)
        for s, p in r["stacks"].items():
            right.scatter((p - r["base"]) * 100, y, s=22, color=stack, edgecolor="none", zorder=3)

    left.set_yticks(range(len(roles)), roles, fontsize=9, color=ink)
    left.invert_yaxis()
    left.set_title("Change the candidate's name", loc="left", fontsize=10, color=ink)
    right.set_title("Change the tech stack", loc="left", fontsize=10, color=ink)
    left.set_xlabel("change in P(interview), points", fontsize=8.5, color=muted)
    right.set_xlabel("change in P(interview), points", fontsize=8.5, color=muted)
    left.scatter([], [], s=16, color=anglo, label="Anglo names")
    left.scatter([], [], s=16, color=muslim, label="Muslim names")
    left.legend(loc="lower left", frameon=False, fontsize=8)
    fig.suptitle(f"Same qualified candidate, one thing changed · {result['model'].split(' / ')[-1]}",
                 x=0.01, ha="left", fontsize=10.5, color=ink)
    fig.tight_layout()
    fig.savefig(path, facecolor=surface)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", default=None)
    args = parser.parse_args()

    backend = make_backend(args.backend)
    q = Question("noul", QUESTION)
    names = NAMES["Anglo"] + NAMES["Muslim"]
    started = time.perf_counter()
    roles, calls = [], 0

    for role in ROLES:
        base = backend.read(resume(role, NEUTRAL_NAME, role["stack"]), q).value
        by_name = {}
        for i, reading in backend.read_many([resume(role, n, role["stack"]) for n in names], q):
            by_name[names[i]] = reading.value
        by_stack = {}
        for i, reading in backend.read_many([resume(role, NEUTRAL_NAME, s) for s in role["others"]], q):
            by_stack[role["others"][i]] = reading.value
        calls += 1 + len(names) + len(role["others"])
        anglo = statistics.fmean(by_name[n] for n in NAMES["Anglo"])
        muslim = statistics.fmean(by_name[n] for n in NAMES["Muslim"])
        roles.append({
            "role": role["role"],
            "base": base,
            "names": by_name,
            "stacks": by_stack,
            "anglo_mean": anglo,
            "muslim_mean": muslim,
            "name_gap": anglo - muslim,
            "largest_name_shift": max(abs(p - base) for p in by_name.values()),
            "stack_drop": base - statistics.fmean(by_stack.values()),
        })
        print(f"{role['role']:<28} base {base:.3f}  name gap {anglo - muslim:+.4f}  stack drop {roles[-1]['stack_drop']:+.3f}", file=sys.stderr)

    gaps = [r["name_gap"] for r in roles]
    drops = [r["stack_drop"] for r in roles]
    result = {
        "model": f"{backend.name} / {backend.model}",
        "question": QUESTION,
        "calls": calls,
        "seconds": round(time.perf_counter() - started, 1),
        "name_gap_mean": statistics.fmean(gaps),
        "name_gap_ci95": list(bootstrap_ci(gaps)),
        "largest_name_shift": max(r["largest_name_shift"] for r in roles),
        "stack_drop_mean": statistics.fmean(drops),
        "stack_drop_min": min(drops),
        "roles": roles,
    }
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    stem = re.sub(r"[^a-z0-9.]+", "-", backend.model.lower()).strip("-")
    (out / f"{stem}.json").write_text(json.dumps(result, indent=2) + "\n", newline="\n")
    chart(result, out / f"{stem}.png")

    print(f"model: {result['model']}  ({calls} calls, {result['seconds']}s)")
    print(f"Anglo minus Muslim names: {result['name_gap_mean']*100:+.2f} pts "
          f"(95% CI {result['name_gap_ci95'][0]*100:+.2f} to {result['name_gap_ci95'][1]*100:+.2f})")
    print(f"largest shift from any single name: {result['largest_name_shift']*100:.2f} pts")
    print(f"average drop when the stack doesn't match: {result['stack_drop_mean']*100:.1f} pts "
          f"(smallest role: {result['stack_drop_min']*100:.1f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
