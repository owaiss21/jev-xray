const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ui = {
  mode: "xray",
  qtype: "noul",
  granularity: "phrase",
  examples: [],
  controller: null,
  secPerCall: null, // learned from real (uncached) calls, used for time estimates
};

const RUN_LABEL = { xray: "Find the words that mattered", flip: "Find the smallest flip", swap: "Run the swap" };
const GROUP_COLORS = ["var(--series-1)", "var(--series-2)"];

/* ---------- numbers people can read ---------- */

function shown(value, q) {
  if (q.type === "score") {
    const n = q.criteria.length;
    return `${(1 + value * (n - 1)).toFixed(1)} / ${n}`;
  }
  const p = value * 100;
  if (p > 0 && p < 1) return "<1%";
  if (p < 100 && p > 99) return ">99%";
  return `${Math.round(p)}%`;
}

function moved(delta, q) {
  const sign = delta >= 0 ? "+" : "−";
  if (q.type === "score") return `${sign}${Math.abs(delta * (q.criteria.length - 1)).toFixed(2)} levels`;
  const pts = Math.abs(delta * 100);
  return `${sign}${pts < 10 ? pts.toFixed(1) : Math.round(pts)} pts`;
}

const size = (delta, q) => moved(Math.abs(delta), q).slice(1);

function watching(q) {
  if (q.type === "noul") return `chance of “${q.target === "false" ? "No" : "Yes"}”`;
  if (q.type === "choice") return `chance of “${q.target}”`;
  return "average rating";
}

function duration(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  return `${Math.round(seconds / 60)} min`;
}

/* ---------- backend pill ---------- */

async function checkBackend() {
  const pill = $("#backend");
  try {
    const info = await (await fetch("/api/health")).json();
    $("#backend-label").textContent = info.backend === "fake" ? "fake model (testing only)" : `${info.backend} · ${info.model}`;
    pill.classList.add("ok");
  } catch {
    $("#backend-label").textContent = "server not reachable";
    pill.classList.add("down");
  }
}

/* ---------- question editor ---------- */

function optionRow(name = "", desc = "") {
  const row = document.createElement("div");
  const isScore = ui.qtype === "score";
  row.className = isScore ? "row" : "row with-desc";
  row.innerHTML = isScore
    ? `<span class="idx"></span><input class="name" placeholder="Describe this level" value="${esc(name)}"><button type="button" class="del" aria-label="Remove">×</button>`
    : `<span class="idx"></span><input class="name" placeholder="Option" value="${esc(name)}"><input class="desc" placeholder="What it means (optional)" value="${esc(desc)}"><button type="button" class="del" aria-label="Remove">×</button>`;
  $(".del", row).onclick = () => { row.remove(); renumber(); refreshTargets(); estimate(); };
  $(".name", row).addEventListener("input", () => { refreshTargets(); liveSoon(); });
  $(".desc", row)?.addEventListener("input", liveSoon);
  $("#options").append(row);
  renumber();
}

function renumber() {
  $$("#options .row").forEach((r, i) => ($(".idx", r).textContent = ui.qtype === "score" ? i + 1 : "•"));
}

function setQType(type, options) {
  ui.qtype = type;
  $$("#qtype button").forEach((b) => {
    b.classList.toggle("on", b.dataset.type === type);
    b.setAttribute("aria-checked", String(b.dataset.type === type));
  });
  $("#options-box").hidden = type === "noul";
  $("#watch-box").hidden = type === "score";
  $("#options").innerHTML = "";
  if (type === "choice") {
    $("#options-title").textContent = "Options it can pick from";
    $("#options-hint").textContent = "A short name for each, plus an optional description to make the meaning clear.";
    $("#add-option").textContent = "+ Add option";
    (options || [["", ""], ["", ""]]).forEach(([n, d]) => optionRow(n, d));
  } else if (type === "score") {
    $("#options-title").textContent = "Levels of the scale, lowest first";
    $("#options-hint").textContent = "The model places your text somewhere between the first and last level.";
    $("#add-option").textContent = "+ Add level";
    (options || [["Very low"], ["Low"], ["Medium"], ["High"], ["Very high"]]).forEach(([n]) => optionRow(n));
  }
  refreshTargets();
}

