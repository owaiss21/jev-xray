const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const h = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const S = {
  scenarios: [],
  id: null,
  text: "",
  question: null,     // {type, instructions, criteria?}
  checks: [],         // [{type, instructions, criteria?}]
  swaps: [],          // [{label, original, groups}]
  granularity: "phrase",
  answer: null,       // probs of the main question
  checkAnswers: [],
  tool: "why",
  overlay: null,      // what the document shows: {kind: "why"|"flip", segments, effects?, removed?}
  results: {},        // last result per tool, so switching tabs keeps them
  swapIndex: 0,
  customSwap: null,
  autoWhy: false,     // explain the first answer of a built-in scenario without waiting for a click
};

/* ---------- small helpers ---------- */

const pct = (p) => (p > 0 && p < 0.01 ? "<1%" : p > 0.99 && p < 1 ? ">99%" : `${Math.round(p * 100)}%`);
const pts = (d) => `${d >= 0 ? "+" : "−"}${Math.abs(d * 100) < 10 ? Math.abs(d * 100).toFixed(1) : Math.round(Math.abs(d * 100))}`;
const topOf = (probs) => Object.keys(probs).reduce((a, b) => (probs[b] > probs[a] ? b : a));
const quote = (t, n = 48) => `“${esc(t.length > n ? t.slice(0, n - 1) + "…" : t)}”`;

function optionIds(q) {
  if (q.type === "noul") return ["true", "false"];
  if (q.type === "score") return q.criteria.map((_, i) => String(i));
  return Object.keys(q.criteria);
}
function optionName(q, id) {
  if (q.type === "noul") return id === "true" ? "Yes" : "No";
  if (q.type === "score") return q.criteria[+id];
  return id;
}
// Score questions are explained through the level that won, asked as a yes/no-style target.
function wire(q, target) {
  const out = { type: q.type, instructions: q.instructions };
  if (q.criteria) out.criteria = q.criteria;
  if (target !== undefined && q.type !== "score") out.target = target;
  return out;
}

const tip = $("#tooltip");
function showTip(e, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX + 12, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.min(e.clientY + 14, innerHeight - r.height - 8) + "px";
}
const hideTip = () => (tip.hidden = true);
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  if (t) showTip(e, esc(t.dataset.tip));
});
document.addEventListener("mouseout", (e) => e.target.closest("[data-tip]") && hideTip());

/* ---------- network ---------- */

async function errorText(res) {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d) => d.msg).join(". ");
  } catch {}
  return `Server error ${res.status}`;
}

async function stream(url, body, onEvent, signal) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(await errorText(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.event === "error") throw new Error(ev.message);
      onEvent(ev);
    }
  }
}

const controllers = {};
function cancel(name) {
  controllers[name]?.abort();
  controllers[name] = null;
}

/* ---------- scenarios ---------- */

async function boot() {
  try {
    const info = await (await fetch("/api/health")).json();
    $("#model span").textContent = info.backend === "fake" ? "test model, not real" : info.model.replace(/\.gguf$/, "");
    $("#model").classList.add("ok");
  } catch {
    $("#model span").textContent = "offline";
    $("#model").classList.add("down");
  }
  S.scenarios = await (await fetch("/api/scenarios")).json();
  const nav = $("#scenarios");
  nav.innerHTML = "";
  for (const s of S.scenarios) nav.append(h(`<button data-id="${s.id}">${esc(s.title)}</button>`));
  nav.append(h(`<button data-id="own">Your own</button>`));
  $$("button", nav).forEach((b) => (b.onclick = () => load(b.dataset.id)));
  load(S.scenarios[0].id);
}

