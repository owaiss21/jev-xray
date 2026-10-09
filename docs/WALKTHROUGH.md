# jev-xray walkthrough

Plan for a ~30 minute session: code first, web page last.

## The idea in one minute

Jev takes **text + a typed question** and returns **a probability per option**. No prose, no reasons.

So we explain it from the outside. We never look inside the model. We change the input and watch the probabilities move:

| Probe | Change to the input | What it tells you |
|---|---|---|
| **X-ray** | delete one piece at a time | which pieces the answer leans on |
| **Flip** | delete the fewest pieces possible | how close the decision is to the edge |
| **Swap** | replace one thing (name, date, stack) with alternatives | does it react to what it should, ignore what it shouldn't |
| **Checks** | ask extra questions (mostly yes/no, some ratings) on the same text | what the model believes about each fact |

Everything in the repo serves those four ideas.

## Reading order (code first)

1. `jevxray/question.py` – what a question is
2. `jevxray/backends/base.py` – the one call everything uses: `read(text, question)`
3. `jevxray/text.py` – how text is cut into removable pieces
4. `jevxray/probes/xray.py` → `flip.py` → `swap.py` – the three probes
5. `scenarios/*.json` – the four demo cases
6. `jevxray/cli.py` – run probes from a terminal (live demo of the code)
7. `jevxray/server.py` + `web/` – the same probes behind a page
8. `experiments/name_vs_stack/` – the probes at scale
9. Finish by opening the web page

Suggested timing: 1–4 → 15 min, 5–6 → 5 min, 7–8 → 5 min, page → 5 min.

## File and function reference

### `jevxray/question.py`

- **`Question`** (frozen dataclass): one Jev question. Validates itself on creation.
  - `kind`: `noul` (yes/no), `choice` (pick one), `score` (ordered levels).
  - `instructions`: the question in plain words. `criteria`: the options. `target`: the option we track.
  - `option_ids`: the option names for any kind.
  - `target_id`: which option we follow (`true` for yes/no, first option for choice, `expected` for score).
    For a score question the Why view tracks this expected rating (shown as e.g. "3.4 of 5"); `wire()` in `app.js` drops `target` for scores.
  - `value(probs)`: collapses the answer to **one number in 0..1**. This is the number every probe watches.
  - `wire()`: the question in the request shape the API/model expects.
  - `from_dict()`: build from the JSON used in scenarios and API calls.

### `jevxray/backends/` (the model sits behind this)

- **`base.py`**
  - `Reading`: one answer: `probs`, tracked `value`, `seconds`, `cached`.
  - `Backend`: base class. Subclasses only write `_probabilities(text, question)`.
    - `read()`: cache lookup → call model → time it → store → return a `Reading`.
    - `read_many()`: many texts, same question; runs in parallel if `concurrency > 1`, yields results as they finish.
    - `info()`: backend and model name for the UI header.
- **`jevk5.py`** – `JevK5Backend`: local open model through llama-server. Uses the `jevk5` client for prompt layout and calibration.
- **`typesafe.py`** – `TypeSafeBackend`: hosted Jev over HTTP. `_post()` retries on 429, 500, 502, 503, 529 with doubling delay. Yes/no answers are converted to `{true, false}`.
- **`fake.py`** – `FakeBackend`: keyword-overlap stand-in for tests and offline UI. Answers mean nothing.
- **`__init__.py`** – `make_backend(name)`: picks a backend from the name or `JEVXRAY_BACKEND`, passes it the shared cache (the fake backend is uncached).
- **`../cache.py`** – `Cache`: sqlite memo keyed by hash of (backend, model, text, question). Same call twice is free; makes live demos instant.

### `jevxray/text.py` (cutting the input)

- **`Segment`**: a piece of text plus where it sits in the original. `as_dict()` sends it to the UI.
- **`segments(text, granularity)`**: split by `word`, `phrase` (ends at `, ; : . ! ?`) or `sentence`. Keeps numbers like `2:14` whole.
- **`_attach_labels()`**: glues `Customer address:` onto its value, so we never remove a label alone.
- **`without(text, parts, drop)`**: the text with chosen pieces cut out and spacing tidied. Every probe builds its variants with this.

### `jevxray/probes/` (the actual point of the project)

All probes are generators that **yield events** (`base`, then progress, then `done`). That is why the page can fill in live.