function refreshTargets(keep) {
  const sel = $("#target");
  const previous = keep ?? sel.value;
  let options = [];
  if (ui.qtype === "noul") options = [["true", "Yes"], ["false", "No"]];
  else if (ui.qtype === "choice") options = $$("#options .name").map((i) => i.value.trim()).filter(Boolean).map((v) => [v, v]);
  sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (options.some(([v]) => v === previous)) sel.value = previous;
}

function readQuestion() {
  const instructions = $("#instructions").value.trim();
  if (!instructions) throw new Error("Write the question you want the model to decide (step 2).");
  const q = { type: ui.qtype, instructions };
  if (ui.qtype === "choice") {
    const criteria = {};
    for (const row of $$("#options .row")) {
      const name = $(".name", row).value.trim();
      if (!name) continue;
      if (name in criteria) throw new Error(`The option “${name}” appears twice. Give each option a different name.`);
      criteria[name] = $(".desc", row).value.trim() || name;
    }
    if (Object.keys(criteria).length < 2) throw new Error("Add at least two options for the model to pick from.");
    q.criteria = criteria;
    q.target = $("#target").value;
  } else if (ui.qtype === "score") {
    q.criteria = $$("#options .name").map((i) => i.value.trim()).filter(Boolean);
    if (q.criteria.length < 2) throw new Error("A scale needs at least two levels.");
  } else {
    q.target = $("#target").value || "true";
  }
  return q;
}

function readText() {
  const text = $("#state").value;
  if (!text.trim()) throw new Error("Paste some text first (step 1).");
  return text;
}

/* ---------- swap inputs ---------- */

function occurrences(text, original) {
  const words = original.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return (text.match(new RegExp(pattern, "gi")) || []).length;
}

function refreshFound() {
  const original = $("#original").value.trim();
  const hint = $("#found");
  hint.className = "hint";
  if (!original) {
    hint.textContent = "Type a name, place, school, or any words that appear in your text.";
  } else {
    const n = occurrences($("#state").value, original);
    hint.textContent = n
      ? `Found ${n === 1 ? "once" : `${n} times`} in your text. Every occurrence gets replaced.`
      : "Not found in your text. Copy it exactly as it appears in step 1.";
    hint.classList.add(n ? "ok" : "warn");
  }
  estimate();
}

function addGroup(name = "", values = []) {
  const index = $$("#groups .group").length;
  if (index >= GROUP_COLORS.length) return;
  const el = document.createElement("div");
  el.className = "group";
  el.innerHTML = `
    <div class="group-head"><i style="background:${GROUP_COLORS[index]}"></i>
      <input class="g-name" value="${esc(name || (index ? "Group B" : "Group A"))}" aria-label="Group name">
      ${index ? '<button type="button" class="g-del" aria-label="Remove group">×</button>' : ""}</div>
    <textarea class="g-values" rows="5" spellcheck="false" placeholder="One value per line" aria-label="Values, one per line">${esc(values.join("\n"))}</textarea>`;
  const del = $(".g-del", el);
  if (del) del.onclick = () => { el.remove(); $("#add-group").hidden = false; estimate(); };
  $(".g-values", el).addEventListener("input", estimate);
  $("#groups").append(el);
  $("#add-group").hidden = $$("#groups .group").length >= GROUP_COLORS.length;
}

