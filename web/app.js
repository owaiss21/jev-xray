const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const fmt = (x, d = 2) => Number(x).toFixed(d);
const signed = (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ui = {
  mode: "xray",
  qtype: "noul",
  granularity: "word",
  examples: [],
  controller: null,
};

/* ---------- backend status ---------- */

async function checkBackend() {
  const pill = $("#backend");
  try {
    const info = await (await fetch("/api/health")).json();
    $("#backend-label").textContent = `${info.backend} · ${info.model}`;
    pill.classList.add("ok");
  } catch {
    $("#backend-label").textContent = "server not reachable";
    pill.classList.add("down");
  }
}

/* ---------- question editor ---------- */

function setQType(type) {
  ui.qtype = type;
  $$("#qtype button").forEach((b) => b.classList.toggle("on", b.dataset.type === type));
  $("#options-field").hidden = type === "noul";
  $("#options-label").textContent = type === "score" ? "Levels (lowest first, one per line)" : "Options (id: description, one per line)";
  refreshTargets();
}

function parseOptions() {
  const lines = $("#options").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (ui.qtype === "score") return lines;
  const out = {};
  for (const line of lines) {
    const i = line.indexOf(":");
    const id = (i > 0 ? line.slice(0, i) : line).trim();
    out[id] = (i > 0 ? line.slice(i + 1) : line).trim() || id;
  }
  return out;
}

function refreshTargets(keep) {
  const sel = $("#target");
  const previous = keep ?? sel.value;
  let options = [];
  if (ui.qtype === "noul") options = [["true", "yes"], ["false", "no"]];
  else if (ui.qtype === "choice") options = Object.keys(parseOptions()).map((k) => [k, k]);
  $("#target-field").hidden = ui.qtype === "score";
  sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (options.some(([v]) => v === previous)) sel.value = previous;
}

function readQuestion() {
  const q = { type: ui.qtype, instructions: $("#instructions").value.trim() };
  if (ui.qtype !== "noul") q.criteria = parseOptions();
  if (ui.qtype !== "score") q.target = $("#target").value;
  return q;
}

function targetLabel(q) {
  if (q.type === "noul") return q.target === "false" ? "P(no)" : "P(yes)";
  if (q.type === "choice") return `P(${q.target})`;
  return "score";
}

/* ---------- swap groups ---------- */

const GROUP_COLORS = ["var(--series-1)", "var(--series-2)"];

function renderGroups(groups) {
  const box = $("#groups");
  box.innerHTML = "";
  Object.entries(groups).forEach(([name, values], i) => addGroup(name, values, i));
}

function addGroup(name = "", values = [], index = $$("#groups .group").length) {
  if (index >= GROUP_COLORS.length) return;
  const el = document.createElement("div");
  el.className = "group";
  el.innerHTML = `
    <div class="group-head"><i style="background:${GROUP_COLORS[index]}"></i>
      <input class="g-name" value="${esc(name || `Group ${index + 1}`)}" aria-label="Group name">
      <button type="button" class="g-del" aria-label="Remove group">×</button></div>
    <textarea class="g-values" rows="4" spellcheck="false" aria-label="Values, one per line">${esc(values.join("\n"))}</textarea>`;
  $(".g-del", el).onclick = () => el.remove();
  $("#groups").append(el);
  $("#add-group").disabled = $$("#groups .group").length >= GROUP_COLORS.length;
}

function readGroups() {
  const out = {};
  for (const g of $$("#groups .group")) {
    const values = $(".g-values", g).value.split("\n").map((v) => v.trim()).filter(Boolean);
    if (values.length) out[$(".g-name", g).value.trim() || "group"] = values;
  }
  return out;
}

/* ---------- examples ---------- */

async function loadExamples() {
  ui.examples = await (await fetch("/api/examples")).json();
  fillExampleSelect();
}

function fillExampleSelect() {
  const wantSwap = ui.mode === "swap";
  const list = ui.examples.filter((e) => (e.mode === "swap") === wantSwap);
  $("#example").innerHTML = list.map((e) => `<option value="${e.id}">${esc(e.title)}</option>`).join("");
  if (list.length) applyExample(list[0]);
}

function applyExample(ex) {
  const q = ex.question;
  if (ex.mode === "swap") {
    $("#template").value = ex.template;
    $("#slot").value = ex.slot || "name";
    renderGroups(ex.groups);
  } else {
    $("#state").value = ex.state;
    setGranularity(ex.granularity || "word");
  }
  $("#instructions").value = q.instructions;
  if (q.type === "score") $("#options").value = q.criteria.join("\n");
  else if (q.type === "choice") $("#options").value = Object.entries(q.criteria).map(([k, v]) => `${k}: ${v}`).join("\n");
  else $("#options").value = "";
  setQType(q.type);
  refreshTargets(q.target);
  if (ui.mode === "live") liveSoon();
}

/* ---------- modes ---------- */

function setMode(mode) {
  stop();
  const wasSwap = ui.mode === "swap";
  ui.mode = mode;
  $$(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  $$("[data-show]").forEach((el) => (el.hidden = !el.dataset.show.split(" ").includes(mode)));
  $$("[data-panel]").forEach((el) => (el.hidden = el.dataset.panel !== mode));
  if (wasSwap !== (mode === "swap") || !$("#example").options.length) fillExampleSelect();
  if (mode === "live") liveSoon();
}

function setGranularity(g) {
  ui.granularity = g;
  $$("#granularity button").forEach((b) => b.classList.toggle("on", b.dataset.g === g));
}

/* ---------- streaming ---------- */

async function streamPost(url, body, onEvent) {
  ui.controller = new AbortController();
  $("#run").disabled = true;
  $("#stop").disabled = false;
  const started = performance.now();
  const tick = setInterval(() => status(null, started), 250);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ui.controller.signal,
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);
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
        if (event.event === "error") throw new Error(event.message);
        onEvent(event);
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") ui.lastError = String(err.message || err);
  } finally {
    clearInterval(tick);
    status(ui.lastError ? `error: ${ui.lastError}` : null, started, true);
    ui.lastError = null;
    ui.controller = null;
    $("#run").disabled = false;
    $("#stop").disabled = true;
  }
}