function load(id) {
  const s = id === "own"
    ? { state: "", question: { type: "noul", instructions: "" }, checks: [], swaps: [], granularity: "phrase" }
    : structuredClone(S.scenarios.find((x) => x.id === id));
  cancel("asking");
  cancel("running");
  Object.assign(S, {
    id, text: s.state, question: s.question, checks: s.checks || [], swaps: s.swaps || [],
    granularity: s.granularity || "phrase", answer: null, checkAnswers: [], overlay: null, results: {},
    swapIndex: s.swaps?.length ? 0 : "custom", customSwap: null, autoWhy: id !== "own",
  });
  $$("#scenarios button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.id === id)));
  renderDoc();
  renderQuestion();
  renderChecks();
  renderTool();
  editCase(id === "own");
  editQuestion(id === "own");
  if (id !== "own") ask();
}

/* ---------- case document ---------- */

function renderDoc() {
  const doc = $("#doc");
  const o = S.overlay;
  $("#doc-legend").hidden = !o || o.kind !== "why";
  if (!o) {
    doc.textContent = S.text || "Press Edit to write a case.";
    doc.style.color = S.text ? "" : "var(--ink-3)";
    return;
  }
  doc.style.color = "";
  doc.innerHTML = "";
  let cursor = 0;
  const scale = o.effects ? Math.max(0.04, ...Object.values(o.effects).map(Math.abs)) : 1;
  for (const seg of o.segments) {
    if (seg.start > cursor) doc.append(S.text.slice(cursor, seg.start));
    const span = h(`<span class="seg"></span>`);
    span.textContent = S.text.slice(seg.start, seg.end);
    if (o.kind === "why") {
      const e = o.effects[seg.i];
      if (e === undefined) span.classList.add("wait");
      else {
        const a = Math.min(1, Math.abs(e) / scale) * 0.6;
        span.style.backgroundColor = `rgba(var(${e >= 0 ? "--pos" : "--neg"}), ${a.toFixed(3)})`;
        span.onmousemove = (ev) => showTip(ev, `Without this, <b>${esc(o.label)}</b> would be ${pct(o.values[seg.i])} (${pts(-e)} pts)`);
        span.onmouseleave = hideTip;
      }
    } else if (o.removed?.includes(seg.i)) span.classList.add("cut");
    doc.append(span);
    cursor = seg.end;
  }
  if (cursor < S.text.length) doc.append(S.text.slice(cursor));
  if (o.kind === "why") {
    $("#doc-legend").innerHTML = `<span><i style="background:rgb(var(--pos))"></i>supports ${esc(o.label)}</span><span><i style="background:rgb(var(--neg))"></i>works against it</span><span>hover for numbers</span>`;
  }
}

function editCase(on) {
  $("#doc").hidden = on;
  $("#doc-edit").hidden = !on;
  $("#edit-case").textContent = on ? "Done" : "Edit";
  if (on) {
    $("#doc-edit").value = S.text;
    $("#doc-edit").focus();
  }
}

let typing = null;
$("#doc-edit").addEventListener("input", () => {
  S.text = $("#doc-edit").value;
  S.overlay = null;
  for (const r of Object.values(S.results)) r.stale = true;
  renderTool();
  clearTimeout(typing);
  typing = setTimeout(ask, 700);
});
$("#edit-case").onclick = () => {
  const on = $("#doc-edit").hidden;
  editCase(on);
  if (!on) renderDoc();
};

/* ---------- question ---------- */

function renderQuestion() {
  const q = S.question;
  $("#question-text").textContent = q.instructions || "No question yet";
  const v = $("#verdict");
  const box = $("#options");
  if (!S.answer) {
    v.innerHTML = `<span class="answer" style="color:var(--ink-3)">${q.instructions && S.text.trim() ? "Thinking…" : "Waiting for a case and a question"}</span>`;
    box.innerHTML = "";
    return;
  }
  const probs = S.answer;
  const top = topOf(probs);
  v.innerHTML = `<span class="answer">${esc(optionName(q, top))}</span><span class="pct num">${pct(probs[top])}</span>`;
  box.innerHTML = optionIds(q)
    .map((id) => {
      const on = id === top ? "top" : "";
      return `<span class="label ${on}">${esc(optionName(q, id))}</span>
        <div class="track"><div class="fill ${on}" style="width:${(probs[id] * 100).toFixed(1)}%"></div></div>
        <span class="p num">${pct(probs[id])}</span>`;
    })
    .join("");
}

function editQuestion(on) {
  const box = $("#question-editor");
  box.hidden = !on;
  $("#edit-question").textContent = on ? "Close" : "Edit";
  if (!on) return;
  const q = S.question;
  let type = q.type;
  let text = q.instructions;
  let rows = q.type === "choice" ? Object.keys(q.criteria) : q.type === "score" ? [...q.criteria] : [];
  const draw = () => {
    box.innerHTML = "";
    const ed = h(`<div class="qedit">
      <label>Question<input id="qe-text" placeholder="e.g. Is this email a scam?"></label>
      <div class="seg-ctl" id="qe-type">
        <button type="button" data-t="noul">Yes / no</button><button type="button" data-t="choice">Options</button><button type="button" data-t="score">Scale</button>
      </div>
      <div class="opt-rows" id="qe-rows"></div>
      <div class="row-end"><button class="primary" type="button" id="qe-save">Ask</button></div>
    </div>`);
    box.append(ed);
    const input = $("#qe-text", ed);
    input.value = text;
    input.oninput = () => (text = input.value);
    input.onkeydown = (e) => e.key === "Enter" && $("#qe-save", ed).click();
    $$("#qe-type button", ed).forEach((b) => {
      b.classList.toggle("on", b.dataset.t === type);
      b.onclick = () => {
        type = b.dataset.t;
        rows = type === "choice" ? ["", ""] : type === "score" ? ["Low", "Medium", "High"] : [];
        draw();
      };
    });
    const list = $("#qe-rows", ed);
    if (type !== "noul") {
      rows.forEach((r, i) => {
        const row = h(`<div class="opt-row"><input placeholder="${type === "score" ? `Level ${i + 1}` : `Option ${i + 1}`}"><button type="button" aria-label="Remove">×</button></div>`);
        $("input", row).value = r;
        $("input", row).oninput = (e) => (rows[i] = e.target.value);
        $("button", row).onclick = () => { rows.splice(i, 1); draw(); };
        list.append(row);
      });
      const add = h(`<button type="button" class="link">+ ${type === "score" ? "level (lowest first)" : "option"}</button>`);
      add.onclick = () => { rows.push(""); draw(); };
      list.append(add);
    }
    $("#qe-save", ed).onclick = () => {
      const clean = rows.map((r) => r.trim()).filter(Boolean);
      if (!text.trim()) return input.focus();
      if (type !== "noul" && new Set(clean).size < 2) return list.querySelector("input")?.focus();
      const old = (S.question.type === "choice" && S.question.criteria) || {};
      S.question = { type, instructions: text.trim() };
      if (type === "choice") S.question.criteria = Object.fromEntries(clean.map((k) => [k, old[k] || k]));
      if (type === "score") S.question.criteria = clean;
      S.answer = null;
      S.results = {};
      S.overlay = null;
      S.autoWhy = S.id !== "own";
      editQuestion(false);
      renderDoc();
      renderTool();
      ask();
    };
    if (!text) input.focus();
  };
  draw();
}
$("#edit-question").onclick = () => editQuestion($("#question-editor").hidden);

/* ---------- checks ---------- */

function chipFor(q, probs) {
  if (!probs) return `<span class="chip wait">…</span>`;
  const top = topOf(probs);
  const cls = q.type === "noul" ? (top === "true" ? "yes" : "no") : "";
  return `<span class="chip ${cls}">${esc(optionName(q, top))}<span class="num">${pct(probs[top])}</span></span>`;
}

function renderChecks() {
  const ul = $("#checks");
  ul.innerHTML = "";
  S.checks.forEach((c, i) => {
    const li = h(`<li><span class="q">${esc(c.instructions)}</span>${chipFor(c, S.checkAnswers[i])}<button class="x" aria-label="Remove">×</button></li>`);
    $(".x", li).onclick = () => { S.checks.splice(i, 1); S.checkAnswers.splice(i, 1); renderChecks(); };
    ul.append(li);
  });
  if (!S.checks.length) ul.append(h(`<li><span class="q" style="color:var(--ink-3)">Ask about single facts in the case to see what the decision rests on.</span></li>`));
}

$("#add-check").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("#new-check").value.trim();
  if (!text || !S.text.trim()) return;
  $("#new-check").value = "";
  const q = { type: "noul", instructions: text };
  S.checks.push(q);
  S.checkAnswers.push(null);
  const i = S.checks.length - 1;
  renderChecks();
  try {
    await stream("/api/ask", { state: S.text, questions: [wire(q)] }, (ev) => (S.checkAnswers[i] = ev.probs));
  } catch {}
  renderChecks();
};

