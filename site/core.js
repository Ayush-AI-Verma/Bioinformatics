export const CATEGORY_MASS = 0.8;
export const MAX_CATEGORIES = 3;
export const PIPELINE_THRESHOLD = 0.5;
export const MAX_PIPELINE_STEPS = 6;
export const LIMITS = { minTask: 10, maxTask: 4000 };
export const STAGE_ORDER = [
  "Sequence QC & trimming",
  "Long-read sequencing",
  "Read alignment",
  "Genome assembly",
  "Genome annotation",
  "Variant calling",
  "Population genetics & GWAS",
  "RNA-seq quantification & differential expression",
  "Single-cell analysis",
  "Epigenomics (ChIP/ATAC/methylation)",
  "Metagenomics & microbiome",
  "Sequence search & multiple alignment",
  "Phylogenetics & evolution",
  "Protein structure prediction & analysis",
  "Cheminformatics",
  "Molecular docking & virtual screening",
  "Proteomics & mass spectrometry",
  "File formats & utilities",
  "Visualization & genome browsers",
  "Workflow managers",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "to", "of", "in", "on", "my", "i", "a",
  "an", "want", "have", "need", "using", "use", "data", "files", "file",
]);
const PRIVATE_LICENSES = new Set(["Proprietary/academic", "See project"]);
const RETRYABLE_SERVER_STATUSES = new Set([500, 502, 503, 504]);

export function slug(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

export function safeUrl(u) {
  if (typeof u !== "string") return "#";
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? u : "#";
  } catch {
    return "#";
  }
}

export function installMethod(install) {
  const value = String(install ?? "").trim().toLowerCase();
  if (!value) return "none";
  if (value.startsWith("go install")) return "go";
  if (value.startsWith("mvn")) return "maven";
  for (const method of ["conda", "pip", "docker", "brew", "npm"]) {
    if (value.startsWith(method)) return method;
  }
  return "other";
}

export function validateTask(text) {
  const task = String(text ?? "").trim();
  if (!task) return "Describe your task first.";
  if (task.length < LIMITS.minTask) return "Add a bit more detail (at least 10 characters).";
  if (task.length > LIMITS.maxTask) return "That's too long — keep it under 4000 characters.";
  return null;
}

export function validateEndpoint(url, pageProtocol = "https:") {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: "Endpoint must be an http(s) URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Endpoint must be an http(s) URL." };
  }
  const isLocalhost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (pageProtocol === "https:" && parsed.protocol === "http:" && !isLocalhost) {
    return {
      ok: true,
      warning: "Browsers block http:// endpoints from an https:// page (mixed content).",
    };
  }
  return { ok: true };
}

export function normalizeEndpoint(url) {
  return String(url ?? "").trim().replace(/\/+$/, "");
}

export function pickCategories(probabilities, mass = CATEGORY_MASS, max = MAX_CATEGORIES) {
  const ranked = Object.entries(probabilities ?? {})
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  const picked = [];
  let total = 0;
  for (const [id, probability] of ranked) {
    if (picked.length >= max) break;
    picked.push([id, probability]);
    total += Number(probability);
    if (total >= mass) break;
  }
  return picked;
}

export function pickPipelineSteps(
  nouls,
  categories,
  threshold = PIPELINE_THRESHOLD,
  max = MAX_PIPELINE_STEPS,
) {
  const categoryNames = new Map((categories ?? []).map((category, index) => [slug(category), { category, index }]));
  const ranked = Object.entries(nouls ?? {})
    .map(([id, probability], index) => ({
      id,
      probability,
      index,
      category: categoryNames.get(id)?.category,
      categoryIndex: categoryNames.get(id)?.index ?? index,
    }))
    .sort((a, b) => Number(b.probability) - Number(a.probability));
  let picked = ranked.filter(({ probability }) => Number(probability) >= threshold);
  if (picked.length === 0 && ranked.length > 0) picked = ranked.slice(0, 1);
  if (picked.length > max) picked = picked.slice(0, max);

  const stageIndex = (category) => STAGE_ORDER.indexOf(category);
  return picked
    .sort((a, b) => {
      const aStage = stageIndex(a.category);
      const bStage = stageIndex(b.category);
      const aKnown = aStage >= 0;
      const bKnown = bStage >= 0;
      if (aKnown && bKnown) return aStage - bStage;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.categoryIndex - b.categoryIndex || a.index - b.index;
    })
    .map(({ id, probability }) => [id, probability]);
}