let progress = { done: 0, total: 0 };
function status(message, started, final = false) {
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  const count = progress.total ? `${progress.done}/${progress.total} calls · ` : "";
  $("#status").textContent = message ?? `${count}${secs}s${final ? "" : " …"}`;
}

function stop() {
  if (ui.controller) ui.controller.abort();
}

/* ---------- shared rendering ---------- */

function renderDist(el, probs, q) {
  const ids = Object.keys(probs);
  const target = q.type === "score" ? null : q.target;
  const labels = q.type === "noul" ? { true: "yes", false: "no" } : {};
  const levels = q.type === "score" ? q.criteria : null;
  el.innerHTML = ids
    .map((id) => {
      const p = probs[id];
      const label = levels ? `${id} · ${levels[+id]}` : labels[id] || id;
      return `<span class="label" title="${esc(label)}">${esc(label)}</span>
        <span class="track"><span class="fill ${id === target ? "target" : ""}" style="width:${(p * 100).toFixed(1)}%"></span></span>
        <span class="num">${fmt(p)}</span>`;
    })
    .join("");
}

function headline(el, value, q, meta = "") {
  el.innerHTML = `<span class="big">${fmt(value)}</span>
    <span class="what">${esc(targetLabel(q))} · ${esc(q.instructions)}</span>
    <span class="meta">${esc(meta)}</span>`;
}

