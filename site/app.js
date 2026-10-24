import * as core from "./core.js";

const DEFAULT_ENDPOINT = "https://ayush-ai-verma--kev27b-api.modal.run";
const TOP_N = 10;
const PER_STEP = 3;
const MAX_COMPARE = 3;
const FALLBACK_KINDS = new Set(["network", "timeout", "server", "rate_limited", "not_found", "auth", "bad_response", "offline"]);

const $ = (id) => document.getElementById(id);
const { esc } = core;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or disabled */ } },
  raw(k) { try { return localStorage.getItem(k); } catch { return null; } },
  setRaw(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const settings = {
  get endpoint() { return store.raw("kevEndpoint") || DEFAULT_ENDPOINT; },
  get key() { return store.raw("kevKey") || ""; },
};

let TOOLS = [];
let BY_ID = new Map();
let CATEGORIES = [];
let CAT_BY_SLUG = {};
let favorites = store.get("kevFavs", []);
let searches = store.get("kevHistory", []);
let compare = [];
let lastRun = null;
let controller = null;

// ---------- UI helpers ----------
function setStatus(msg, error = false, el = "status") {
  $(el).textContent = msg;
  $(el).classList.toggle("error", error);
}

let toastTimer;
function toast(msg) {
  $("toast").textContent = msg;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, 1800);
}

async function copyText(text) {
  try {
    await Promise.race([navigator.clipboard.writeText(text), new Promise((_, rej) => setTimeout(() => rej(new Error("clipboard timeout")), 1000))]);
  } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  toast("Copied");
}

const pct = (p) => `${(p * 100).toFixed(0)}%`;

function toolCard(t, { score, explain } = {}) {
  const io = (t.inputs?.length || t.outputs?.length) ? `<div class="io">${esc((t.inputs || []).join(", ") || "—")} → ${esc((t.outputs || []).join(", ") || "—")}</div>` : "";
  const install = t.install ? `<div class="install-row"><code class="install">${esc(t.install)}</code><button data-act="copy" data-id="${esc(t.id)}" title="Copy install command">Copy</button></div>` : "";
  const scoreHtml = score === undefined ? "" : `<span class="score">${pct(score)}</span>`;
  const bar = score === undefined ? "" : `<div class="bar"><span style="width:${(Math.max(0, Math.min(1, score)) * 100).toFixed(1)}%"></span></div>`;
  const fav = favorites.includes(t.id);
  const cmp = compare.includes(t.id);
  return `<div class="card" data-tool="${esc(t.id)}">${scoreHtml}<h3><a href="${esc(core.safeUrl(t.url))}" target="_blank" rel="noopener noreferrer">${esc(t.name)}</a></h3>
    <p>${esc(t.description)}</p>${io}
    <div class="meta"><span class="badge">${esc(t.category)}</span><span class="badge">${esc(t.language)}</span><span class="badge">${esc(t.license)}</span></div>
    ${install}${bar}${explain ? `<div class="explain">${explain}</div>` : ""}
    <div class="actions">
      <button data-act="fav" data-id="${esc(t.id)}" class="${fav ? "on" : ""}" aria-pressed="${fav}">${fav ? "★ Saved" : "☆ Save"}</button>
      <button data-act="cmp" data-id="${esc(t.id)}" class="${cmp ? "on" : ""}" aria-pressed="${cmp}">${cmp ? "✓ Comparing" : "+ Compare"}</button>
    </div></div>`;
}

const FACETS = [
  ["input", "inputs", "Any input format"],
  ["output", "outputs", "Any output format"],
  ["license", "licenses", "Any license"],
  ["language", "languages", "Any language"],
  ["install", "installs", "Any install method"],
];