- **`xray.py`**
  - `xray()`: leave-one-out. Ask once on the full text, then once per piece with that piece removed. `effect = base − without`. Positive means the piece pushed toward the answer.
  - `collect()`: run a probe to the end and return all events as one dict (used by tests).
- **`flip.py`**
  - `flip()`: finds a small set of deletions that makes a different option win.
    1. score every piece alone (same scan as X-ray)
    2. remove supporting pieces, strongest first, until the winner changes
    3. put pieces back one by one if the flip survives without them
  - Result is locally minimal, not guaranteed global.
  - `top()`: the option with the highest probability.
- **`swap.py`**
  - `find()` / `replace()`: locate the target words (case and whitespace insensitive) and substitute them everywhere.
  - `swap()`: ask the question on the original and on every replacement; groups of values (e.g. Anglo names vs Muslim names).
  - `summarize()`: per group mean, min, max, stdev, plus `_gap` between group means. A big gap = the swapped thing matters.

### `jevxray/server.py`

- **`create_app(backend)`**: builds the FastAPI app.
- Request models (`QuestionIn`, `DecideIn`, `XrayIn`, `FlipIn`, `AskIn`, `SwapIn`): validate input; `QuestionIn.build()` turns bad questions into HTTP 422.
- `stream()`: wraps a probe generator as newline-delimited JSON; model errors become an `error` event.
- Routes: `/api/health`, `/api/scenarios`, `/api/ask` (several questions on one text, streamed in order), `/api/xray`, `/api/flip`, `/api/swap`, `/` (the page).
  `/api/decide` (one plain answer) exists for API users and tests; the page doesn't call it.

### `jevxray/cli.py`

- `main()` builds the parser. `cmd_serve`, `cmd_xray`, `cmd_flip`, `cmd_swap` run each thing from a terminal and print results.
- `_setup()`: loads a scenario file, builds the question and the backend. `_bar()`: text bar for effects.

### `scenarios/*.json`

One file per demo case: `title`, `order`, `state` (the text), `question`, `checks` (extra questions), `swaps` (each has `label`, `original` and `groups`), `granularity`.

| File | Story |
|---|---|
| `parcel` | delivered to 17 Elm St, customer lives at 71 Elm St → "Wrong address". X-ray shows why |
| `hiring` | same resume, swap name (stays flat) vs swap stack (drops) |
| `refund` | model reads the date but ignores the 14-day cutoff. Only the swap exposes it |
| `ticket` | two deleted words flip "technical" to "billing" |

### `web/`

- `index.html`, `app.css`: static shell and styles, no build step.
- `app.js` (grouped by job):
  - helpers: `esc`, `h`, `pct`, `pts`, `topOf`, `quote`, `showTip`, `optionName`
  - `wire(q, target)`: the question as sent to the server; drops `target` for score questions
  - network: `stream()` reads the NDJSON; `cancel()` aborts a running probe
  - case: `boot`, `load`, `renderDoc`, `editCase`, `renderQuestion`, `editQuestion`
  - `ask()`: sends the main question **and** every check in one `/api/ask` call; answer 0 is the decision, the rest fill the checks. On a fresh scenario it then starts Why automatically.
  - checks: `renderChecks`, `chipFor`
  - tools: `renderTool`, `runTool`, `runWhy` (X-ray), `runFlip`, `runSwap`, `swapEditor`, `swapSummary`, `stripChart`

### `experiments/name_vs_stack/`

- `cases.py`: six job roles, resumes, names, stacks, the question.
- `run.py`: runs every swap, computes bootstrap confidence intervals (`bootstrap_ci`), draws the chart (`chart`), saves raw answers to `results/`.

### Other

- `tests/test_probes.py`: text splitting, question rules, each probe. `tests/test_server.py`: health, scenarios, ask, decide, xray, error cases, the page, and one CLI run.
- `scripts/start-model.{sh,ps1}`: start llama-server with the JevK5 model.
- `docs/img/`: screenshots used in the README.

## Talking points

- Jev is not a classifier: question and options arrive with each request.
- It cannot explain itself, so we use **input → output experiments**. Same input gives same output, which is what makes comparisons fair.
- X-ray shows *what it leans on*, not what it "thinks". Phrases can cover for each other.
- Swap is the strongest test: everything else stays identical, so any change comes from the swapped words (for this model, on this text).
- Refund case: the checks say the model understands the date; the swap shows it does not apply the rule.
- Limits: JevK5 is not Jev; one small model, hand-written resumes.