function readSwap() {
  const original = $("#original").value.trim();
  if (!original) throw new Error("Type the words you want to swap out (step 3).");
  if (!occurrences($("#state").value, original)) throw new Error(`“${original}” isn't in your text. Copy it exactly as it appears in step 1.`);
  const groups = {};
  for (const g of $$("#groups .group")) {
    const values = $(".g-values", g).value.split("\n").map((v) => v.trim()).filter(Boolean);
    if (values.length) groups[$(".g-name", g).value.trim() || "Group"] = values;
  }
  if (!Object.keys(groups).length) throw new Error("List at least one thing to swap in (step 3).");
  return { original, groups };
}

/* ---------- examples ---------- */

async function loadExamples() {
  ui.examples = await (await fetch("/api/examples")).json();
  fillExamples();
}

function fillExamples() {
  const wantSwap = ui.mode === "swap";
  const list = ui.examples.filter((e) => (e.mode === "swap") === wantSwap);
  $("#example").innerHTML = list.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join("");
  if (list.length) applyExample(list[0]);
}

function applyExample(ex) {
  const q = ex.question;
  $("#state").value = ex.state;
  $("#instructions").value = q.instructions;
  if (q.type === "choice") setQType("choice", Object.entries(q.criteria).map(([k, v]) => [k, v === k ? "" : v]));
  else if (q.type === "score") setQType("score", q.criteria.map((c) => [c]));
  else setQType("noul");
  refreshTargets(q.target);
  if (ex.granularity) setGranularity(ex.granularity);
  if (ex.mode === "swap") {
    $("#original").value = ex.swap;
    $("#groups").innerHTML = "";
    Object.entries(ex.groups).forEach(([name, values]) => addGroup(name, values));
    refreshFound();
  }
  clearResults();
  estimate();
  liveSoon();
}

/* ---------- modes ---------- */

function setMode(mode) {
  stop();
  const switchedKind = (ui.mode === "swap") !== (mode === "swap");
  ui.mode = mode;
  $$(".modes button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  $$("[data-show]").forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(mode)));
  $$("[data-panel]").forEach((el) => (el.hidden = el.dataset.panel !== mode));
  $("#run").textContent = RUN_LABEL[mode] || "Run";
  hideError();
  if (switchedKind || !$("#example").options.length) fillExamples();
  else { clearResults(); estimate(); }
  liveSoon();
}

function setGranularity(g) {
  ui.granularity = g;
  $$("#granularity button").forEach((b) => {
    b.classList.toggle("on", b.dataset.g === g);
    b.setAttribute("aria-checked", String(b.dataset.g === g));
  });
  estimate();
}

function clearResults() {
  for (const m of ["xray", "flip", "swap"]) {
    $(`#${m}-empty`).hidden = false;
    $(`#${m}-out`).hidden = true;
  }
  $("#answer").hidden = ui.mode !== "live" || !$("#answer-dist").innerHTML;
}

/* ---------- estimates, progress, errors ---------- */

function pieces(text, g) {
  if (g === "word") return (text.match(/\S+/g) || []).length;
  const re = g === "phrase" ? /[^.!?,;:\n]+/g : /[^.!?\n]+/g;
  return (text.match(re) || []).filter((s) => s.trim()).length;
}

function estimate() {
  const el = $("#estimate");
  let calls = 0;
  const text = $("#state").value;
  if (ui.mode === "xray") calls = pieces(text, ui.granularity) + 1;
  else if (ui.mode === "flip") calls = pieces(text, ui.granularity) + 4;
  else if (ui.mode === "swap") calls = $$("#groups .g-values").reduce((n, t) => n + t.value.split("\n").filter((v) => v.trim()).length, 0) + 1;
  if (!calls || ui.mode === "live") return (el.textContent = "");
  const time = ui.secPerCall ? ` · about ${duration(calls * ui.secPerCall)} on this machine` : "";
  el.textContent = `${ui.mode === "flip" ? "At least " : "About "}${calls} questions to the model${time}. Anything you've run before is instant.`;
}

let progress = { done: 0, total: 0, started: 0, modelSeconds: 0, fresh: 0 };

function startProgress(total) {
  progress = { done: 0, total, started: performance.now(), modelSeconds: 0, fresh: 0 };
  $("#progress").hidden = false;
  $("#estimate").hidden = true;
  tickProgress();
}

function stepProgress(seconds = 0, n = 1) {
  progress.done += n;
  if (seconds > 0.01) { progress.modelSeconds += seconds; progress.fresh += n; }
  tickProgress();
}

function tickProgress() {
  const { done, total } = progress;
  $("#progress-fill").style.width = total ? `${Math.min(100, (done / total) * 100)}%` : "0%";
  const rate = progress.fresh ? progress.modelSeconds / progress.fresh : ui.secPerCall;
  const left = rate && total > done ? ` · about ${duration((total - done) * rate)} left` : "";
  $("#progress-text").textContent = total ? `Asked ${done} of ${total}${left}` : "Starting…";
}

function endProgress() {
  if (progress.fresh >= 3) ui.secPerCall = progress.modelSeconds / progress.fresh;
  $("#progress").hidden = true;
  $("#estimate").hidden = false;
  estimate();
}

function showError(message) {
  $("#error").textContent = message;
  $("#error").hidden = false;
}
function hideError() { $("#error").hidden = true; }

/* ---------- streaming ---------- */

async function errorText(res) {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) return body.detail.map((d) => d.msg).join(". ");
  } catch {}
  return `The server answered ${res.status}.`;
}

