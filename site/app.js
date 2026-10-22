const DEFAULT_ENDPOINT = "https://ayush-ai-verma--kev27b-api.modal.run";
const CATEGORY_MASS = 0.8;
const MAX_CATEGORIES = 3;
const TOP_N = 10;

const $ = (id) => document.getElementById(id);
const settings = {
  get endpoint() { return localStorage.getItem("kevEndpoint") || DEFAULT_ENDPOINT; },
  get key() { return localStorage.getItem("kevKey") || ""; },
};
let TOOLS = [];
let CATEGORIES = [];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toolCard(t, score) {
  const io = (t.inputs?.length || t.outputs?.length) ? `<div class="io">${esc((t.inputs || []).join(", ") || "—")} → ${esc((t.outputs || []).join(", ") || "—")}</div>` : "";
  const install = t.install ? `<code class="install">${esc(t.install)}</code>` : "";
  const scoreHtml = score === undefined ? "" : `<span class="score">${(score * 100).toFixed(0)}%</span>`;
  const bar = score === undefined ? "" : `<div class="bar"><span style="width:${(score * 100).toFixed(1)}%"></span></div>`;
  return `<div class="card">${scoreHtml}<h3><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a></h3>
    <p>${esc(t.description)}</p>${io}
    <div class="meta"><span class="badge">${esc(t.category)}</span><span class="badge">${esc(t.language)}</span><span class="badge">${esc(t.license)}</span></div>
    ${install}${bar}</div>`;
}

function renderBrowse() {
  const q = $("search").value.trim().toLowerCase();
  const cat = $("catFilter").value;
  const hits = TOOLS.filter((t) => (!cat || t.category === cat) &&
    (!q || [t.name, t.description, t.category, t.language, ...(t.inputs || []), ...(t.outputs || [])].join(" ").toLowerCase().includes(q)));
  $("count").textContent = `${hits.length} of ${TOOLS.length} tools`;
  $("grid").innerHTML = hits.map((t) => toolCard(t)).join("");
}

async function systemOne(state, questions) {
  const headers = { "content-type": "application/json" };
  if (settings.key) headers.authorization = `Bearer ${settings.key}`;
  const r = await fetch(`${settings.endpoint.replace(/\/$/, "")}/v1/systemone`, {
    method: "POST", headers, body: JSON.stringify({ model: "kev-latest", state, questions }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(r.status === 401 ? "Unauthorized — set your API key in Settings." : `Kev returned ${r.status}: ${body.slice(0, 200)}`);
  }
  return (await r.json()).answers;
}

function toolOption(t) {
  const io = (t.inputs?.length || t.outputs?.length) ? ` Input: ${(t.inputs || []).join(", ") || "n/a"}; output: ${(t.outputs || []).join(", ") || "n/a"}.` : "";
  return `${t.name}: ${t.description}${io}`;
}

async function ask() {
  const task = $("task").value.trim();
  if (!task) { setStatus("Describe your task first.", true); return; }
  $("askBtn").disabled = true;
  $("categories").innerHTML = "";
  $("results").innerHTML = "";
  const slow = setTimeout(() => setStatus("Waiting for Kev… the GPU may be starting (up to ~1 min after idle)."), 4000);
  try {
    setStatus("Step 1/2: Kev is choosing the relevant categories…");
    const catCriteria = Object.fromEntries(CATEGORIES.map((c) => [slug(c), c]));
    const a1 = await systemOne(task, {
      category: { type: "choice", instructions: "Which category of bioinformatics tools does this task mainly need?", criteria: catCriteria },
    });
    const ranked = Object.entries(a1.category.probabilities).sort((x, y) => y[1] - x[1]);
    const picked = [];
    let mass = 0;
    for (const [id, p] of ranked) {
      picked.push([id, p]);
      mass += p;
      if (mass >= CATEGORY_MASS || picked.length >= MAX_CATEGORIES) break;
    }
    $("categories").innerHTML = picked.map(([id, p]) => `<span class="chip">${esc(catCriteria[id])} <b>${(p * 100).toFixed(0)}%</b></span>`).join("");

    setStatus("Step 2/2: Kev is ranking tools in those categories…");
    const questions = {};
    for (const [id] of picked) {
      const tools = TOOLS.filter((t) => slug(t.category) === id);
      questions[id] = { type: "choice", instructions: "Which tool in this list is the best fit for this task and data?",
        criteria: Object.fromEntries(tools.map((t) => [t.id, toolOption(t)])) };
    }
    const a2 = await systemOne(task, questions);
    const scored = [];
    for (const [id, pCat] of picked) {
      for (const [toolId, pTool] of Object.entries(a2[id].probabilities)) {
        scored.push([TOOLS.find((t) => t.id === toolId), pCat * pTool]);
      }
    }
    scored.sort((x, y) => y[1] - x[1]);
    $("results").innerHTML = scored.slice(0, TOP_N).map(([t, s]) => `<li>${toolCard(t, s)}</li>`).join("");
    setStatus(`Top ${Math.min(TOP_N, scored.length)} of ${scored.length} candidate tools. Score = P(category) × P(tool | category).`);
  } catch (e) {
    setStatus(e.message.includes("Failed to fetch") ? `Couldn't reach ${settings.endpoint}. Check the endpoint in Settings and that it's deployed.` : e.message, true);
  } finally {
    clearTimeout(slow);
    $("askBtn").disabled = false;
  }
}

function setStatus(msg, error = false, el = "status") {
  $(el).textContent = msg;
  $(el).classList.toggle("error", error);
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === b.dataset.tab));
  }));
}

function initSettings() {
  $("endpoint").value = settings.endpoint;
  $("apikey").value = settings.key;
  $("saveSettings").addEventListener("click", () => {
    localStorage.setItem("kevEndpoint", $("endpoint").value.trim() || DEFAULT_ENDPOINT);
    localStorage.setItem("kevKey", $("apikey").value.trim());
    setStatus("Saved in this browser.", false, "settingsStatus");
  });
  $("testEndpoint").addEventListener("click", async () => {
    setStatus("Testing… (can take ~1 min if the GPU is cold)", false, "settingsStatus");
    try {
      const a = await systemOne("Samtools sorts BAM files.", { q: { type: "noul", instructions: "Is this about bioinformatics?" } });
      setStatus(`Connected. Test answer: ${(a.q.noul * 100).toFixed(0)}% yes.`, false, "settingsStatus");
    } catch (e) { setStatus(e.message, true, "settingsStatus"); }
  });
}

async function init() {
  initTabs();
  initSettings();
  TOOLS = await (await fetch("tools.json")).json();
  CATEGORIES = [...new Set(TOOLS.map((t) => t.category))];
  $("catFilter").innerHTML += CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("");
  $("toolTotal").textContent = `${TOOLS.length} tools in ${CATEGORIES.length} categories`;
  $("search").addEventListener("input", renderBrowse);
  $("catFilter").addEventListener("change", renderBrowse);
  $("askBtn").addEventListener("click", ask);
  document.querySelectorAll(".ex").forEach((b) => b.addEventListener("click", () => { $("task").value = b.textContent; }));
  renderBrowse();
}
init();
