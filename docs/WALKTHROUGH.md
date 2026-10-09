# Jev, from the inside out

A 30-minute knowledge session. What Jev is, how it reaches a decision, how this repo makes those decisions visible, and the web page at the end.

This guide has more detail than you'll say out loud. Each section opens with a **Say it in one line** box: that's the spoken version. The rest is there so you understand it well enough to answer questions.

| Time | Part | What you show |
|---|---|---|
| 0–10 | [1. What Jev is and how it decides](#part-1--what-jev-is-and-how-it-decides-10-min) | ideas only, no code |
| 10–23 | [2. The code, in Jev terms](#part-2--the-code-in-jev-terms-13-min) | the files, in reading order |
| 23–30 | [3. The web page](#part-3--the-web-page-7-min) | the four cases, live |
| after | [Likely questions](#likely-questions-and-answers) and [Glossary](#glossary) | for Q&A |

Sources: the TypeSafe docs (docs.typesafe.ai), the JevK5 repository (github.com/allebee/jevk5), and this repo's code and results. Where something isn't published, the guide says so.

---

## Part 1 — What Jev is and how it decides (10 min)

### 1.1 What goes in, what comes out

> **Say it in one line:** You give Jev some text and a question with fixed answers, and it gives back a probability for each answer. It never writes a sentence.

Jev is made by TypeSafe AI. They call it a **"System One model"**.

You send it two things:
- a **state**: the text to judge, such as an email, a ticket, a CV or a policy plus a customer message
- one or more **questions**, each with a fixed set of possible answers

It sends back **numbers**. No explanation, no prose.

Here's the parcel case from this repo:

```
STATE (the text):
  Tracking: Order #7120 was delivered at 2:14 pm and left at the front door of
  17 Elm Street. The delivery photo shows a blue door.
  Customer address: 71 Elm Street
  Customer message: It says delivered but there's nothing here. My front door is green.

QUESTION:  "What most likely happened to this parcel?"
OPTIONS:   Delivered / Wrong address / Stolen / Unclear

ANSWER:    Wrong address 97%   (the other three share the last 3%)
```

That's the whole interface. The rest of the session explains how it gets that 97%, and how we check it.

### 1.2 Why "System One"?

> **Say it in one line:** System 1 is your fast gut decision, System 2 is slow careful reasoning. Jev is built to be a very fast, very consistent gut.

The name comes from Daniel Kahneman's book *Thinking, Fast and Slow*:
- **System 1** is fast and automatic. You recognise a face, read a stop sign, sense that an email looks like a scam.
- **System 2** is slow and deliberate. You do long division, plan a trip, write an essay.

Chat models like ChatGPT or Claude act more like System 2: they "think out loud" by writing text. Jev covers the System 1 job: **small, bounded judgements, made instantly, many times over.**

TypeSafe's own advice follows from that:
- **Keep each question atomic.** One judgement per question. "Is there a receipt?" is good. "Is there a receipt and is it within 14 days and is the item unopened?" is bad.
- **Combine the answers in your own code.** Jev answers the small questions, your program applies the business logic.
- **Escalate the unclear cases** to a person or to a reasoning model (System 2).

### 1.3 The three question types

> **Say it in one line:** Yes/no, pick one, or rate on a scale. Every question is one of these three.

| Type | Plain English | What comes back | Example from this repo |
|---|---|---|---|
| **Noul** | a yes/no question | one number, 0 to 1: the chance the answer is yes | "Does the customer have a receipt?" → a number near 0 means no |
| **Choice** | pick one of several options | a probability per option, adding up to 100% | "Which team should handle this?" → Technical 93%, the rest split between Billing and Sales |
| **Score** | rate on ordered levels | a probability per level | "How urgent is this?" → Can wait / This week / Today / Right now |

About **noul** (the name isn't explained anywhere, so treat it as just a name):
- 0.92 means "92% likely yes". It does **not** mean "92% strong" or "very Python-y". TypeSafe's docs warn about this directly: if you want *how much*, use a Score.
- You can add `criteria` that spell out what counts as true and false. Example: true = "mentions a prior attempt or ticket", false = "no sign of previous contact".

About **score**: levels are ordered from lowest to highest. Because they're ordered, "Today" vs "Right now" is a near miss, while "Can wait" vs "Right now" is far off. Jev's confidence measure (1.5) takes that into account.

You can ask many questions about the same text in one request. Jev answers each one **separately and in parallel**, so the answers don't influence each other and adding questions barely adds time.

### 1.4 How it actually reaches a decision

> **Say it in one line:** It's a language model, but we never let it write. We show it a multiple-choice question and measure how strongly it leans towards each letter, in a single step.

TypeSafe hasn't published how Jev works inside. **JevK5** is an independent open model built to behave like Jev and answer the same three question types, and its method is public. This repo runs JevK5 on a laptop. Here's how it works, step by step.

#### Step 0 — Background: what a language model does

A language model reads text and, at every point, predicts **what comes next**. Text is split into small pieces called **tokens** (roughly a word or part of a word). For every token it knows, the model produces a raw score called a **logit**. A higher logit means the model thinks that token is more likely to come next.

Normally a chatbot picks a token, adds it to the text, and repeats this hundreds of times. That's how it "writes". JevK5 stops after the first step.

#### Step 1 — Turn the question into a multiple-choice exam

The text, the question and the options are laid out in a fixed template, and **each option gets a letter**:

```
<the state text>

Question: What most likely happened to this parcel?
A) Delivered — It reached the customer
B) Wrong address — It was left at a different address
C) Stolen — It was delivered correctly, then taken
D) Unclear — Not enough information to tell
Answer:
```

(This shows the idea, not the exact template. JevK5 says its prompt and readout are adapted from an earlier project called SemIf.)

**Why letters?** However long an option's description is, its letter is **one token**. So the model can "answer" with a single token, and all the options get scored at once.

#### Step 2 — One forward pass, zero words written

The model reads the whole prompt once. That's called a **forward pass**. At the position right after `Answer:`, it holds a logit for every token it knows, including `A`, `B`, `C` and `D`.

JevK5 generates **zero tokens**. It never writes anything. That's why it's fast: about 13 ms per short decision on a datacenter GPU, and 1–2 seconds on a 4 GB laptop GPU.

#### Step 3 — Read only the answer letters

Throw away every logit except the ones for the answer letters. Turn those few numbers into percentages that add up to 100% using **softmax**, a standard formula that makes big numbers bigger and small ones smaller, and always sums to 1.

```
logits:  A = 1.1   B = 5.2   C = 1.6   D = 0.4
softmax: A = 2%    B = 95%   C = 3%    D = 1%      ← illustrative numbers
```

Analogy: a student sitting a multiple-choice exam. We don't wait for them to write anything. We measure how much they lean towards each box before the pen touches paper.

#### Step 4 — Calibrate: make the percentages honest

A raw model is often **overconfident**: it says 99% when it's really right 85% of the time. That makes the number useless for decisions.

The fix is **temperature**. Divide every logit by one number before the softmax:
- temperature > 1 pulls the percentages towards each other (less sure)
- temperature < 1 pushes them apart (more sure)

JevK5 fitted that single number on questions from three topic areas it had **never seen in training**: 1.22 for the 4B model we use. This repo uses that value (`jevxray/backends/jevk5.py`).

**What "calibrated" means:** of all the answers given at about 80%, about 80% should be right. It's a property of **many answers together**, not a promise about any single one. TypeSafe says the same about Jev: "calibration does not guarantee that an individual answer is correct."

JevK5's author also tried a separate temperature per question type, and averaging over two option orders. Both were tested on held-out data and rejected as not worth it.

#### Step 5 — More than 16 options: a knockout tournament

The model answers with one of 16 letters, so one pass covers up to 16 options. With more:
1. Split the options into groups of up to 16 and score each group.
2. Take the best options from every group into a final of 16.
3. Combine the group results with the final, then sharpen with a second temperature (0.93 for the 4B model).

That costs ⌈options ÷ 16⌉ + 1 passes. The author says this second temperature never changes which option wins.

#### How each question type uses this

- **Choice:** the letters are the options. Read the letters and you're done.
- **Noul:** two options, true and false. Report P(true).
- **Score:** the levels get letters, lowest first. You get a probability per level.

#### How JevK5 was trained (for the curious)

- **Base model:** Qwen3.5, an open model. JevK5 is a **LoRA** fine-tune of it: a small add-on of extra weights trained on top, instead of retraining the whole model.
- **Teacher questions:** a larger model (Qwen3.6-27B) wrote documents with three hard typed questions each. Each question was answered twice independently and **kept only if both answers matched**. Version 0.3 adds about 14,000 questions written by GPT-6 Luna.
- **Human-labelled data:** about 30,000 items from the training splits of 26 public datasets. No test data was used.
- **Objective:** make the model put high probability on the correct letter (cross-entropy on the letter logits).
- **How it compares:** on JevBench, the 0.2 version ranked 2nd of 76 systems, with 62.04 against Jev's 63.29. It's English only and handles up to 16,384 tokens of input.

#### Hosted Jev

Jev takes the same request (`state` + `questions`, sent to `POST /v1/systemone`) and returns the same kind of answer. **Its architecture is unpublished.** Everything in this repo only uses what goes in and what comes out, so it works the same with either model.

### 1.5 Confidence: the second number

> **Say it in one line:** The probability says *which* answer; confidence says *how clear-cut* the choice was. Use it to decide when to act on your own and when to ask a human.

For choice and score questions, Jev also returns a **confidence** between 0 and 1. It's computed from the probabilities:
- **Choice:** confidence = (top probability − 1/n) ÷ (1 − 1/n), where n is the number of options.
  - All the weight on one option gives 1. An even spread gives 0.
  - Example with 3 options and a top answer of 60%: (0.6 − 0.33) ÷ (1 − 0.33) = **0.4**.
  - Only the top probability counts, so 60/30/10 and 60/20/20 both give 0.4.
- **Score:** like choice, except probability on a *neighbouring* level costs less confidence than probability far away.
- **Noul:** no separate confidence is returned. If you want one, use |2p − 1|: p = 0.9 gives 0.8, and p = 0.5 gives 0.

This drives a pattern TypeSafe calls **confidence-gated routing**:
- above a high bar → act automatically
- below a low bar → reject automatically
- in between → send to a person

Where you put the bars depends on what a mistake costs. A wrong refund is cheap; a wrongly rejected job candidate isn't.

### 1.6 Why Jev is more than a classifier

> **Say it in one line:** A classifier learns fixed labels from examples. Jev reads the question, the options and the rules **in the request**, every time.

A traditional **classifier** (spam filter, sentiment model, ticket router):
- learns a **fixed** set of labels from thousands of labelled examples
- needs new data and retraining to add or change a label
- learns surface patterns of each label ("refund" tickets often contain "money back")
- can't read a rule you hand it at run time

**Jev:**
- gets the question and options **with each request**. Change "Billing / Technical / Sales" to "Billing / Technical / Sales / Legal" by editing a string. No retraining.
- **reads rules that sit inside the text and applies them.** This is the big one.

The refund case shows it. The policy is part of the text:

```
1. With a receipt: unopened items can be returned within 30 days for a full refund.
2. Without a receipt: unopened items can be exchanged for store credit within 14 days.
   After 14 days, no return.
3. Opened items can never be returned.

Customer: I bought these headphones 12 days ago. The box is still sealed,
but I lost the receipt. Can I get my money back?
```

Nobody trained a "refund classifier" for this shop. To answer **Store credit**, the model has to:
1. notice there's no receipt → rule 2, not rule 1
2. notice 12 days < 14 days → still inside the window
3. notice the box is sealed → rule 3 doesn't block it

That's reasoning: several facts combined with written rules. Jev just never writes it down. (Part 2 shows where this breaks. Spoiler: the 14-day cutoff.)

### 1.7 Why Jev is not just a chat LLM

> **Say it in one line:** A chat model writes words for people. Jev returns numbers for software.

| | Chat LLM (ChatGPT, Claude…) | Jev |
|---|---|---|
| **Output** | free text, written token by token | a probability per option, in one step |
| **Using the answer** | parse text: "I'd say this is probably a billing issue…" | the answer *is* the data: `Billing: 0.06` |
| **Can it go off-script?** | yes: new options, made-up facts, a refusal | no: it can only pick from your options |
| **"How sure?"** | words like "probably", or overconfident | a calibrated number you can threshold |
| **Consistency** | wording varies between runs | same input, same output (true for JevK5 locally; TypeSafe doesn't state it for hosted Jev) |
| **Speed and cost** | seconds, priced per token written | milliseconds, nothing written |
| **Explains itself?** | yes, though the explanation may not be the real reason | **no, never** |

TypeSafe's own comparison claims about 194× faster and 445× cheaper on their benchmark workflows. Those are vendor numbers, so present them as claims.

TypeSafe also says "zero hallucinations". The fair reading: Jev **can't invent** anything, because it can only choose among your options. It can still **choose wrong**.

**The last row is why this repo exists.** A chat model at least gives a reason, even if the reason isn't trustworthy. Jev gives only a number.

### 1.8 Where Jev fits: use cases

> **Say it in one line:** Anywhere software makes a judgement call over text thousands of times a day, and you can write down what the options are.

| Area | Example questions | Type |
|---|---|---|
| **Customer support** | Which team? How urgent? Is the customer asking for a human? Have they contacted us before? | choice, score, noul |
| **Policies and claims** | Refund, credit or refuse? Is this claim covered by the policy text? | choice |
| **Trust and safety** | Is this a scam? Does it ask for bank details? How abusive is it? | noul, score |
| **Hiring** | Does the CV meet each must-have? (one noul per requirement) Is this a duplicate application? | noul |
| **Operations** | Do the two addresses match? Was the customer charged? | noul |
| **Intent routing** | What does the user want? Send them to the right handler. | choice |
| **Judging AI output** | Does this chatbot answer follow the instructions? Is it on topic? | noul, score |
| **Composite scores** | Rate a lead on 5 separate dimensions and combine them in code | score × 5 |

TypeSafe's suggested patterns, in plain words:
- **Speculative fan-out:** ask many questions in one call, including ones you might not need, and let your code pick. It's cheap because they run in parallel.
- **Confidence-gated routing:** act, reject or escalate based on confidence (1.5).
- **Composite scoring:** several small scores combined into one.
- **Intent routing:** classify, then dispatch.

What it **can't** do: write replies, generate code, explain itself, read images, audio or video, or answer outside the options you give it.

### 1.9 The problem this repo solves

> **Say it in one line:** A probability is easy to act on and impossible to question, so we question it from the outside.

"Wrong address, 97%." Why? Which part of the text mattered? Would it say the same if the name were different? If the date were different?

Jev won't tell you, and we can't open it up: hosted Jev is a black box, and even with JevK5, billions of weights don't explain anything.

**The idea: treat it like an experiment.**
1. Ask the question on the original text → note the number.
2. Change **one** thing in the text → ask again → note the number.
3. Everything else stayed the same, so the difference comes from what you changed.

This works because the model is **consistent**: the same input always gives the same output. If it answered randomly, you couldn't tell your change from noise.

Changing words doesn't help Jev decide. **It shows us what Jev decided on.** We use three kinds of change, plus extra questions:

| Tool | What we change | What it tells us | Human analogy |
|---|---|---|---|
| **Why (X-ray)** | delete one piece of text at a time | what the answer leans on | "Would you still say that if I hadn't told you X?" |
| **What flips it** | delete the fewest pieces possible to change the answer | how fragile the decision is | "What's the least I'd have to take away to change your mind?" |
| **Swap test** | replace one thing (name, date, stack) with alternatives | does it react to what it should, and ignore what it shouldn't? | a blind audition: same performance, different name |
| **Checks** | nothing; ask extra small questions about the same text | what it believes about each fact | quizzing someone on the facts after they gave a verdict |

---

## Part 2 — The code, in Jev terms (13 min)

> **Say it in one line:** The whole repo is three experiments built on one function: "ask Jev this question about this text".

Read in this order. Each step answers one question.

```
question.py   "What do we ask?"          → the typed question, reduced to one number
backends/     "How do we ask?"           → Backend.read(text, question) → probabilities
text.py       "What can we change?"      → cut the text into removable pieces
probes/       "What do we learn?"        → xray (lean on), flip (fragility), swap (fairness and rules)
scenarios/    the four stories
experiments/  the swap test at scale
```

### 2.1 "What do we ask?" — `jevxray/question.py` (2 min)

**`Question`**: one Jev question, exactly the three types from Part 1.

```python
Question(kind="choice",
         instructions="What most likely happened to this parcel?",
         criteria={"Delivered": "...", "Wrong address": "...", "Stolen": "...", "Unclear": "..."})
```

- **Checks itself when created.** Unknown type, empty question, a choice with fewer than 2 options, a score with fewer than 2 levels, or a target that isn't one of the options: each raises a clear error.
- **`option_ids`**: the names of the possible answers. A yes/no becomes `true` and `false`. Score levels become `"0"`, `"1"`, `"2"`… lowest first.
- **`target_id`**: which answer we're *watching*. For yes/no it's `true`; for a choice, the option you pick (or the first); for a score, the expected level.
- **`value(probs)`**: **the most important function for the experiments.** It reduces Jev's whole answer to **one number between 0 and 1**, the needle we watch move:
  - yes/no → P(yes)
  - choice → P(the watched option), e.g. P(Wrong address) = 0.97
  - score → the **expected level**, scaled to 0..1. With levels 0–3 and probabilities 10% / 20% / 50% / 20%, the expected level is 0×0.1 + 1×0.2 + 2×0.5 + 3×0.2 = 1.8, so the value is 1.8 ÷ 3 = 0.6. The page shows this as "2.8 of 4".
- **`wire()`**: the question exactly as Jev's API expects it (`type`, `instructions`, `criteria`).
- **`from_dict()`**: builds a Question from the JSON in a scenario file or a web request.

**Why one number?** Each experiment is "did this change move the answer?". That needs a single gauge to compare, before and after.

### 2.2 "How do we ask?" — `jevxray/backends/` (2 min)

**`base.py`**: the heart of it.
- **`Backend.read(text, question)`** is the **only** way any other code talks to the model. Text and question go in; a **`Reading`** comes out:
  - `probs`: probability per option
  - `value`: the single number from `Question.value()`
  - `seconds`: how long the call took
  - `cached`: whether it came from the cache
- Inside `read()`: check the cache → if missing, ask the model → time it → store it → return.
- **`read_many(texts, question)`**: the **same question** on **many versions** of the text. Every experiment does exactly this: dozens of near-identical texts. If the model allows parallel calls (hosted Jev does, 8 at a time), they run in parallel. Results arrive in the order they finish, so the page can update live.
- **`info()`**: which model is answering, shown in the page header.
- A new model needs only one function, `_probabilities(text, question)`. Nothing else changes.

**The three models it can talk to:**
- **`jevk5.py`**: JevK5 running locally through `llama-server` (part of llama.cpp, a program that runs models on ordinary hardware). The `jevk5` client does Part 1's steps 1–5: template, letters, single pass, temperature, knockout. This file just passes the question through and reads back the probabilities. The two temperatures, 1.22 and 0.93, are the published values for the 4B model.
- **`typesafe.py`**: hosted Jev. Sends `{"state", "questions"}` to `POST /v1/systemone`. If the service is busy (429, 500, 502, 503, 529), it waits and retries, doubling the wait each time (1 s, 2 s, 4 s…). A yes/no answer arrives as one number (`noul: 0.92`) and is turned into `{true: 0.92, false: 0.08}`, so all three types look alike to the rest of the code.
- **`fake.py`**: a pretend model for tests. It counts overlapping words. **Its answers mean nothing**; it exists so the tests and the page work without downloading anything.

**`__init__.py` → `make_backend(name)`**: picks the model by name or from the `JEVXRAY_BACKEND` setting, and gives it the shared cache. The fake model gets no cache.

**`cache.py` → `Cache`**: a small database file on disk (`~/.cache/jev-xray/answers.db`).
- The key is a fingerprint (SHA-256) of: model name + text + question.
- The same question on the same text never costs a second call.
- **This is only correct because the model is consistent.** A model that varied would make caching wrong.
- It's also why a demo you've rehearsed answers instantly on stage.

### 2.3 "What can we change?" — `jevxray/text.py` (2 min)

To ask "what if this part weren't there?", we cut the text into pieces we can remove cleanly.

- **`Segment`**: one piece of text, plus where it starts and ends in the original. The positions let the page highlight the exact characters. `as_dict()` packages it for the page.
- **`segments(text, granularity)`**: three ways to cut:
  - **`word`**: every word separately. Fine-grained, but many calls.
  - **`phrase`**: ends at `, ; : . ! ?`. The usual choice: big enough to mean something, small enough to point at.
  - **`sentence`**: ends at `. ! ?`. Fewest calls, coarsest.
  - It's careful with numbers and abbreviations: `2:14`, `1,000` and `No.17` stay whole, because punctuation only ends a piece when a space follows.
- **`_attach_labels()`**: keeps a short label like `Customer address:` together with its value, `71 Elm Street`. On its own a label means nothing, and removing it would only test how confused the model gets by a dangling address.
- **`without(text, parts, drop)`**: returns the text with the chosen pieces removed and the spacing tidied, so no double spaces and no space before a comma. The model should see clean text, not a visible hole; a hole is itself a change and would muddy the result.

Example, by phrase:

```
"Hi Sarah, please confirm your details: it takes a minute."
 → ["Hi Sarah,"] ["please confirm your details:"] ["it takes a minute."]
```

### 2.4 The three experiments — `jevxray/probes/` (6 min, the core)

> **Say it in one line:** Each probe asks Jev the same question many times on slightly different texts, then compares the answers.

Each probe is a **generator**: it produces results one at a time, as they're measured. That's how the page can colour each word the moment its answer comes back, instead of making you wait a minute.

#### a) Why (X-ray) — `xray.py`: what did it lean on?

The method is called **leave-one-out**.

```
base = value(full text)                        # e.g. P(Wrong address) = 0.97
for each piece:
    without_it = value(text with that piece removed)
    effect     = base − without_it
```

How to read an effect, with illustrative numbers:

| Piece removed | P(Wrong address) after | Effect | Meaning |
|---|---|---|---|
| `Customer address: 71 Elm Street` | 0.20 | **+0.77** | big support, the answer leans on it (blue) |
| `My front door is green.` | 0.80 | +0.17 | some support (light blue) |
| `It says delivered but there's nothing here.` | 0.98 | −0.01 | barely matters |
| `The delivery photo shows a blue door.` | 0.99 | −0.02 | slightly against (light red) |

- **Positive effect** (blue): without this piece the answer gets weaker, so the piece was **pushing towards** it.
- **Negative effect** (red): without it the answer gets *stronger*, so it was **pushing away**.
- **Near zero**: removing it alone doesn't change much.

Run the parcel case live for the real numbers; the table only shows how to read them.

**Cost:** 1 call for the original + 1 per piece. 15 phrases = 16 calls ≈ 20–30 seconds locally, and instant the second time thanks to the cache.

**The main caveat: backups.** Suppose two pieces both say "wrong address": the house number *and* the door colour. Remove either one and the other still carries the answer, so **both look unimportant**. A low score means "not needed on its own", not "ignored". That's why we also have…

`collect()` runs any probe to the end and gathers all its results into one dictionary. The tests use it.

#### b) What flips it — `flip.py`: how fragile is the decision?

Find the **fewest deletions** that make a **different answer win**.

1. **Measure:** score every piece on its own (the same scan as X-ray).
2. **Remove:** take out the pieces that supported the answer, strongest first, one more each round, and ask again each time. Stop as soon as a different option comes out on top (or after 30 pieces, `max_removed`).
3. **Trim:** put each removed piece back, one at a time. If the answer *stays* flipped without it, it wasn't needed, so keep it in. What's left is the set you really needed to remove.

The result is **locally minimal**: no single piece in the final set can be put back without undoing the flip. It isn't guaranteed to be the smallest set that exists; finding that would mean trying every combination, which is far too many calls.

This also handles the **backups problem** from X-ray, because it removes pieces *together*.

**Ticket case:** routed to **Technical** at 93%. Delete just `403` and `endpoint.` and it goes to **Billing**. Two words decide which team gets it. For a decision that close to the edge, you'd want a person to look.

`top(probs)` is the option with the highest probability, i.e. the current winner.

#### c) Swap test — `swap.py`: does it react to the right things?

The **counterfactual** test: "what if this one thing had been different?"

1. Pick something in the text (`original`), such as a name, a date or a tech stack.
2. Give groups of replacements, e.g. `{"Anglo": [12 names], "Muslim": [12 names]}`.
3. Build one copy of the text per replacement. **Everything else stays identical.**
4. Ask the same question on every copy, then compare the groups.

Functions:
- **`find()`**: finds every place the original appears, ignoring capital letters and extra spaces.
- **`replace()`**: swaps **every** occurrence, so "Sam Lee… we met Sam Lee" changes in both places.
- **`swap()`**: runs it: the original first, then every replacement.
- **`summarize()`**: per group, the average, lowest, highest and spread, plus **the gap between group averages**.

How to read the result:
- **Should-not-matter swap** (names): you want the groups flat, gap ≈ 0. A big gap = bias.
- **Should-matter swap** (dates past a deadline, wrong tech stack): you want a big drop. No drop = the model isn't applying the rule.

What the four cases show:

| Case | We swap | Result | Verdict |
|---|---|---|---|
| Hiring | candidate's name: 12 Anglo, 12 Muslim | all between 94% and 95% | ✅ ignores who's applying |
| Hiring | React + TypeScript → Angular, Vue, jQuery, Svelte | falls to about 12% | ✅ cares about what the job asked for |
| Refund | "12 days ago" → 16, 25, 40 days ago | **still Store credit, 96% on average** | ❌ reads the date, ignores the 14-day cutoff |

**The refund row is the key moment of the session.** The model's checks get the facts right: "No receipt?" yes, "Within 14 days?" yes for the original 12 days. So it *understands* the date. But at 40 days it still offers store credit. It doesn't *apply* the rule. Without the swap test, you'd never see this.

**Cost:** 1 call + 1 per replacement.

### 2.5 The four cases — `scenarios/*.json` (1 min)

Each file is a ready-made case with these fields:
- `title`, `order`: the name on the page and its position
- `state`: the text
- `question`: the main question
- `checks`: extra small questions about single facts
- `swaps`: swap tests, each with a `label`, the `original` text to replace and the `groups` of replacements
- `granularity`: how to cut the text for X-ray and Flip

| Case | Main question | Checks | Shows |
|---|---|---|---|
| **parcel** | What happened? (4 options) | 3 yes/no: addresses match? door matches? tracking says delivered? | Why: answer rests on the address mismatch |
| **hiring** | Invite to interview? (yes/no) | 2 yes/no (must-haves? nice-to-haves?) + seniority score | Swap: name flat, stack drops |
| **refund** | Refund / credit / refuse? | 3 yes/no: receipt? within 14 days? unopened? | Swap: the missed cutoff |
| **ticket** | Which team? (3 options) | 2 yes/no (charged? error?) + urgency score | Flip: two words change the team |

**About checks:** they're **separate** questions on the same text. Jev won't tell you its reasoning, but it will tell you whether it thinks the addresses match. They show what it **believes about each fact**, not the path it took to the main answer. When the checks and the main answer disagree, as in the refund case, that's a finding.

### 2.6 At scale — `experiments/name_vs_stack/` (1 min)

The hiring swap scaled up into a small study:
- **`cases.py`**: 6 engineering roles (frontend, backend, data, iOS, platform, ML). Each has a CV that clearly meets the must-haves, 24 names (12 Anglo, 12 Muslim) and 4 off-target stacks.
- **`run.py`**: asks "Should this candidate be invited to a first interview?" while changing one thing at a time. 174 calls in total.
  - `bootstrap_ci()`: a **bootstrap confidence interval**. Resample the results thousands of times to see how much the average could move by chance.
  - `chart()`: the two-panel chart in the README.

**Result:**
- Names: Anglo names scored 0.85 points *lower* than Muslim names on average (95% range −1.5 to −0.3). No single name moved the answer more than 4 points.
- Stack: a stack the job didn't ask for dropped the answer by **80 points** on average, at least 71 for every role.
- About **100×** more effect from what should matter than from what shouldn't.

Be honest about scope: one small open model, CVs written by us. It's a check on this model, not a verdict on AI hiring.

### 2.7 Plumbing (mention, don't dwell)

- **`cli.py`**: the same experiments from a terminal. Good for a live code demo:
  `jev-xray xray scenarios/parcel.json` prints the pieces ranked by effect.
- **`server.py`**: runs the experiments behind a small web server and **streams** each result as it arrives (one JSON line per result), so the page fills in live.
- **`web/`**: the page. Plain HTML, CSS and JavaScript, no build step.
- **`tests/`**: checks the text cutting, the question rules, each experiment and the server, all against the fake model.
- **`scripts/start-model.ps1` / `.sh`**: start JevK5 with llama-server.

---

## Part 3 — The web page (7 min)

**Before the session:**
1. `scripts\start-model.ps1` to start JevK5
2. `jev-xray serve` → open http://127.0.0.1:8000
3. Click through all four cases once, so every answer is cached and the demo is instant

If the model won't start: `jev-xray --backend fake serve` still runs the page, but the answers are meaningless. Say so out loud.

**What's on the screen:**
- **Answer**: the winning option and the probability of every option. This is Jev's raw output.
- **What it checked**: the extra small questions, each answered separately. You can add your own.
- **Why**: the X-ray. Blue text pushed towards the answer, red pushed away. Runs by itself when a case loads.
- **What flips it**: the fewest deletions that change the winner.
- **Swap test**: replace one thing with a list of alternatives and chart where each lands.
- Edit the text or the question, and everything asks again.

**Demo script:**

| # | Case | Do | Say |
|---|---|---|---|
| 1 | Missing parcel | let it load | "Here's Jev's raw output: Wrong address, 97%. That's all Jev gives you. Everything else on this page is us asking follow-up questions." |
| 2 | Missing parcel | point at checks, then the blue highlight | "Checks: addresses don't match, door doesn't match. Why: it leaned on the customer's address. That's the reasoning we'd hope for." |
| 3 | Support ticket | What flips it → run | "Technical, 93%. Delete two words and it's Billing. A confident number can still be fragile. This one should go to a human." |
| 4 | Job application | Swap test → Name | "Twelve Anglo names, twelve Muslim names. Flat. Good." |
| 5 | Job application | Swap test → Tech stack | "Change React to Angular: it collapses. It reacts to what the job asked for. Also good." |
| 6 | Refund request | Swap test → Days since purchase | "After 14 days the answer should be No return. It still says Store credit. The checks show it reads the date; the swap shows it doesn't apply the rule. You only find this by testing." |
| 7 | Your own | paste a short text, ask a yes/no question | "Change one word and watch the answer move. That's the whole method." |

---

## Closing (1 min)

1. **Jev** turns text plus a typed question into a calibrated probability per option. It's not a classifier (the options are free text and it reads rules), and it's not a chat model (it never writes).
2. **It decides** by showing a language model a multiple-choice prompt and reading how strongly it leans towards each letter, in one pass, adjusted so the percentages are honest.
3. That makes it **fast, cheap, repeatable and easy to act on**, but it **can't explain itself**.
4. So we **explain it from the outside**: **delete** (what it leans on), **minimal delete** (how fragile it is), **swap** (whether it's fair and applies the rules).
5. Every number on the page is the same function, `Backend.read()`, called on a slightly different text.

### Honest limits

- All results here come from **JevK5 4B, compressed to 4-bit** to fit a laptop. Hosted Jev may answer differently.
- Deleting text measures **what it relies on**, not what it "thinks". Pieces can back each other up.
- Checks are **separate questions**; they don't reveal the path the model took.
- Calibration is about **many answers on average**, never a guarantee for one answer.
- The hiring study is **one model on CVs we wrote**.

---

## Likely questions and answers

**"Isn't this just a classifier with extra steps?"**
No. A classifier's labels are fixed when it's trained. Jev's options arrive with each request, and it applies rules written in the text (the refund policy). Change the options and it works immediately, with no retraining.

**"Why not just ask ChatGPT and have it explain?"**
You can, but you get text you have to parse, a different wording each run, no reliable number to threshold on, and an explanation that may not be the real reason the model answered as it did. Jev gives a clean number; we get the "why" by experiment instead of by asking.

**"Is the 97% real? Can I trust it?"**
It's calibrated, which means *on average*: of all answers given at 97%, about 97% should be right. It isn't a promise for any one case. TypeSafe says this explicitly. Test thresholds on your own data.

**"Does it give the same answer every time?"**
JevK5 locally: yes, same text and question give the same numbers on the same machine and model file. That's what makes the cache and the experiments valid. Hosted Jev: TypeSafe doesn't state it in the docs.

**"How long does the X-ray take?"**
One call per piece, plus one. Locally that's 1–2 seconds per call on a laptop GPU; with hosted Jev this repo sends 8 at once. Results are cached, so the second run is instant.

**"Why delete text instead of looking at attention or the model's weights?"**
It works on any model through the same API, including hosted Jev, which we can't open. And it answers a plain question everyone understands: "does the answer change without this?"

**"Couldn't removing a phrase confuse the model rather than remove information?"**
Partly, yes. That's why `without()` tidies the text, and why labels stay attached to their values. It's also why we cross-check with Flip and Swap rather than trusting one tool.

**"So is Jev biased in hiring?"**
On our test, names moved the answer by under 1 point on average; the stack moved it 80. That's reassuring for *this* model on *these* CVs. It's not proof for every case. The tool exists so you can run the check on yours.

**"What happens with more than 16 options?"**
A knockout tournament: groups of 16, then a final of the group winners. Section 1.4, step 5.

**"Where would I use this at work?"**
Anywhere a decision over text is made thousands of times: routing, triage, policy checks, moderation, screening. Use confidence to decide when to act on your own and when to ask a person, and use these probes before going live to check it reacts to the right things.

---

## Glossary

| Term | Plain meaning |
|---|---|
| **State** | the text Jev judges |
| **Noul / Choice / Score** | yes-no / pick one / rate on ordered levels |
| **Criteria** | the options (choice), the levels (score), or what counts as yes and no (noul) |
| **Token** | a small piece of text, about a word, that a language model reads and predicts |
| **Logit** | the model's raw score for "this token comes next"; higher = more likely |
| **Forward pass** | the model reading the input once, start to end |
| **Softmax** | the formula that turns raw scores into percentages that add up to 100% |
| **Temperature** | a single number that makes percentages more spread out (>1) or sharper (<1) |
| **Calibrated** | the percentages match reality on average: 80% answers are right 80% of the time |
| **Confidence** | how one-sided the answer is, from 0 (even spread) to 1 (all on one option) |
| **LoRA** | a cheap way to fine-tune a big model by training a small add-on |
| **Knockout** | the tournament used when there are more than 16 options |
| **Leave-one-out** | remove one piece, ask again, compare (the X-ray) |
| **Counterfactual** | "what if this one thing were different?" (the swap test) |
| **Locally minimal** | can't be made smaller by putting back any single piece |
| **Bootstrap CI** | resampling the results many times to see how much an average could move by chance |
| **System 1 / System 2** | fast intuitive judgement / slow deliberate reasoning (Kahneman) |