function buildFacets(container, onChange) {
  const vals = core.facetValues(TOOLS);
  container.innerHTML = FACETS.map(([key, field, label]) => {
    const extra = key === "license" ? `<option value="__open">Open source only</option>` : "";
    return `<select data-facet="${key}" aria-label="${esc(label)}"><option value="">${esc(label)}</option>${extra}${vals[field].map((v) => `<option value="${esc(v)}">${esc(key === "install" ? `Install: ${v}` : v)}</option>`).join("")}</select>`;
  }).join("");
  container.addEventListener("change", onChange);
  return () => Object.fromEntries([...container.querySelectorAll("select")].map((s) => [s.dataset.facet, s.value]));
}
let browseFacets = () => ({});
let refineFacets = () => ({});

// ---------- Browse ----------
function renderBrowse() {
  const q = $("search").value.trim().toLowerCase();
  const cat = $("catFilter").value;
  const hits = core.filterTools(TOOLS, browseFacets()).filter((t) => (!cat || t.category === cat) &&
    (!q || [t.name, t.description, t.category, t.language, t.license, ...(t.inputs || []), ...(t.outputs || [])].join(" ").toLowerCase().includes(q)));
  $("count").textContent = `${hits.length} of ${TOOLS.length} tools`;
  $("grid").innerHTML = hits.map((t) => toolCard(t)).join("") || `<p class="muted">No tools match these filters.</p>`;
}

// ---------- Kev calls ----------
function kev(state, questions, signal) {
  return core.systemOne({
    endpoint: settings.endpoint, key: settings.key, state, questions, signal,
    onRetry: ({ attempt, error, waitMs }) => setWaiting(`Kev isn't ready (${error.kind === "timeout" ? "timed out" : error.message.slice(0, 80)}). Retry ${attempt}/3 in ${Math.round(waitMs / 1000)} s…`),
  });
}

let waitBase = "";
let waitStart = 0;
let waitTimer;
function setWaiting(msg) { waitBase = msg; tickWaiting(); }
function tickWaiting() {
  const s = Math.round((Date.now() - waitStart) / 1000);
  const hint = s >= 5 ? ` ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} elapsed${s >= 8 ? " — the GPU may be waking up (usually under 2 min)" : ""}.` : "";
  setStatus(waitBase + hint);
}
function startWaiting() { waitStart = Date.now(); clearInterval(waitTimer); waitTimer = setInterval(tickWaiting, 1000); }
function stopWaiting() { clearInterval(waitTimer); }

function mode() { return document.querySelector('input[name="mode"]:checked').value; }
function setMode(m) { document.querySelector(`input[name="mode"][value="${m === "pipeline" ? "pipeline" : "single"}"]`).checked = true; syncModeLabel(); }
function syncModeLabel() { $("askBtn").textContent = mode() === "pipeline" ? "Plan pipeline" : "Find tools"; }

function catQuestion(slugs) {
  const qs = {};
  for (const id of slugs) {
    const tools = TOOLS.filter((t) => core.slug(t.category) === id);
    qs[id] = { type: "choice", instructions: "Which tool in this list is the best fit for this task and data?",
      criteria: Object.fromEntries(tools.map((t) => [t.id, toolOption(t)])) };
  }
  return qs;
}

function toolOption(t) {
  const io = (t.inputs?.length || t.outputs?.length) ? ` Input: ${(t.inputs || []).join(", ") || "n/a"}; output: ${(t.outputs || []).join(", ") || "n/a"}.` : "";
  return `${t.name}: ${t.description}${io}`;
}

async function runSingle(task, signal) {
  setWaiting("Step 1/2: Kev is choosing the relevant categories…");
  const catCriteria = Object.fromEntries(CATEGORIES.map((c) => [core.slug(c), core.CATEGORY_HINTS[c] ? `${c}: ${core.CATEGORY_HINTS[c]}` : c]));
  const a1 = await kev(task, { category: { type: "choice", instructions: "Which category of bioinformatics tools does this task mainly need?", criteria: catCriteria } }, signal);
  const picked = core.pickCategories(a1.category.probabilities);
  $("categories").innerHTML = picked.map(([id, p]) => `<span class="chip">${esc(CAT_BY_SLUG[id] || id)} <b>${pct(p)}</b></span>`).join("");
  setWaiting("Step 2/2: Kev is ranking tools in those categories…");
  const a2 = await kev(task, catQuestion(picked.map(([id]) => id)), signal);
  return { mode: "single", kind: "kev", picked, scored: core.scoreTools(picked, a2, BY_ID) };
}