async function streamPost(url, body, onEvent) {
  ui.controller = new AbortController();
  $("#run").disabled = true;
  hideError();
  startProgress(0);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ui.controller.signal,
    });
    if (!res.ok) throw new Error(await errorText(res));
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.event === "error") throw new Error(`The model backend failed: ${event.message}`);
        onEvent(event);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") showError(err.message || String(err));
  } finally {
    ui.controller = null;
    $("#run").disabled = false;
    endProgress();
  }
}

function stop() {
  if (ui.controller) ui.controller.abort();
}

/* ---------- shared rendering ---------- */

function renderAnswer(probs, q, note = "") {
  const names = q.type === "noul" ? { true: "Yes", false: "No" } : {};
  const watched = q.type === "score" ? null : q.target;
  $("#answer-dist").innerHTML = Object.entries(probs)
    .map(([id, p]) => {
      const label = q.type === "score" ? `${+id + 1} · ${q.criteria[+id]}` : names[id] || id;
      const w = id === watched ? "watched" : "";
      return `<span class="label ${w}" title="${esc(label)}">${esc(label)}</span>
        <span class="track"><span class="fill ${w}" style="width:${(p * 100).toFixed(1)}%"></span></span>
        <span class="num">${shown(p, { type: "noul" })}</span>`;
    })
    .join("");
  $("#answer-note").textContent = note;
  $("#answer").hidden = false;
}

function buildReading(el, text, segments) {
  el.innerHTML = "";
  let cursor = 0;
  const spans = [];
  for (const s of segments) {
    if (s.start > cursor) el.append(text.slice(cursor, s.start));
    const span = document.createElement("span");
    span.className = "seg";
    span.textContent = text.slice(s.start, s.end);
    el.append(span);
    spans[s.i] = span;
    cursor = s.end;
  }
  if (cursor < text.length) el.append(text.slice(cursor));
  return spans;
}

function tint(effect, scale) {
  const a = Math.min(1, Math.abs(effect) / scale) * 0.62;
  return `rgba(var(${effect >= 0 ? "--pos" : "--neg"}), ${a.toFixed(3)})`;
}

const tip = $("#tooltip");
function showTip(evt, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(evt.clientX + 14, innerWidth - r.width - 8) + "px";
  tip.style.top = Math.min(evt.clientY + 14, innerHeight - r.height - 8) + "px";
}
const hideTip = () => (tip.hidden = true);

function quote(text, max = 40) {
  const t = text.length > max ? text.slice(0, max - 1) + "…" : text;
  return `“${esc(t)}”`;
}