export function scoreTools(picked, answers, toolsById) {
  const scored = [];
  for (const [catSlug, pCat] of picked ?? []) {
    const probabilities = answers?.[catSlug]?.probabilities;
    if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) continue;
    const tools = Object.entries(probabilities)
      .map(([id, pTool], index) => ({ tool: toolsById?.get(id), pTool, index }))
      .filter(({ tool }) => tool !== undefined && tool !== null)
      .sort((a, b) => Number(b.pTool) - Number(a.pTool) || a.index - b.index);
    tools.forEach(({ tool, pTool }, index) => {
      scored.push({
        tool,
        score: Number(pCat) * Number(pTool),
        pCat,
        pTool,
        catSlug,
        rankInCat: index + 1,
      });
    });
  }
  return scored.sort((a, b) => b.score - a.score);
}

function tokens(value) {
  return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function fieldMatchesToken(field, token) {
  for (const fieldToken of field) {
    if (fieldToken === token) return true;
    const shorterLength = Math.min(fieldToken.length, token.length);
    if (shorterLength >= 4 &&
        (fieldToken.startsWith(token) || token.startsWith(fieldToken))) return true;
  }
  return false;
}

export function keywordSearch(query, tools, n = 10) {
  const queryTokens = [...new Set(tokens(query).filter((token) => token.length >= 2 && !STOPWORDS.has(token)))];
  if (queryTokens.length === 0) return [];
  const results = [];
  for (const tool of tools ?? []) {
    const fields = [
      [tokens(tool.name), 3],
      [tokens([...(tool.inputs ?? []), ...(tool.outputs ?? [])].join(" ")), 2],
      [tokens(tool.category), 1.5],
      [tokens(tool.description), 1],
    ].map(([fieldTokens, weight]) => [new Set(fieldTokens), weight]);
    const matched = [];
    let score = 0;
    for (const token of queryTokens) {
      let tokenMatched = false;
      for (const [field, weight] of fields) {
        if (fieldMatchesToken(field, token)) {
          score += weight;
          tokenMatched = true;
        }
      }
      if (tokenMatched) matched.push(token);
    }
    if (score > 0) results.push({ tool, score, matched });
  }
  const maxScore = Math.max(...results.map(({ score }) => score));
  return results
    .map((result) => ({ ...result, score: result.score / maxScore }))
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, n);
}

export function filterTools(tools, f = {}) {
  return (tools ?? []).filter((tool) => {
    if (f.input && !(tool.inputs ?? []).includes(f.input)) return false;
    if (f.output && !(tool.outputs ?? []).includes(f.output)) return false;
    if (f.license === "__open" && PRIVATE_LICENSES.has(tool.license)) return false;
    if (f.license && f.license !== "__open" && tool.license !== f.license) return false;
    if (f.language && tool.language !== f.language) return false;
    if (f.install && installMethod(tool.install) !== f.install) return false;
    return true;
  });
}

function frequencyFacet(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a, countA], [b, countB]) => countB - countA || a.localeCompare(b))
    .map(([value]) => value);
}

export function facetValues(tools) {
  const inputs = [];
  const outputs = [];
  const licenses = [];
  const languages = [];
  const installs = [];
  for (const tool of tools ?? []) {
    inputs.push(...new Set(tool.inputs ?? []));
    outputs.push(...new Set(tool.outputs ?? []));
    if (tool.license) licenses.push(tool.license);
    if (tool.language) languages.push(tool.language);
    installs.push(installMethod(tool.install));
  }
  return {
    inputs: frequencyFacet(inputs),
    outputs: frequencyFacet(outputs),
    licenses: frequencyFacet(licenses),
    languages: frequencyFacet(languages),
    installs: frequencyFacet(installs),
  };
}

export function encodeShare({ q, mode } = {}) {
  const params = new URLSearchParams({ q: String(q ?? "") });
  if (mode === "pipeline") params.set("mode", "pipeline");
  return `#${params.toString()}`;
}

export function decodeShare(hash = "") {
  const params = new URLSearchParams(String(hash).replace(/^#/, ""));
  return {
    q: params.get("q") ?? "",
    mode: params.get("mode") === "pipeline" ? "pipeline" : "single",
  };
}

export function addHistory(list, entry, max = 20) {
  const next = (list ?? []).filter((item) => item.q !== entry.q || item.mode !== entry.mode);
  next.unshift(entry);
  return next.slice(0, Math.max(0, max));
}

export function toggleFavorite(ids, id) {
  const current = ids ?? [];
  return current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id];
}

export class KevError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "KevError";
    this.kind = kind;
    this.status = status;
  }
}

function abortedError() {
  return new KevError("aborted", "Request was aborted.");
}