async function runPipeline(task, signal) {
  setWaiting("Step 1/2: Kev is working out which steps this pipeline needs…");
  const qs = Object.fromEntries(CATEGORIES.map((c) => [core.slug(c), { type: "noul", instructions: `Does this task or pipeline include a step that needs ${c} tools${core.CATEGORY_HINTS[c] ? ` (${core.CATEGORY_HINTS[c]})` : ""}?` }]));
  const a1 = await kev(task, qs, signal);
  const nouls = Object.fromEntries(Object.entries(a1).map(([id, a]) => [id, a.noul]));
  const steps = core.pickPipelineSteps(nouls, CATEGORIES);
  $("categories").innerHTML = steps.map(([id, p], i) => `<span class="chip">${i + 1}. ${esc(CAT_BY_SLUG[id] || id)} <b>${pct(p)}</b></span>`).join("");
  setWaiting(`Step 2/2: Kev is picking tools for ${steps.length} pipeline step${steps.length === 1 ? "" : "s"}…`);
  const a2 = await kev(task, catQuestion(steps.map(([id]) => id)), signal);
  return { mode: "pipeline", kind: "kev", picked: steps, scored: core.scoreTools(steps.map(([id]) => [id, 1]), a2, BY_ID) };
}

function fallbackRun(task, m, reason) {
  $("categories").innerHTML = "";
  const hits = core.keywordSearch(task, TOOLS, 50);
  $("banner").hidden = false;
  $("banner").textContent = `${reason} Showing keyword matches from the catalog instead — less accurate than Kev.`;
  return { mode: m, kind: "keyword", picked: [], scored: hits.map((h) => ({ ...h, matched: h.matched })) };
}

// ---------- Render results ----------
function explainKev(r, total) {
  return `P(category) <b>${pct(r.pCat)}</b> × P(tool | category) <b>${pct(r.pTool)}</b> = <b>${pct(r.score)}</b> · #${r.rankInCat} of ${total[r.catSlug]} in ${esc(CAT_BY_SLUG[r.catSlug] || r.catSlug)}`;
}