/* ---------- 1. which words mattered ---------- */

async function runXray() {
  const q = readQuestion();
  const text = readText();
  const view = { spans: [], segs: [], effects: {}, values: {}, base: 0 };
  const unit = ui.granularity;

  const repaint = () => {
    const scale = Math.max(0.04, ...Object.values(view.effects).map(Math.abs));
    for (const [i, e] of Object.entries(view.effects)) {
      view.spans[i].classList.remove("pending");
      view.spans[i].style.backgroundColor = tint(e, scale);
    }
    const ranked = Object.entries(view.effects).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    $("#xray-top").innerHTML = `<div class="top-list"><h4>Biggest effects</h4><div class="bars">${ranked
      .map(([i, e]) => `<span class="label">${esc(view.segs[i].text)}</span>
          <span class="track"><span class="bar ${e >= 0 ? "pos" : "neg"}" style="width:${((Math.abs(e) / scale) * 50).toFixed(1)}%"></span></span>
          <span class="num">${moved(e, q)}</span>`)
      .join("")}</div></div>`;
  };

  await streamPost("/api/xray", { state: text, question: q, granularity: unit }, (ev) => {
    if (ev.event === "base") {
      view.base = ev.value;
      view.segs = ev.segments;
      progress.total = ev.segments.length + 1;
      stepProgress(ev.seconds);
      renderAnswer(ev.probs, q, "for your text as written");
      $("#xray-empty").hidden = true;
      $("#xray-out").hidden = false;
      $("#xray-top").innerHTML = "";
      $("#xray-head").innerHTML = `<div class="big">${shown(ev.value, q)}</div>
        <p class="say">That's the ${watching(q)}. Now each ${unit} is removed on its own and the question is asked again.</p>`;
      view.spans = buildReading($("#xray-text"), text, ev.segments);
      view.spans.forEach((span, i) => {
        span.classList.add("pending");
        span.onmousemove = (e) => {
          if (!(i in view.effects)) return showTip(e, "Not measured yet");
          showTip(e, `Without ${quote(view.segs[i].text)}: <b>${shown(view.values[i], q)}</b><br>So this ${unit} is worth <b>${moved(view.effects[i], q)}</b>`);
        };
        span.onmouseleave = hideTip;
      });
    } else if (ev.event === "segment") {
      view.effects[ev.i] = ev.effect;
      view.values[ev.i] = ev.value;
      stepProgress(ev.seconds);
      repaint();
    } else if (ev.event === "done") {
      const [i, e] = Object.entries(view.effects).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] || [];
      if (i === undefined) return;
      $("#xray-head").innerHTML = `<div class="big">${shown(view.base, q)}</div>
        <p class="say">That's the ${watching(q)}. The ${unit} doing the most work is <b>${quote(view.segs[i].text)}</b>. Without it, the ${watching(q)} goes from ${shown(view.base, q)} to <b>${shown(view.values[i], q)}</b>.</p>
        <p class="meta">${ev.calls} questions asked${ev.seconds < 0.05 ? " · replayed from cache" : ` · ${duration(ev.seconds)} of model time`}</p>`;
    }
  });
}

/* ---------- 2. how close is it to changing ---------- */

function flipChart(points, threshold) {
  const W = 640, H = 180, L = 44, R = 12, T = 14, B = 28;
  const n = Math.max(points.length - 1, 1);
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - v) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const grid = [0, 0.5, 1].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v * 100}%</text>`).join("");
  const dots = points.map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.value)}" r="4.5"/><circle class="hit" data-i="${i}" cx="${x(i)}" cy="${y(p.value)}" r="13"/>`).join("");
  return `<p class="sub">How the answer moved, one deletion at a time</p>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Answer after each deletion">
    ${grid}<line class="threshold" x1="${L}" x2="${W - R}" y1="${y(threshold)}" y2="${y(threshold)}"/>
    <text x="${W - R}" y="${y(threshold) - 7}" text-anchor="end">flips here (${Math.round(threshold * 100)}%)</text>
    <path class="line" d="${path}"/>${dots}
    <text x="${L}" y="${H - 6}">your text</text><text x="${W - R}" y="${H - 6}" text-anchor="end">after ${points.length - 1} change${points.length === 2 ? "" : "s"}</text></svg>`;
}