function httpError(status, body) {
  if (status === 401 || status === 403) {
    return new KevError("auth", "Unauthorized — set your API key in Settings.", status);
  }
  if (status === 404) return new KevError("not_found", "Kev endpoint was not found.", status);
  if (status === 400 || status === 413 || status === 422) {
    return new KevError("bad_request", `Kev returned ${status}: ${body.slice(0, 200)}`, status);
  }
  if (status === 429) return new KevError("rate_limited", "Kev is rate limiting requests.", status);
  if (status >= 500 && status < 600) {
    return new KevError("server", `Kev returned ${status}: ${body.slice(0, 200)}`, status);
  }
  return new KevError("bad_response", `Kev returned an unexpected HTTP status (${status}).`, status);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateAnswers(data, questions) {
  if (!isRecord(data) || !isRecord(data.answers)) return false;
  for (const [key, question] of Object.entries(questions ?? {})) {
    if (!Object.hasOwn(data.answers, key)) return false;
    const answer = data.answers[key];
    if (!isRecord(answer)) return false;
    if (question?.type === "choice" && !isRecord(answer.probabilities)) return false;
    if (question?.type === "noul" && (typeof answer.noul !== "number" || !Number.isFinite(answer.noul))) return false;
  }
  return true;
}

async function requestJson({ endpoint, key, path, method, body, signal, timeoutMs, fetchImpl }) {
  if (signal?.aborted) throw abortedError();
  const controller = new AbortController();
  let timedOut = false;
  const abortCaller = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", abortCaller, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const headers = { "content-type": "application/json" };
  if (key) headers.authorization = `Bearer ${key}`;
  const options = { method, headers, signal: controller.signal };
  if (body !== undefined) options.body = JSON.stringify(body);
  try {
    const response = await fetchImpl(`${normalizeEndpoint(endpoint)}${path}`, options);
    if (signal?.aborted) throw abortedError();
    const responseBody = await response.text();
    if (signal?.aborted) throw abortedError();
    if (!response.ok) throw httpError(response.status, responseBody);
    let data;
    try {
      data = JSON.parse(responseBody);
    } catch {
      throw new KevError("bad_response", "Kev returned an invalid JSON response.", response.status);
    }
    return data;
  } catch (error) {
    if (error instanceof KevError) throw error;
    if (signal?.aborted) throw abortedError();
    if (timedOut) throw new KevError("timeout", "Kev request timed out.");
    throw new KevError("network", "Couldn't reach the Kev endpoint.");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortCaller);
  }
}

function retryDelay(backoffMs, retryAttempt) {
  if (!Array.isArray(backoffMs) || backoffMs.length === 0) return 0;
  return backoffMs[Math.min(retryAttempt - 1, backoffMs.length - 1)] ?? 0;
}

function abortableSleep(ms, signal, sleep) {
  if (signal?.aborted) return Promise.reject(abortedError());
  if (!signal) return Promise.resolve().then(() => sleep(ms));
  let onAbort;
  const abortPromise = new Promise((_, reject) => {
    onAbort = () => reject(abortedError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const sleepPromise = Promise.resolve().then(() => sleep(ms));
  return Promise.race([sleepPromise, abortPromise]).finally(() => {
    signal.removeEventListener("abort", onAbort);
  });
}

function shouldRetry(error) {
  return error.kind === "timeout" ||
    error.kind === "network" ||
    error.kind === "rate_limited" ||
    (error.kind === "server" && RETRYABLE_SERVER_STATUSES.has(error.status));
}

export async function systemOne({
  endpoint,
  key,
  state,
  questions,
  signal,
  timeoutMs = 180000,
  retries = 3,
  backoffMs = [2000, 5000, 10000],
  onRetry,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const maxRetries = Math.max(0, Math.floor(Number(retries) || 0));
  for (let attempt = 0; ; attempt += 1) {
    try {
      const data = await requestJson({
        endpoint,
        key,
        path: "/v1/systemone",
        method: "POST",
        body: { model: "kev-latest", state, questions },
        signal,
        timeoutMs,
        fetchImpl,
      });
      if (!validateAnswers(data, questions)) {
        throw new KevError("bad_response", "Kev returned an unexpected System One response.");
      }
      return data.answers;
    } catch (error) {
      if (signal?.aborted) throw abortedError();
      if (!(error instanceof KevError) || !shouldRetry(error) || attempt >= maxRetries) throw error;
      const retryAttempt = attempt + 1;
      const waitMs = retryDelay(backoffMs, retryAttempt);
      onRetry?.({ attempt: retryAttempt, error, waitMs });
      await abortableSleep(waitMs, signal, sleep);
    }
  }
}

export async function listModels({
  endpoint,
  key,
  signal,
  timeoutMs = 180000,
  fetchImpl = globalThis.fetch,
}) {
  const data = await requestJson({
    endpoint,
    key,
    path: "/v1/models",
    method: "GET",
    signal,
    timeoutMs,
    fetchImpl,
  });
  if (!isRecord(data) || !Array.isArray(data.models)) {
    throw new KevError("bad_response", "Kev returned an unexpected models response.");
  }
  return data;
}