/* ---------- asking: the decision and its checks ---------- */

async function ask() {
  renderQuestion();
  if (!S.text.trim() || !S.question.instructions) return;
  cancel("asking");
  const ctl = (controllers.asking = new AbortController());
  $(".decision").classList.toggle("busy", !!S.answer);
  if (!S.answer) renderQuestion();
  S.checkAnswers = S.checks.map(() => null);
  renderChecks();
  const auto = S.autoWhy;
  S.autoWhy = false;
  try {
    await stream("/api/ask", { state: S.text, questions: [S.question, ...S.checks].map((q) => wire(q)) }, (ev) => {
      if (ev.i === 0) {
        S.answer = ev.probs;
        $(".decision").classList.remove("busy");
        renderQuestion();
        renderTool();
      } else {
        S.checkAnswers[ev.i - 1] = ev.probs;
        renderChecks();
      }
    }, ctl.signal);
    if (auto && S.tool === "why" && !controllers.running && !S.results.why) runWhy();
  } catch (err) {
    if (err.name !== "AbortError") $("#verdict").innerHTML = `<div class="error">${esc(err.message)}</div>`;
  } finally {
    if (controllers.asking === ctl) $(".decision").classList.remove("busy");
  }
}

/* ---------- tools ---------- */

$$("#tool-tabs button").forEach((b) => (b.onclick = () => {
  S.tool = b.dataset.tool;
  $$("#tool-tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  S.overlay = S.results[S.tool]?.overlay || null;
  renderDoc();
  renderTool();
}));

function granularityPicker() {
  return `<select class="inline" id="gran" aria-label="Detail">
    ${["word", "phrase", "sentence"].map((g) => `<option value="${g}" ${g === S.granularity ? "selected" : ""}>by ${g}</option>`).join("")}
  </select>`;
}

function renderTool() {
  const box = $("#tool");
  const q = S.question;
  const ready = S.answer && S.text.trim();
  const running = controllers.running?.tool === S.tool;
  const r = S.results[S.tool];
  const go = `<button class="primary" id="go" ${ready || running ? "" : "disabled"}>${running ? "Stop" : "Run"}</button>`;
  let head = "";

  if (S.tool === "why") {
    const top = S.answer ? topOf(S.answer) : null;
    const opts = S.answer && q.type !== "score"
      ? optionIds(q).map((id) => `<option value="${esc(id)}" ${id === (r?.target ?? top) ? "selected" : ""}>${esc(optionName(q, id))}</option>`).join("")
      : "";
    head = `<div class="tool-row">${opts ? `What made it say <select class="inline" id="why-target">${opts}</select>` : "What moved the rating"} ${granularityPicker()}<span class="grow"></span>${go}</div>`;
  } else if (S.tool === "flip") {
    head = `<div class="tool-row">Fewest deletions that change the answer ${granularityPicker()}<span class="grow"></span>${go}</div>`;
  } else {
    const picks = S.swaps.map((s, i) => `<button data-i="${i}" class="${i === S.swapIndex ? "on" : ""}">${esc(s.label)}</button>`).join("");
    head = `<div class="swap-picks">${picks}<button data-i="custom" class="${S.swapIndex === "custom" ? "on" : ""}">Custom</button></div>
      ${swapEditor()}
      <div class="tool-row" style="margin-top:10px"><span id="swap-summary" class="grow">${swapSummary()}</span>${go}</div>`;
  }

  box.innerHTML = `${head}
    <div class="progress" id="prog" ${running ? "" : "hidden"}><div></div></div><div class="status" id="status"></div>
    <div class="result" id="result"></div>`;
  if (r && !running) $("#result").innerHTML = r.html + (r.stale ? `<div class="stale">The case changed after this ran. Run again to update.</div>` : "");
  if (running) progress(controllers.running.done, controllers.running.total);
  $$("#result [data-hover]").forEach((el) => {
    el.onmousemove = (e) => showTip(e, esc(el.dataset.hover));
    el.onmouseleave = hideTip;
  });

  $("#gran")?.addEventListener("change", (e) => (S.granularity = e.target.value));
  $("#go")?.addEventListener("click", () => {
    if (running) {
      cancel("running");
      if (S.overlay && !S.results[S.tool]) { S.overlay = null; renderDoc(); }
      return renderTool();
    }
    ({ why: runWhy, flip: runFlip, swap: runSwap })[S.tool]();
  });
  $$(".swap-picks button", box).forEach((b) => (b.onclick = () => {
    S.swapIndex = b.dataset.i === "custom" ? "custom" : +b.dataset.i;
    delete S.results.swap;
    renderTool();
  }));
  $$(".swap-edit textarea, .swap-edit input", box).forEach((el) => el.addEventListener("input", () => {
    readSwapEditor();
    $("#swap-summary").textContent = swapSummary();
  }));
}

function progress(done, total) {
  const ctl = controllers.running;
  if (ctl) Object.assign(ctl, { done, total });
  const p = $("#prog");
  if (!p || ctl?.tool !== S.tool) return;
  p.hidden = false;
  $("div", p).style.width = total ? `${(done / total) * 100}%` : "0";
  $("#status").textContent = total ? `Asked ${done} of ${total}` : "Starting…";
}

async function runTool(name, fn) {
  cancel("running");
  const ctl = (controllers.running = new AbortController());
  ctl.tool = name;
  renderTool();
  try {
    await fn(ctl.signal);
  } catch (err) {
    if (err.name !== "AbortError") S.results[name] = { html: `<div class="error">${esc(err.message)}</div>` };
  } finally {
    if (controllers.running === ctl) controllers.running = null;
    renderTool();
  }
}

/* why */

function runWhy() {
  const q = S.question;
  const target = q.type === "score" ? undefined : $("#why-target")?.value ?? topOf(S.answer);
  const label = q.type === "score" ? "the rating" : optionName(q, target);
  const text = S.text;
  return runTool("why", async (signal) => {
    const o = { kind: "why", label, segments: [], effects: {}, values: {} };
    let total = 0, done = 0;
    S.overlay = o;
    await stream("/api/xray", { state: text, question: wire(q, target), granularity: S.granularity }, (ev) => {
      if (ev.event === "base") {
        o.segments = ev.segments;
        o.base = ev.value;
        total = ev.segments.length + 1;
        done = 1;
      } else if (ev.event === "segment") {
        done += 1;
        o.effects[ev.i] = ev.effect;
        o.values[ev.i] = ev.value;
        if (S.tool === "why") renderDoc();
      }
      progress(done, total);
    }, signal);
    const ranked = Object.entries(o.effects).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    if (!ranked.length) return;
    const scale = Math.max(0.04, ...ranked.map(([, e]) => Math.abs(e)));
    const [bi] = ranked[0];
    const fmt = (v) => (q.type === "score" ? `${(1 + v * (q.criteria.length - 1)).toFixed(1)} of ${q.criteria.length}` : pct(v));
    const lead = Math.abs(ranked[0][1]) < 0.1
      ? `<p class="lead">No single ${S.granularity} moves it much. The biggest is <b>${quote(o.segments[bi].text)}</b> at ${pts(ranked[0][1])} pts, so the answer rests on the case as a whole.</p>`
      : `<p class="lead"><b>${quote(o.segments[bi].text)}</b> matters most. Without it, ${esc(label)} goes from ${fmt(o.base)} to <b>${fmt(o.values[bi])}</b>.</p>`;
    const rows = ranked.map(([i, e]) => `<span class="t" title="${esc(o.segments[i].text)}">${esc(o.segments[i].text)}</span>
      <span class="bar"><i class="${e >= 0 ? "pos" : "neg"}" style="width:${((Math.abs(e) / scale) * 50).toFixed(1)}%"></i></span>
      <span class="v num">${pts(e)} pts</span>`).join("");
    S.results.why = { target, overlay: o, html: `${lead}<div class="reasons">${rows}</div>` };
    if (S.tool === "why") renderDoc();
  });
}

/* flip */

function runFlip() {
  const q = S.question;
  const text = S.text;
  return runTool("flip", async (signal) => {
    let segs = [], start = null, total = 0, done = 0, path = [];
    const o = { kind: "flip", segments: [], removed: [] };
    S.overlay = o;
    await stream("/api/flip", { state: text, question: wire(q), granularity: S.granularity }, (ev) => {
      if (ev.event === "base") {
        segs = o.segments = ev.segments;
        start = ev;
        total = segs.length + 1;
        done = 1;
        path = [{ a: ev.answer, p: ev.probs[ev.answer] }];
      } else if (ev.event === "scan") {
        done += 1;
      } else if (ev.event === "remove") {
        total += 1;
        done += 1;
        o.removed = ev.removed;
        path.push({ a: ev.answer, p: ev.probs[ev.answer] });
      } else if (ev.event === "restore") {
        o.removed = ev.removed;
      } else if (ev.event === "done") {
        o.removed = ev.removed;
        const from = optionName(q, start.answer);
        const to = optionName(q, ev.answer);
        const list = ev.removed.map((i) => `<b>${quote(segs[i].text, 36)}</b>`).join(" and ");
        const lead = ev.flipped
          ? `<p class="lead">Delete ${list} and the answer changes from ${esc(from)} to <b>${esc(to)}</b>.</p>`
          : `<p class="lead">No small deletion changes it. The answer stays <b>${esc(from)}</b>, so it doesn't rest on one part of the text.</p>`;
        const steps = path.map((s, k) => `<span class="s ${k === path.length - 1 && ev.flipped ? "end" : ""}">${esc(optionName(q, s.a))} ${pct(s.p)}</span>`).join(`<span>→</span>`);
        S.results.flip = { overlay: o, html: `${lead}<div class="steps">${steps}</div>` };
      }
      if (S.tool === "flip" && ev.event !== "scan") renderDoc();
      progress(done, total);
    }, signal);
  });
}

/* swap */

function currentSwap() {
  if (S.swapIndex === "custom") {
    S.customSwap ??= { label: "Custom", original: "", groups: { "Try instead": [] } };
    return S.customSwap;
  }
  return S.swaps[S.swapIndex];
}

function swapEditor() {
  const s = currentSwap();
  const names = Object.keys(s.groups);
  const groups = names.map((g, i) => `<label>${esc(g)}<textarea data-g="${i}" spellcheck="false" placeholder="One per line">${esc(s.groups[g].join("\n"))}</textarea></label>`).join("");
  return `<div class="swap-edit">
    <label>Replace<input id="swap-original" value="${esc(s.original)}" placeholder="Words from the case, e.g. a name"></label>
    <div class="${names.length > 1 ? "two" : ""}">${groups}</div>
  </div>`;
}

function readSwapEditor() {
  const s = currentSwap();
  s.original = $("#swap-original").value;
  const names = Object.keys(s.groups);
  $$(".swap-edit textarea").forEach((t) => (s.groups[names[+t.dataset.g]] = t.value.split("\n").map((v) => v.trim()).filter(Boolean)));
}

function occurrences(text, needle) {
  const words = needle.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const re = new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "gi");
  return (text.match(re) || []).length;
}