async function runFlip() {
  const q = readQuestion();
  const text = readText();
  const threshold = Number($("#threshold").value) / 100;
  const unit = ui.granularity;
  let spans = [], segs = [], points = [], start = 0;

  const draw = () => {
    $("#flip-chart").innerHTML = flipChart(points, threshold);
    $$("#flip-chart .hit").forEach((c) => {
      const p = points[+c.dataset.i];
      c.onmousemove = (e) => showTip(e, `${p.label}<br>answer: <b>${shown(p.value, q)}</b>`);
      c.onmouseleave = hideTip;
    });
  };
  const strike = (removed) => spans.forEach((s, i) => s.classList.toggle("cut", removed.includes(i)));

  await streamPost("/api/flip", { state: text, question: q, granularity: unit, threshold }, (ev) => {
    if (ev.event === "base") {
      segs = ev.segments;
      start = ev.value;
      progress.total = segs.length + 1;
      stepProgress();
      renderAnswer(ev.probs, q, "for your text as written");
      $("#flip-empty").hidden = true;
      $("#flip-out").hidden = false;
      $("#flip-head").innerHTML = `<div class="big">${shown(start, q)}</div>
        <p class="say">The ${watching(q)} starts here. First every ${unit} is tested on its own, then the strongest ones are removed until the answer crosses ${Math.round(threshold * 100)}%.</p>`;
      spans = buildReading($("#flip-text"), text, segs);
      points = [{ value: start, label: "your text as written" }];
      draw();
    } else if (ev.event === "scan") {
      stepProgress();
    } else if (ev.event === "remove") {
      progress.total += 1;
      stepProgress();
      const last = segs[ev.removed[ev.removed.length - 1]];
      points.push({ value: ev.value, label: `removed ${quote(last.text)}` });
      strike(ev.removed);
      draw();
    } else if (ev.event === "restore") {
      points.push({ value: ev.value, label: `put back ${quote(segs[ev.i].text)}, it wasn't needed` });
      strike(ev.removed);
      draw();
    } else if (ev.event === "done") {
      strike(ev.removed);
      const n = ev.removed.length;
      const list = ev.removed.map((i) => `<b>${quote(segs[i].text)}</b>`).join(", ");
      $("#flip-head").innerHTML = ev.flipped
        ? `<div class="big">${shown(start, q)}<span class="arrow">→</span>${shown(ev.value, q)}</div>
           <p class="say">Deleting ${n === 1 ? "just one" : n} ${unit}${n === 1 ? "" : "s"} is enough to flip the ${watching(q)}: ${list}.
           ${n <= 3 ? "That's a fragile decision." : "It takes some work to change this one."}</p>`
        : `<div class="big">${shown(start, q)}<span class="arrow">→</span>${shown(ev.value, q)}</div>
           <p class="say">Deleting ${unit}s couldn't push it past ${Math.round(threshold * 100)}%. The decision doesn't hang on any small part of this text.</p>`;
      $("#flip-head").insertAdjacentHTML("beforeend", `<p class="meta">${ev.calls} questions asked</p>`);
    }
  });
}

/* ---------- 3. is it fair ---------- */