function renderResults() {
  if (!lastRun) return;
  const f = refineFacets();
  const ok = new Set(core.filterTools(lastRun.scored.map((r) => r.tool), f).map((t) => t.id));
  const rows = lastRun.scored.filter((r) => ok.has(r.tool.id));
  const total = {};
  for (const r of lastRun.scored) if (r.catSlug) total[r.catSlug] = (total[r.catSlug] || 0) + 1;
  const filtered = rows.length !== lastRun.scored.length ? ` (${lastRun.scored.length - rows.length} hidden by filters)` : "";

  if (lastRun.kind === "keyword") {
    $("results").innerHTML = rows.length ? `<ol class="results">${rows.slice(0, TOP_N).map((r) => `<li>${toolCard(r.tool, { explain: `Keyword match: ${esc(r.matched.join(", "))}` })}</li>`).join("")}</ol>` : `<p class="muted">No keyword matches${filtered}. Try different words.</p>`;
    return;
  }
  if (lastRun.mode === "single") {
    $("results").innerHTML = rows.length ? `<ol class="results">${rows.slice(0, TOP_N).map((r) => `<li>${toolCard(r.tool, { score: r.score, explain: explainKev(r, total) })}</li>`).join("")}</ol>` : `<p class="muted">No tools match these filters.</p>`;
    setStatus(`Top ${Math.min(TOP_N, rows.length)} of ${rows.length} candidate tools${filtered}. Score = P(category) × P(tool | category).`);
    return;
  }
  const html = [];
  let prevTop = null;
  lastRun.picked.forEach(([id, pStep], i) => {
    const stepRows = rows.filter((r) => r.catSlug === id).slice(0, PER_STEP);
    const top = stepRows[0]?.tool;
    if (prevTop && top) {
      const shared = (prevTop.outputs || []).filter((o) => (top.inputs || []).includes(o));
      if (shared.length) html.push(`<div class="handoff">↓ ${esc(prevTop.name)} hands ${esc(shared.join(", "))} to ${esc(top.name)}</div>`);
    }
    html.push(`<section class="step"><h3>Step ${i + 1}: ${esc(CAT_BY_SLUG[id] || id)}<span class="score">${pct(pStep)} needed</span></h3>
      ${stepRows.length ? `<ol class="results">${stepRows.map((r) => `<li>${toolCard(r.tool, { score: r.score, explain: `P(step needed) <b>${pct(pStep)}</b> · P(tool | step) <b>${pct(r.pTool)}</b> · #${r.rankInCat} of ${total[id]}` })}</li>`).join("")}</ol>` : `<p class="muted">No tools in this step match the filters.</p>`}</section>`);
    if (top) prevTop = top;
  });
  $("results").innerHTML = html.join("");
  setStatus(`${lastRun.picked.length}-step pipeline, top ${PER_STEP} tools per step${filtered}. Steps are ordered by a typical analysis flow.`);
}

// ---------- Ask ----------
async function ask() {
  const task = $("task").value.trim();
  const err = core.validateTask(task);
  if (err) { setStatus(err, true); $("task").focus(); return; }
  const m = mode();
  if (controller) controller.abort();
  controller = new AbortController();
  const { signal } = controller;
  $("askBtn").disabled = true;
  $("cancelBtn").hidden = false;
  $("banner").hidden = true;
  $("categories").innerHTML = "";
  $("results").innerHTML = "";
  $("refine").hidden = true;
  try { window.history.replaceState(null, "", core.encodeShare({ q: task, mode: m })); } catch { /* file:// */ }
  startWaiting();
  try {
    if (!TOOLS.length) throw new core.KevError("bad_response", "The tool catalog failed to load. Reload the page.");
    const ep = core.validateEndpoint(settings.endpoint, location.protocol);
    if (!ep.ok) throw new core.KevError("not_found", `${ep.error} Fix it in Settings.`);
    if (navigator.onLine === false) throw new core.KevError("offline", "You're offline.");
    lastRun = m === "pipeline" ? await runPipeline(task, signal) : await runSingle(task, signal);
    lastRun.task = task;
  } catch (e) {
    if (e.kind === "aborted" || signal.aborted) { setStatus("Cancelled."); return; }
    if (!FALLBACK_KINDS.has(e.kind) || !TOOLS.length) { setStatus(e.message || String(e), true); return; }
    const reason = e.kind === "network" ? `Couldn't reach Kev at ${settings.endpoint}.` : e.message;
    lastRun = fallbackRun(task, m, reason);
    lastRun.task = task;
    setStatus(`${Math.min(TOP_N, lastRun.scored.length)} keyword matches.`, true);
  } finally {
    stopWaiting();
    if (controller?.signal === signal) controller = null;
    $("askBtn").disabled = false;
    $("cancelBtn").hidden = true;
  }
  $("refine").hidden = false;
  $("shareBtn").hidden = false;
  renderResults();
  if (lastRun.kind === "kev") {
    const top = lastRun.mode === "pipeline"
      ? lastRun.picked.map(([id]) => lastRun.scored.find((r) => r.catSlug === id)?.tool.name).filter(Boolean)
      : lastRun.scored.slice(0, 3).map((r) => r.tool.name);
    searches = core.addHistory(searches, { q: task, mode: m, at: Date.now(), top });
    store.set("kevHistory", searches);
    renderSaved();
  }
}

// ---------- Saved ----------
function renderSaved() {
  const favTools = favorites.map((id) => BY_ID.get(id)).filter(Boolean);
  $("favCount").textContent = favTools.length ? `(${favTools.length})` : "";
  $("favEmpty").hidden = favTools.length > 0;
  $("favGrid").innerHTML = favTools.map((t) => toolCard(t)).join("");
  $("historyList").innerHTML = searches.length ? searches.map((h, i) => `<li><div class="q"><div>${h.mode === "pipeline" ? "<span class=\"badge\">pipeline</span>" : ""}${esc(h.q)}</div>
    <div class="muted small">${esc(new Date(h.at).toLocaleString())}${h.top?.length ? ` · ${esc(h.top.join(", "))}` : ""}</div></div>
    <button data-act="rerun" data-i="${i}">Run again</button></li>`).join("") : `<li class="muted">No searches yet.</li>`;
}

function refreshCards() {
  renderBrowse();
  renderResults();
  renderSaved();
  renderCompareBar();
}

// ---------- Compare ----------
function renderCompareBar() {
  $("compareBar").hidden = compare.length === 0;
  $("compareCount").textContent = `${compare.length} of ${MAX_COMPARE} selected`;
  $("compareOpen").disabled = compare.length < 2;
}

function openCompare() {
  const tools = compare.map((id) => BY_ID.get(id)).filter(Boolean);
  const scoreOf = (t) => {
    const r = lastRun?.kind === "kev" ? lastRun.scored.find((x) => x.tool.id === t.id) : null;
    return r ? pct(r.score) : "—";
  };
  const rows = [
    ["Tool", (t) => `<a href="${esc(core.safeUrl(t.url))}" target="_blank" rel="noopener noreferrer">${esc(t.name)}</a>`],
    ["Kev score", (t) => esc(scoreOf(t))],
    ["Category", (t) => esc(t.category)],
    ["What it does", (t) => esc(t.description)],
    ["Inputs", (t) => esc((t.inputs || []).join(", ") || "—")],
    ["Outputs", (t) => esc((t.outputs || []).join(", ") || "—")],
    ["Language", (t) => esc(t.language)],
    ["License", (t) => esc(t.license)],
    ["Install", (t) => t.install ? `<code>${esc(t.install)}</code>` : "—"],
  ];
  $("compareTable").innerHTML = rows.map(([label, f]) => `<tr><th>${label}</th>${tools.map((t) => `<td>${f(t)}</td>`).join("")}</tr>`).join("");
  $("compareDlg").showModal();
}

// ---------- Events ----------
function onCardAction(e) {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  if (b.dataset.act === "copy") { const t = BY_ID.get(id); if (t?.install) copyText(t.install); return; }
  if (b.dataset.act === "fav") { favorites = core.toggleFavorite(favorites, id); store.set("kevFavs", favorites); refreshCards(); return; }
  if (b.dataset.act === "cmp") {
    if (!compare.includes(id) && compare.length >= MAX_COMPARE) { toast(`Compare up to ${MAX_COMPARE} tools`); return; }
    compare = core.toggleFavorite(compare, id);
    refreshCards();
    return;
  }
  if (b.dataset.act === "rerun") {
    const h = searches[Number(b.dataset.i)];
    if (!h) return;
    $("task").value = h.q;
    setMode(h.mode);
    updateCount();
    showTab("ask");
    ask();
  }
}

function showTab(name) {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === name));
}

function updateCount() {
  const n = $("task").value.length;
  $("charCount").textContent = `${n} / ${core.LIMITS.maxTask}`;
  $("charCount").classList.toggle("error", n > core.LIMITS.maxTask * 0.95);
}

function initSettings() {
  $("endpoint").value = settings.endpoint;
  $("apikey").value = settings.key;
  $("toggleKey").addEventListener("click", () => {
    const show = $("apikey").type === "password";
    $("apikey").type = show ? "text" : "password";
    $("toggleKey").textContent = show ? "Hide" : "Show";
  });
  $("saveSettings").addEventListener("click", () => {
    const url = core.normalizeEndpoint($("endpoint").value) || DEFAULT_ENDPOINT;
    const v = core.validateEndpoint(url, location.protocol);
    if (!v.ok) { setStatus(v.error, true, "settingsStatus"); return; }
    store.setRaw("kevEndpoint", url);
    store.setRaw("kevKey", $("apikey").value.trim());
    $("endpoint").value = url;
    setStatus(v.warning ? `Saved. Warning: ${v.warning}` : "Saved in this browser.", Boolean(v.warning), "settingsStatus");
  });
  $("resetSettings").addEventListener("click", () => {
    store.del("kevEndpoint");
    $("endpoint").value = DEFAULT_ENDPOINT;
    setStatus("Endpoint reset to the default Kev-27B. Your API key was kept.", false, "settingsStatus");
  });
  $("testEndpoint").addEventListener("click", async () => {
    const endpoint = core.normalizeEndpoint($("endpoint").value) || DEFAULT_ENDPOINT;
    const v = core.validateEndpoint(endpoint, location.protocol);
    if (!v.ok) { setStatus(v.error, true, "settingsStatus"); return; }
    $("testEndpoint").disabled = true;
    setStatus("Testing… (can take 1–2 min if the GPU is cold)", false, "settingsStatus");
    const started = Date.now();
    try {
      const j = await core.listModels({ endpoint, key: $("apikey").value.trim() });
      const m = j.models[0] || {};
      const desc = [m.run, m.device && `on ${m.device}`].filter(Boolean).join(" ");
      setStatus(`Connected in ${((Date.now() - started) / 1000).toFixed(1)} s: ${m.name || "model"}${desc ? ` (${desc})` : ""}.${v.warning ? ` Warning: ${v.warning}` : ""} Remember to Save.`, false, "settingsStatus");
    } catch (e) {
      setStatus(e.kind === "network" ? `Couldn't reach ${endpoint}. Check the URL and that it's deployed.` : e.message, true, "settingsStatus");
    } finally { $("testEndpoint").disabled = false; }
  });
}

function loadFromHash() {
  const { q, mode: m } = core.decodeShare(location.hash);
  if (!q) return;
  $("task").value = q.slice(0, core.LIMITS.maxTask);
  setMode(m);
  updateCount();
  showTab("ask");
  ask();
}

async function init() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  initSettings();
  document.addEventListener("click", onCardAction);
  $("askBtn").addEventListener("click", ask);
  $("cancelBtn").addEventListener("click", () => controller?.abort());
  $("shareBtn").addEventListener("click", () => copyText(location.href));
  $("task").addEventListener("input", updateCount);
  $("task").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask(); });
  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener("change", syncModeLabel));
  document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => {
    $("task").value = b.textContent.replace(/^Pipeline:\s*/, "");
    setMode(b.dataset.mode);
    updateCount();
  }));
  $("clearHistory").addEventListener("click", () => { searches = []; store.set("kevHistory", searches); renderSaved(); });
  $("compareOpen").addEventListener("click", openCompare);
  $("compareClear").addEventListener("click", () => { compare = []; refreshCards(); });
  $("compareClose").addEventListener("click", () => $("compareDlg").close());
  window.addEventListener("hashchange", () => { if (core.decodeShare(location.hash).q !== $("task").value.trim()) loadFromHash(); });

  try {
    const r = await fetch("tools.json");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data)) throw new Error("not a list");
    TOOLS = data.filter((t) => t && t.id && t.name && t.category);
  } catch (e) {
    setStatus(`Couldn't load the tool catalog (${e.message}). Reload the page.`, true);
    $("count").textContent = "Catalog unavailable.";
    return;
  }
  BY_ID = new Map(TOOLS.map((t) => [t.id, t]));
  CATEGORIES = [...new Set(TOOLS.map((t) => t.category))];
  CAT_BY_SLUG = Object.fromEntries(CATEGORIES.map((c) => [core.slug(c), c]));
  favorites = favorites.filter((id) => BY_ID.has(id));
  $("catFilter").innerHTML += CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");
  $("toolTotal").textContent = `${TOOLS.length} tools in ${CATEGORIES.length} categories`;
  browseFacets = buildFacets($("browseFilters"), renderBrowse);
  refineFacets = buildFacets($("refineFilters"), renderResults);
  $("search").addEventListener("input", renderBrowse);
  $("catFilter").addEventListener("change", renderBrowse);
  renderBrowse();
  renderSaved();
  syncModeLabel();
  updateCount();
  loadFromHash();
}
init();
