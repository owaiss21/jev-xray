# Jev, from the inside out

A 30-minute knowledge session: what Jev is, how it decides, how this repo makes those decisions visible, and the web page last.

| Time | Part | What you show |
|---|---|---|
| 0–8 | 1. What Jev is | no code, just the ideas |
| 8–23 | 2. The code, in Jev terms | the files in reading order |
| 23–30 | 3. The web page | the four cases live |

---

## Part 1 — What Jev is (8 min)

### One sentence

Jev takes **some text** and **a typed question with options**, and returns **a probability for every option**. It does not write anything.

```
text:      "…left at the front door of 17 Elm Street. The delivery photo shows a blue door.
            Customer address: 71 Elm Street. … My front door is green."
question:  "What most likely happened to this parcel?"
options:   Delivered / Wrong address / Stolen / Unclear
answer:    Wrong address 0.97, the rest share 0.03
```

### Three question types

| Type | Asks | Returns | Example |
|---|---|---|---|
| `noul` | yes or no | P(yes) | "Does the customer have a receipt?" |
| `choice` | pick one of N | P per option | "Which team should handle this ticket?" |
| `score` | a rating on ordered levels | P per level | "How urgent is this? Can wait / This week / Today / Right now" |

In code this is `jevxray/question.py`. Every probe reduces the answer to a single number through `Question.value()`:
- yes/no: P(yes)
- choice: P(the option we're watching)
- score: the expected level, scaled to 0..1

### How it reaches a decision

Inside, it is a language model, but it is **read, not run**. The local model we use (JevK5, via the `jevk5` client) works roughly like this:

1. Lay the text, the question and the options out in a fixed prompt, each option given a letter.
2. Do **one** forward pass. Don't generate text.
3. Read the probability the model puts on each option's letter as the next token.
4. Calibrate with a temperature (1.22 for the 4B model), which aims to make the probabilities honest: 90% should be right about 90% of the time.
5. With more than 16 options, run a knockout round (a separate temperature, 0.93).

The hosted Jev from TypeSafe takes the same request (`state` + `questions`) and returns the same kind of answer. Its internals aren't published. We only use what goes in and what comes out, which is why everything here works with either.

### Why it's more than a classifier

| A classifier | Jev |
|---|---|
| labels fixed at training time | question and options arrive **with every request** |
| new label = new data + retraining | new label = edit a string |
| learns patterns of the label | **reads the rules in the text** and applies them |

The refund case shows the difference. The return policy is *in the text*: receipt → refund within 30 days, no receipt → store credit within 14 days, after that nothing. Nobody trained a "refund classifier". The model has to combine the policy, the date and the missing receipt. That's reasoning, even though it never writes any of it down.

### Why it's not just an LLM

| A chat LLM | Jev |
|---|---|
| writes an answer token by token | one pass, one probability per option |
| you parse the text to find the decision | the decision *is* the output |
| "I think it's probably billing…": no number | 0.93, so you can set a threshold |
| wording and length vary between runs | same input, same output |
| slow and costly per decision | cheap: no generation |
| explains itself (not always truthfully) | **doesn't explain itself at all** |

That last row is the whole reason this repo exists.

### Where it fits

Anything that's a decision over text, with rules you can write down:

- **Support:** route tickets, set urgency, spot refund or churn risk
- **Policy:** refunds, returns, claims, eligibility. The rules travel in the text.
- **Trust & safety:** scam, abuse, spam, with a threshold per action
- **Hiring and review:** does this CV meet the must-haves? (and is it fair — Part 2)
- **Ops checks:** "Do the addresses match?" "Was the customer charged?" Single facts as yes/no
- **Evaluating other AI:** "Does this answer follow the instructions?" as a probability

### The problem we're solving

A probability is easy to act on and impossible to question. "Wrong address, 97%." Why? Based on what? Would it still say that if…?

**The trick: we never look inside the model. We change the input and watch the number move.** Same input always gives the same output, so any change in the number comes from the change we made.

---

## Part 2 — The code, in Jev terms (15 min)

Read in this order. Each file answers one question about Jev.

### 1. "What do we ask Jev?" — `jevxray/question.py` (2 min)

- **`Question`**: the typed question. Checks itself when created: a choice needs 2+ options, a score needs 2+ levels.
- **`option_ids`**: the options for any type. Yes/no becomes `true`/`false`; score levels become `0, 1, 2…`.
- **`target_id`**: which option we follow. For yes/no it's `true`, for a choice the first option (or the one you pick), for a score the expected level.
- **`value(probs)`**: the **one number** every experiment watches. This is the needle on the gauge.
- **`wire()`**: the question exactly as Jev receives it.

### 2. "How do we ask Jev?" — `jevxray/backends/` (2 min)

- **`base.py` → `Backend.read(text, question)`**: the **only** way the rest of the code talks to Jev. Text and question go in; a probability per option comes out. It also caches answers and times each call.
- **`read_many(texts, question)`**: the same question over many versions of a text. This is what makes the experiments affordable, since they ask dozens of near-identical questions.
- **`jevk5.py`**: local open model (JevK5 4B, 2.7 GB, 1–2 s per question on a laptop GPU).
- **`typesafe.py`**: hosted Jev over HTTP. Retries when the service is busy.
- **`fake.py`**: a keyword-counting stand-in for tests. Its answers mean nothing.
- **`cache.py`**: same text + same question = same answer, so it's stored. A repeated demo answers instantly.

> Point to make: Jev being deterministic is what makes caching correct, and it's what makes every experiment below a fair comparison.

### 3. "What can we change?" — `jevxray/text.py` (2 min)

To ask "what if this part were gone?", we need to cut the text into parts we can remove cleanly.

- **`segments(text, granularity)`**: split by `word`, `phrase` (ends at `, ; : . ! ?`) or `sentence`. Keeps each piece's position so the page can highlight it. Keeps `2:14` and `1,000` whole.
- **`_attach_labels()`**: keeps `Customer address:` together with `71 Elm Street`. Removing a bare label only tests how confused the model gets by a dangling value.
- **`without(text, parts, drop)`**: the text with chosen pieces removed and the spacing tidied, so Jev sees clean input and not a gap.

### 4. The three experiments — `jevxray/probes/` (7 min, the core)

Changing a word doesn't help Jev decide. **It shows us what Jev decided on.** Each probe is a different question we ask about the decision.

#### a) "What did it lean on?" — `xray.py`, leave-one-out

```
base   = value(full text)                      e.g. P(Wrong address) = 0.97
for each piece:
    effect = base − value(text without piece)
```

- Positive effect: the piece was **pushing towards** the answer (blue on the page).
- Negative: it was **pushing away** (red).
- Cost: one call per piece, plus one.

Parcel case: the customer's address (`71 Elm Street`, against `17 Elm Street` in the tracking) lights up as the strongest support for "Wrong address". Run it live to show the exact numbers.

Caveat: if two pieces say the same thing, removing either one alone changes little. A low score doesn't always mean "ignored".

`collect()` runs any probe to the end and gathers its events. The tests use it.

#### b) "How close is it to changing its mind?" — `flip.py`, fewest deletions

1. Score every piece (the same scan as X-ray).
2. Remove the strongest supporters one by one until a **different option wins**.
3. Put each one back. If the answer stays flipped without it, it wasn't needed.

Result: a small set where **no single deletion can be undone** without undoing the flip. It's the smallest set found, not provably the smallest that exists; that would take far more calls.

Ticket case: "Technical", 93%. Delete `403` and `endpoint.` and it becomes "Billing". Two words between two teams means a person should look at it.

`top()` is the option with the highest probability.

#### c) "Does it react to the right things?" — `swap.py`, counterfactuals

Replace one thing with alternatives, keep everything else identical, and compare groups.

- **`find()` / `replace()`**: find every occurrence (ignoring case and spacing) and substitute it.
- **`swap()`**: ask the question on the original and on every substitute.
- **`summarize()`**: mean, min, max and spread per group, and the **gap** between groups.

Two outcomes worth showing:

| Case | Swap | Result | Meaning |
|---|---|---|---|
| Hiring | 12 Anglo / 12 Muslim names | all 94–95% | ignores who's applying ✅ |
| Hiring | React+TS → Angular, Vue, jQuery… | drops to ~12% | cares about what the job asked for ✅ |
| Refund | 12 days → 16, 25, 40 days | still "Store credit" (96%) | reads the date, **doesn't apply the 14-day cutoff** ❌ |

The refund row is the key slide. The extra checks say the model *understands* the date ("bought within 14 days?" → correct). Only the swap shows it doesn't *use* the rule. Without it you'd never know.

### 5. The cases — `scenarios/*.json` (1 min)

Each file is a case: `title`, `order`, `state` (the text), `question`, `checks` (extra questions about single facts), `swaps` (each with `label`, `original` and `groups`) and `granularity`.

| Case | What it shows |
|---|---|
| `parcel` | X-ray: the answer rests on the address mismatch |
| `hiring` | Swap: name doesn't matter, stack does |
| `refund` | Swap: catches a rule the model doesn't apply |
| `ticket` | Flip: two words decide the team |

**Checks** are separate questions on the same text, mostly yes/no plus one rating in hiring and ticket. Jev can't tell you its reasoning, but it will tell you whether it thinks the addresses match. They show what it believes about each fact, not the path it took.

### 6. At scale — `experiments/name_vs_stack/` (1 min)

- `cases.py`: 6 engineering roles, a qualified candidate each, 24 names, 4 off-target stacks per role.
- `run.py`: 174 calls, a bootstrap confidence interval (`bootstrap_ci`) and the chart (`chart`).

Result: names moved the answer by less than 1 point on average, while a stack the job didn't ask for dropped it by about 80. The gap between what should matter and what shouldn't is about a hundredfold. It's one small open model on hand-written CVs: a check on this model, not a verdict on AI hiring.

### 7. Plumbing (mention, don't dwell)

- `cli.py`: the same probes from a terminal. Good as a live code demo: `jev-xray xray scenarios/parcel.json`.
- `server.py`: runs the probes behind HTTP and streams each result as it arrives, so the page fills in live.
- `web/`: the page. Plain HTML, CSS and JS.
- `tests/`: the probes and the server, run against the fake model.

---

## Part 3 — The web page (7 min)

Start: `scripts/start-model.ps1` (the model), then `jev-xray serve` → http://127.0.0.1:8000

| Step | Case | Click | Say |
|---|---|---|---|
| 1 | Missing parcel | loads by itself | "Answer plus probabilities. Checks: addresses don't match, door doesn't match. Blue highlight: it leaned on the customer's address." |
| 2 | Support ticket | What flips it | "Two words between Technical and Billing. Flag it for a human." |
| 3 | Job application | Swap test → Name, then Tech stack | "Names flat, stack drops. Responds to the job, not the person." |
| 4 | Refund request | Swap test → Days since purchase | "After 14 days it should say No return. It doesn't. Checks alone wouldn't have caught this." |
| 5 | Your own | type a case live | "Change one word in the text and everything re-asks itself." |

If the model isn't running: `jev-xray --backend fake serve` still shows the page, but the answers are meaningless. Say so on screen.

---

## Closing points

1. Jev = typed decisions over text, with a probability per option. Not a classifier (the options are free), not a chatbot (no prose).
2. It's fast, thresholdable and repeatable, but it can't explain itself.
3. We explain it from the outside: **delete** (what it leans on), **minimal delete** (how fragile it is), **swap** (whether it's fair and applies the rules).
4. Every number on the page is just `Backend.read()` called on a slightly different text.

### Honest limits

- All the results here come from JevK5 4B at 4 bits. Hosted Jev will answer differently.
- Deletion measures reliance, not "thoughts". Pieces can cover for each other.
- Checks are separate questions. They don't show the path the model took.