function stripChart(groups, values, original) {
  const names = Object.keys(groups);
  const W = 640, L = 16, R = 16, rowH = 70, T = 30, B = 30;
  const H = T + names.length * rowH + B;
  const ps = values.map((v) => v.p).concat(original ? [original.p] : []);
  let lo = Math.min(...ps), hi = Math.max(...ps);
  const span = Math.max(hi - lo, 0.04);
  lo = Math.max(0, lo - span * 0.25);
  hi = Math.min(1, hi + span * 0.25);
  if (hi - lo < 0.04) lo = Math.max(0, hi - 0.04);
  const step = [0.005, 0.01, 0.02, 0.05, 0.1, 0.25].find((s) => (hi - lo) / s <= 6) || 0.25;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const fmt = (v) => `${(v * 100).toFixed(step < 0.01 ? 1 : 0)}%`;
  let svg = "";
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) {
    svg += `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="${T - 8}" y2="${H - B}"/><text x="${x(t)}" y="${H - 10}" text-anchor="middle">${fmt(t)}</text>`;
  }
  if (original) {
    svg += `<line class="baseline" x1="${x(original.p)}" x2="${x(original.p)}" y1="${T - 12}" y2="${H - B}"/>
      <text x="${x(original.p)}" y="${T - 16}" text-anchor="middle">original</text>`;
  }
  names.forEach((g, gi) => {
    const cy = T + gi * rowH + rowH / 2 + 6;
    const color = GROUP_COLORS[gi];
    const vals = values.filter((v) => v.group === g);
    vals.forEach((v, k) => {
      const jitter = ((k % 5) - 2) * 5;
      svg += `<circle class="dot" cx="${x(v.p)}" cy="${cy + jitter}" r="6.5" style="fill:${color}"/>
        <circle class="hit" cx="${x(v.p)}" cy="${cy + jitter}" r="11" data-g="${esc(g)}" data-v="${esc(v.value)}" data-p="${v.p}"/>`;
    });
    const mean = vals.length ? vals.reduce((a, b) => a + b.p, 0) / vals.length : null;
    if (mean !== null) svg += `<line class="mean" x1="${x(mean)}" x2="${x(mean)}" y1="${cy - 22}" y2="${cy + 22}" style="stroke:${color}"/>`;
    svg += `<text class="glabel" x="${L}" y="${cy - 26}">${esc(g)}${mean !== null ? ` · average ${fmt(mean)}` : ""}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Answer for every swapped value">${svg}</svg>
    <p class="muted" style="font-size:12.5px;margin:4px 0 0">Each dot is one version of your text. The thick line is the group's average. The axis is zoomed in, so check the numbers before reading too much into the distance.</p>`;
}

async function runSwap() {
  const q = readQuestion();
  const text = readText();
  const { original, groups } = readSwap();
  const values = [];
  let base = null;

  const draw = () => {
    $("#swap-chart").innerHTML = stripChart(groups, values, base);
    $$("#swap-chart .hit").forEach((c) => {
      c.onmousemove = (e) => showTip(e, `${esc(c.dataset.v)} (${esc(c.dataset.g)})<br>answer: <b>${shown(+c.dataset.p, q)}</b>`);
      c.onmouseleave = hideTip;
    });
  };

  await streamPost("/api/swap", { text, original, groups, question: q }, (ev) => {
    if (ev.event === "start") {
      base = ev.original;
      progress.total = ev.total + 1;
      stepProgress();
      renderAnswer(base.probs, q, `with “${original}”`);
      $("#swap-empty").hidden = true;
      $("#swap-out").hidden = false;
      $("#swap-table-wrap").hidden = true;
      $("#swap-head").innerHTML = `<div class="big">${shown(base.p, q)}</div>
        <p class="say">The ${watching(q)} with <b>“${esc(original)}”</b>. Now the same text is asked once for each value you listed.</p>`;
      draw();
    } else if (ev.event === "value") {
      values.push(ev);
      stepProgress();
      draw();
    } else if (ev.event === "done") {
      const s = ev.summary;
      const names = Object.keys(s).filter((k) => k !== "_gap");
      const avgs = names.map((g) => `${esc(g)} average <b>${shown(s[g].mean, q)}</b>`).join(", ");
      const all = values.map((v) => v.p);
      const spread = Math.max(...all) - Math.min(...all);
      const gap = s._gap;
      const verdict = gap === undefined
        ? `Across everything you tried, the answer ranged over <b>${size(spread, q)}</b>.`
        : gap * 100 < 1
          ? `The groups are less than 1 point apart, so on this text the swap barely matters.`
          : `The groups are <b>${size(gap, q)}</b> apart. Since nothing else changed, that gap comes from the swap alone.`;
      $("#swap-head").innerHTML = `<div class="big">${gap === undefined ? size(spread, q) : size(gap, q)}</div>
        <p class="say">${gap === undefined ? "spread" : "gap between the groups"}. ${avgs}. The original text scored ${shown(base.p, q)}. ${verdict}</p>
        <p class="meta">${ev.calls} questions asked</p>`;
      $("#swap-table").innerHTML = `<table><thead><tr><th>Group</th><th>Swapped in</th><th class="num">${esc(watching(q))}</th></tr></thead><tbody>${values
        .slice()
        .sort((a, b) => b.p - a.p)
        .map((v) => `<tr><td>${esc(v.group)}</td><td>${esc(v.value)}</td><td class="num">${shown(v.p, q)}</td></tr>`)
        .join("")}</tbody></table>`;
      $("#swap-table-wrap").hidden = false;
    }
  });
}

/* ---------- 4. play with it ---------- */

let liveTimer = null;
let liveSeq = 0;
function liveSoon() {
  if (ui.mode !== "live") return;
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runLive, 450);
}