function swapSummary() {
  const s = currentSwap();
  const n = Object.values(s.groups).flat().length;
  if (!s.original.trim()) return "Type words from the case to replace.";
  if (!occurrences(S.text, s.original)) return `“${s.original}” isn't in the case.`;
  return n ? `${n} versions of the case, one question each` : "List what to put in its place.";
}

function stripChart(groups, values, base) {
  const names = Object.keys(groups);
  const W = 560, L = 12, R = 20, T = 22, rowH = 48, B = 24;
  const H = T + names.length * rowH + B;
  // Always the full 0 to 100% range: a zoomed axis makes a 2 point wobble look like a landslide.
  const x = (v) => L + v * (W - L - R);
  let svg = "";
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const anchor = t === 0 ? "start" : t === 1 ? "end" : "middle";
    svg += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 4}" y2="${H - B}"/><text x="${x(t)}" y="${H - 8}" text-anchor="${anchor}">${t * 100}%</text>`;
  }
  svg += `<line class="ref" x1="${x(base)}" x2="${x(base)}" y1="${T - 8}" y2="${H - B}"/><text x="${x(base)}" y="${T - 12}" text-anchor="middle">original</text>`;
  names.forEach((g, gi) => {
    const cy = T + gi * rowH + rowH / 2 + 6;
    const color = gi ? "var(--series-2)" : "var(--series-1)";
    values.filter((v) => v.group === g).forEach((v, k) => {
      const y = cy + ((k % 5) - 2) * 4;
      svg += `<circle class="dot" cx="${x(v.p)}" cy="${y}" r="6" style="fill:${color}"/><circle class="hit" cx="${x(v.p)}" cy="${y}" r="10" data-hover="${esc(v.value)}: ${pct(v.p)}"/>`;
    });
    svg += `<text x="${L}" y="${cy - 16}" style="fill:${color};font-weight:600">${esc(g)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Answer for each version of the case">${svg}</svg>`;
}

function runSwap() {
  readSwapEditor();
  const s = currentSwap();
  const q = S.question;
  const target = q.type === "score" ? undefined : topOf(S.answer);
  const label = q.type === "score" ? "the rating" : optionName(q, target);
  const text = S.text;
  const groups = Object.fromEntries(Object.entries(s.groups).filter(([, v]) => v.length));
  if (!s.original.trim() || !occurrences(text, s.original) || !Object.keys(groups).length) {
    $("#swap-summary").textContent = swapSummary();
    return;
  }
  return runTool("swap", async (signal) => {
    const values = [];
    let base = 0, total = 0;
    S.overlay = null;
    renderDoc();
    await stream("/api/swap", { text, original: s.original, groups, question: wire(q, target) }, (ev) => {
      if (ev.event === "start") { base = ev.original.p; total = ev.total + 1; }
      if (ev.event === "value") values.push(ev);
      progress(values.length + 1, total);
    }, signal);
    const ps = values.map((v) => v.p);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    const names = Object.keys(groups);
    const mean = (g) => { const v = values.filter((x) => x.group === g).map((x) => x.p); return v.reduce((a, b) => a + b, 0) / v.length; };
    let lead;
    if (hi - lo < 0.02) {
      lead = `Swapping ${quote(s.original, 30)} barely matters. ${esc(label)} stays between <b>${pct(lo)}</b> and <b>${pct(hi)}</b> for every version.`;
    } else if (names.length > 1) {
      lead = `${esc(label)} averages <b>${pct(mean(names[0]))}</b> for ${esc(names[0].toLowerCase())} and <b>${pct(mean(names[1]))}</b> for ${esc(names[1].toLowerCase())}. Nothing else in the case changed.`;
    } else {
      lead = `${esc(label)} ranges from <b>${pct(lo)}</b> to <b>${pct(hi)}</b> depending on what replaces ${quote(s.original, 30)}.`;
    }
    S.results.swap = { html: `<p class="lead">${lead}</p>${stripChart(groups, values, base)}` };
  });
}

boot();