function buildReading(el, text, segments) {
  el.innerHTML = "";
  let cursor = 0;
  const spans = [];
  for (const s of segments) {
    if (s.start > cursor) el.append(text.slice(cursor, s.start));
    const span = document.createElement("span");
    span.className = "seg pending";
    span.textContent = text.slice(s.start, s.end);
    span.dataset.i = s.i;
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
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.min(evt.clientX + pad, w - r.width - 8) + "px";
  tip.style.top = Math.min(evt.clientY + pad, h - r.height - 8) + "px";
}
const hideTip = () => (tip.hidden = true);

/* ---------- X-ray ---------- */

async function runXray() {
  const q = readQuestion();
  const text = $("#state").value;
  const view = { spans: [], segs: [], effects: {}, values: {}, base: 0 };
  $("#xray-top").innerHTML = "";
  $("#xray-legend").hidden = true;
  progress = { done: 0, total: 0 };

  const repaint = () => {
    const scale = Math.max(0.04, ...Object.values(view.effects).map(Math.abs));
    for (const [i, e] of Object.entries(view.effects)) {
      const span = view.spans[i];
      span.classList.remove("pending");
      span.style.backgroundColor = tint(e, scale);
    }
    const ranked = Object.entries(view.effects).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
    $("#xray-top").innerHTML = `<div class="top-list"><h3>Pieces that moved it most</h3><div class="bars">${ranked
      .map(([i, e]) => {
        const w = (Math.abs(e) / scale) * 50;
        return `<span class="label">${esc(view.segs[i].text)}</span>
          <span class="track"><span class="bar ${e >= 0 ? "pos" : "neg"}" style="width:${w.toFixed(1)}%"></span></span>
          <span class="num">${signed(e)}</span>`;
      })
      .join("")}</div></div>`;
  };

  await streamPost("/api/xray", { state: text, question: q, granularity: ui.granularity }, (ev) => {
    if (ev.event === "base") {
      view.base = ev.value;
      view.segs = ev.segments;
      progress = { done: 1, total: ev.segments.length + 1 };
      headline($("#xray-head"), ev.value, q, "baseline");
      renderDist($("#primer-dist"), ev.probs, q);
      view.spans = buildReading($("#xray-text"), text, ev.segments);
      $("#xray-legend").hidden = false;
      view.spans.forEach((span, i) => {
        span.onmousemove = (e) => {
          if (!(i in view.effects)) return showTip(e, "not measured yet");
          showTip(e, `Without “${esc(view.segs[i].text)}”: <b>${fmt(view.values[i])}</b><br>change: <b>${signed(-view.effects[i])}</b>`);
        };
        span.onmouseleave = hideTip;
      });
    } else if (ev.event === "segment") {
      view.effects[ev.i] = ev.effect;
      view.values[ev.i] = ev.value;
      progress.done += 1;
      repaint();
    } else if (ev.event === "done") {
      $("#xray-head .meta").textContent = `${ev.calls} calls · ${ev.seconds < 0.05 ? "replayed from cache" : fmt(ev.seconds, 1) + "s of model time"}`;
    }
  });
}

/* ---------- Flip ---------- */

function flipChart(points, threshold) {
  const W = 640, H = 170, L = 36, R = 12, T = 12, B = 26;
  const n = Math.max(points.length - 1, 1);
  const x = (i) => L + (i / n) * (W - L - R);
  const y = (v) => T + (1 - v) * (H - T - B);
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join("");
  const ticks = [0, 0.5, 1].map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");
  const dots = points
    .map((p, i) => `<circle class="pt" cx="${x(i)}" cy="${y(p.value)}" r="4"/><circle class="hit" data-i="${i}" cx="${x(i)}" cy="${y(p.value)}" r="12"/>`)
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Tracked probability after each edit">
    ${ticks}
    <line class="threshold" x1="${L}" x2="${W - R}" y1="${y(threshold)}" y2="${y(threshold)}"/>
    <text x="${W - R}" y="${y(threshold) - 6}" text-anchor="end">threshold ${threshold}</text>
    <path class="line" d="${path}"/>${dots}
    <text x="${L}" y="${H - 6}">start</text><text x="${W - R}" y="${H - 6}" text-anchor="end">edit ${points.length - 1}</text>
  </svg>`;
}

async function runFlip() {
  const q = readQuestion();
  const text = $("#state").value;
  const threshold = parseFloat($("#threshold").value) || 0.5;
  let spans = [], segs = [], points = [];
  $("#flip-summary").innerHTML = "";
  $("#flip-chart").innerHTML = "";
  progress = { done: 0, total: 0 };

  const drawChart = () => {
    $("#flip-chart").innerHTML = flipChart(points, threshold);
    $$("#flip-chart .hit").forEach((c) => {
      const p = points[+c.dataset.i];
      c.onmousemove = (e) => showTip(e, `${esc(p.label)}<br>value: <b>${fmt(p.value)}</b>`);
      c.onmouseleave = hideTip;
    });
  };
  const markRemoved = (removed) => {
    spans.forEach((s, i) => s.classList.toggle("cut", removed.includes(i)));
  };

  await streamPost("/api/flip", { state: text, question: q, granularity: ui.granularity, threshold }, (ev) => {
    if (ev.event === "base") {
      segs = ev.segments;
      progress = { done: 1, total: segs.length + 1 };
      headline($("#flip-head"), ev.value, q, `pushing ${ev.direction} past ${threshold}`);
      renderDist($("#primer-dist"), ev.probs, q);
      spans = buildReading($("#flip-text"), text, segs);
      spans.forEach((s) => s.classList.remove("pending"));
      points = [{ value: ev.value, label: "original text" }];
      drawChart();
    } else if (ev.event === "scan") {
      progress.done += 1;
    } else if (ev.event === "remove") {
      progress.total += 1; progress.done += 1;
      const last = segs[ev.removed[ev.removed.length - 1]];
      points.push({ value: ev.value, label: `removed “${last.text}”` });
      markRemoved(ev.removed);
      headline($("#flip-head"), ev.value, q, `${ev.removed.length} removed`);
      drawChart();
    } else if (ev.event === "restore") {
      points.push({ value: ev.value, label: `put back “${segs[ev.i].text}” (not needed)` });
      markRemoved(ev.removed);
      drawChart();
    } else if (ev.event === "done") {
      markRemoved(ev.removed);
      headline($("#flip-head"), ev.value, q, `${ev.calls} calls`);
      const pieces = ev.removed.map((i) => `“${esc(segs[i].text)}”`).join(", ");
      const unit = ui.granularity;
      const n = ev.removed.length;
      $("#flip-summary").innerHTML = ev.flipped
        ? `<div class="callout">Removing <b>${n}</b> ${unit}${n === 1 ? "" : "s"} moves ${esc(targetLabel(q))} from <b>${fmt(points[0].value)}</b> to <b>${fmt(ev.value)}</b>: ${pieces}.</div>`
        : `<div class="callout">Couldn't cross ${threshold} by deleting. Best reached: <b>${fmt(ev.value)}</b>. The decision doesn't hang on any small part of this text.</div>`;
    }
  });
}

/* ---------- Swap lab ---------- */

function stripChart(groups, values) {
  const names = Object.keys(groups);
  const W = 640, L = 16, R = 16, rowH = 64, T = 22, B = 30;
  const H = T + names.length * rowH + B;
  // Zoom to the data: the interesting differences are often a few hundredths wide.
  const ps = values.map((v) => v.p);
  let lo = ps.length ? Math.min(...ps) : 0, hi = ps.length ? Math.max(...ps) : 1;
  const span = Math.max(hi - lo, 0.04);
  lo = Math.max(0, lo - span * 0.25); hi = Math.min(1, hi + span * 0.25);
  if (hi - lo < 0.04) lo = Math.max(0, hi - 0.04);
  const step = [0.005, 0.01, 0.02, 0.05, 0.1, 0.25].find((s) => (hi - lo) / s <= 6) || 0.25;
  const digits = step < 0.01 ? 3 : 2;
  const x = (v) => L + ((v - lo) / (hi - lo)) * (W - L - R);
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) ticks.push(t);
  const axis = ticks
    .map((v) => `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${T - 6}" y2="${H - B}"/><text x="${x(v)}" y="${H - 10}" text-anchor="middle">${v.toFixed(digits)}</text>`)
    .join("");
  let rows = "";
  names.forEach((g, gi) => {
    const cy = T + gi * rowH + rowH / 2;
    const color = GROUP_COLORS[gi];
    const vals = values.filter((v) => v.group === g);
    vals.forEach((v, k) => {
      const jitter = ((k % 5) - 2) * 5;
      rows += `<circle class="dot" cx="${x(v.p)}" cy="${cy + jitter}" r="6" style="fill:${color}"/>
        <circle class="hit" cx="${x(v.p)}" cy="${cy + jitter}" r="11" data-g="${esc(g)}" data-v="${esc(v.value)}" data-p="${v.p}"/>`;
    });
    if (vals.length) {
      const mean = vals.reduce((a, b) => a + b.p, 0) / vals.length;
      rows += `<line class="mean" x1="${x(mean)}" x2="${x(mean)}" y1="${cy - 20}" y2="${cy + 20}" style="stroke:${color}"/>
        <text x="${L}" y="${cy - 22}">${esc(g)} · mean ${fmt(mean, 3)}</text>`;
    } else {
      rows += `<text x="${L}" y="${cy - 22}">${esc(g)}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Probability for each value, grouped">${axis}${rows}</svg>`;
}

async function runSwap() {
  const q = readQuestion();
  const groups = readGroups();
  const values = [];
  progress = { done: 0, total: 0 };
  $("#swap-head").innerHTML = "";
  $("#swap-table-wrap").hidden = true;

  const draw = () => {
    $("#swap-chart").innerHTML = stripChart(groups, values);
    $$("#swap-chart .hit").forEach((c) => {
      c.onmousemove = (e) => showTip(e, `${esc(c.dataset.v)}<br>${esc(c.dataset.g)}: <b>${fmt(c.dataset.p, 3)}</b>`);
      c.onmouseleave = hideTip;
    });
  };

  await streamPost(
    "/api/swap",
    { template: $("#template").value, slot: $("#slot").value.trim() || "name", groups, question: q },
    (ev) => {
      if (ev.event === "start") {
        progress = { done: 0, total: ev.total };
        draw();
      } else if (ev.event === "value") {
        values.push(ev);
        progress.done += 1;
        draw();
      } else if (ev.event === "done") {
        const s = ev.summary;
        const names = Object.keys(s).filter((k) => k !== "_gap");
        const spread = names.map((g) => `${esc(g)} <b>${fmt(s[g].mean, 3)}</b>`).join(" vs ");
        $("#swap-head").innerHTML = `<span class="big">${s._gap !== undefined ? fmt(s._gap, 3) : "–"}</span>
          <span class="what">gap in ${esc(targetLabel(q))} between group means</span>
          <span class="meta">${ev.calls} calls · ${ev.seconds < 0.05 ? "replayed from cache" : fmt(ev.seconds, 1) + "s"}</span>`;
        $("#swap-chart").insertAdjacentHTML("beforeend", `<div class="callout">${spread}. Each dot is the same text with one value swapped in. Spread inside a group is noise from the values themselves; a gap between groups is what to look at.</div>`);
        $("#swap-table").innerHTML = `<table><thead><tr><th>Group</th><th>Value</th><th class="num">${esc(targetLabel(q))}</th></tr></thead><tbody>${values
          .map((v) => `<tr><td>${esc(v.group)}</td><td>${esc(v.value)}</td><td class="num">${fmt(v.p, 3)}</td></tr>`)
          .join("")}</tbody></table>`;
        $("#swap-table-wrap").hidden = false;
      }
    },
  );
}

/* ---------- Live ---------- */

let liveTimer = null;
let liveSeq = 0;
function liveSoon() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(runLive, 350);
}

async function runLive() {
  if (ui.mode !== "live") return;
  const q = readQuestion();
  const seq = ++liveSeq;
  const started = performance.now();
  try {
    const res = await fetch("/api/decide", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: $("#state").value, question: q }),
    });
    const out = await res.json();
    if (seq !== liveSeq) return;
    if (!res.ok) throw new Error(out.detail || res.statusText);
    const ms = Math.round(performance.now() - started);
    headline($("#live-head"), out.value, q, out.cached ? "from cache" : `${ms} ms round trip`);
    renderDist($("#live-dist"), out.probs, q);
    renderDist($("#primer-dist"), out.probs, q);
  } catch (err) {
    $("#live-head").innerHTML = `<p class="muted">error: ${esc(err.message)}</p>`;
  }
}

/* ---------- wiring ---------- */

$$(".tabs button").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
$$("#qtype button").forEach((b) => (b.onclick = () => { setQType(b.dataset.type); if (ui.mode === "live") liveSoon(); }));
$$("#granularity button").forEach((b) => (b.onclick = () => setGranularity(b.dataset.g)));
$("#options").addEventListener("input", () => { refreshTargets(); if (ui.mode === "live") liveSoon(); });
$("#example").onchange = () => applyExample(ui.examples.find((e) => e.id === $("#example").value));
$("#add-group").onclick = () => addGroup();
$("#stop").onclick = stop;
["#state", "#instructions", "#target"].forEach((s) => $(s).addEventListener("input", () => ui.mode === "live" && liveSoon()));
$("#target").addEventListener("change", () => ui.mode === "live" && liveSoon());
$("#editor").onsubmit = (e) => {
  e.preventDefault();
  if (ui.controller) return;
  ({ xray: runXray, flip: runFlip, swap: runSwap }[ui.mode] || (() => {}))();
};

setGranularity("word");
setMode("xray");
checkBackend();
loadExamples();