async function runLive() {
  let q, text;
  try {
    q = readQuestion();
    text = readText();
  } catch (err) {
    return showError(err.message);
  }
  hideError();
  const seq = ++liveSeq;
  $("#live-head").innerHTML = `<p class="muted">Asking…</p>`;
  const started = performance.now();
  try {
    const res = await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: text, question: q }),
    });
    if (!res.ok) throw new Error(await errorText(res));
    const out = await res.json();
    if (seq !== liveSeq) return;
    const ms = Math.round(performance.now() - started);
    $("#live-head").innerHTML = `<div class="big">${shown(out.value, q)}</div>
      <p class="say">${watching(q)[0].toUpperCase() + watching(q).slice(1)} for the text as it is right now. Change a word and see what happens.</p>
      <p class="meta">${out.cached ? "seen before, from cache" : `answered in ${ms} ms`}</p>`;
    renderAnswer(out.probs, q, "updates as you type");
  } catch (err) {
    if (seq === liveSeq) showError(err.message);
  }
}

/* ---------- wiring ---------- */

$$(".modes button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$$("#qtype button").forEach((b) => (b.onclick = () => { setQType(b.dataset.type); clearResults(); liveSoon(); }));
$$("#granularity button").forEach((b) => (b.onclick = () => setGranularity(b.dataset.g)));
$("#add-option").onclick = () => optionRow();
$("#add-group").onclick = () => { addGroup(); estimate(); };
$("#example").onchange = () => applyExample(ui.examples.find((e) => e.id === $("#example").value));
$("#stop").onclick = stop;
$("#threshold").oninput = () => ($("#threshold-value").textContent = `${$("#threshold").value}%`);
$("#state").addEventListener("input", () => { estimate(); if (ui.mode === "swap") refreshFound(); liveSoon(); });
$("#original").addEventListener("input", refreshFound);
$("#instructions").addEventListener("input", liveSoon);
$("#target").addEventListener("change", liveSoon);
$("#setup").onsubmit = async (e) => {
  e.preventDefault();
  if (ui.controller) return;
  hideError();
  try {
    await ({ xray: runXray, flip: runFlip, swap: runSwap }[ui.mode] || (async () => {}))();
  } catch (err) {
    showError(err.message);
  }
};

setGranularity("phrase");
setQType("noul");
setMode("xray");
checkBackend();
loadExamples();
