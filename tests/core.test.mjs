import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORY_MASS,
  KevError,
  LIMITS,
  MAX_CATEGORIES,
  MAX_PIPELINE_STEPS,
  PIPELINE_THRESHOLD,
  STAGE_ORDER,
  addHistory,
  decodeShare,
  encodeShare,
  esc,
  facetValues,
  filterTools,
  installMethod,
  keywordSearch,
  normalizeEndpoint,
  pickCategories,
  pickPipelineSteps,
  safeUrl,
  scoreTools,
  slug,
  toggleFavorite,
  validateEndpoint,
  validateTask,
} from "../site/core.js";

test("exports the catalog and ranking constants", () => {
  assert.equal(CATEGORY_MASS, 0.8);
  assert.equal(MAX_CATEGORIES, 3);
  assert.equal(PIPELINE_THRESHOLD, 0.5);
  assert.equal(MAX_PIPELINE_STEPS, 6);
  assert.deepEqual(LIMITS, { minTask: 10, maxTask: 4000 });
  assert.equal(STAGE_ORDER.length, 20);
});

test("slug lowercases, collapses non-alphanumeric runs, and trims dashes", () => {
  assert.equal(slug(" RNA-seq / QC & Trimming! "), "rna-seq-qc-trimming");
  assert.equal(slug(null), "");
});

test("esc escapes HTML-sensitive characters and handles nullish values", () => {
  assert.equal(esc(`<script title="x">'&</script>`), "&lt;script title=&quot;x&quot;&gt;&#39;&amp;&lt;/script&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("safeUrl allows only absolute HTTP and HTTPS URLs", () => {
  assert.equal(safeUrl("https://example.org/path"), "https://example.org/path");
  assert.equal(safeUrl("http://localhost:8080"), "http://localhost:8080");
  assert.equal(safeUrl("javascript:alert(1)"), "#");
  assert.equal(safeUrl("data:text/html,<script>"), "#");
  assert.equal(safeUrl("/relative/path"), "#");
  assert.equal(safeUrl(null), "#");
});

test("installMethod detects each supported install prefix", () => {
  assert.equal(installMethod("  conda install -c bioconda samtools"), "conda");
  assert.equal(installMethod("pip install tool"), "pip");
  assert.equal(installMethod("docker pull image"), "docker");
  assert.equal(installMethod("brew install tool"), "brew");
  assert.equal(installMethod("npm install tool"), "npm");
  assert.equal(installMethod("go install example/tool"), "go");
  assert.equal(installMethod("mvn package"), "maven");
  assert.equal(installMethod(""), "none");
  assert.equal(installMethod("download a release"), "other");
});

test("validateTask trims and enforces the 10 and 4000 character boundaries", () => {
  assert.equal(validateTask("   "), "Describe your task first.");
  assert.equal(validateTask("123456789"), "Add a bit more detail (at least 10 characters).");
  assert.equal(validateTask("1234567890"), null);
  assert.equal(validateTask(` ${"x".repeat(4000)} `), null);
  assert.equal(validateTask("x".repeat(4001)), "That's too long — keep it under 4000 characters.");
});

test("validateEndpoint rejects invalid schemes and reports mixed content", () => {
  assert.deepEqual(validateEndpoint("file:///tmp/api"), {
    ok: false,
    error: "Endpoint must be an http(s) URL.",
  });
  assert.deepEqual(validateEndpoint("not a URL"), {
    ok: false,
    error: "Endpoint must be an http(s) URL.",
  });
  assert.deepEqual(validateEndpoint("http://api.example.org"), {
    ok: true,
    warning: "Browsers block http:// endpoints from an https:// page (mixed content).",
  });
  assert.deepEqual(validateEndpoint("http://localhost:8009"), { ok: true });
  assert.deepEqual(validateEndpoint("http://127.0.0.1:8009"), { ok: true });
  assert.deepEqual(validateEndpoint("http://api.example.org", "http:"), { ok: true });
});

test("normalizeEndpoint trims whitespace and trailing slashes", () => {
  assert.equal(normalizeEndpoint("  https://api.example.org/root///  "), "https://api.example.org/root");
});

test("pickCategories accumulates probability mass and respects the maximum", () => {
  assert.deepEqual(pickCategories({ a: 0.55, b: 0.3, c: 0.1, d: 0.05 }), [
    ["a", 0.55],
    ["b", 0.3],
  ]);
  assert.deepEqual(pickCategories({ a: 0.4, b: 0.3, c: 0.2, d: 0.1 }, 1, 3), [
    ["a", 0.4],
    ["b", 0.3],
    ["c", 0.2],
  ]);
  assert.deepEqual(pickCategories({}), []);
});

test("pickPipelineSteps applies threshold, max cutoff, fallback, and stage ordering", () => {
  const categories = [
    "Variant calling",
    "Read alignment",
    "Sequence QC & trimming",
    "Genome assembly",
    "Other stage",
  ];
  const selected = pickPipelineSteps({
    "variant-calling": 0.91,
    "read-alignment": 0.88,
    "sequence-qc-trimming": 0.82,
    "genome-assembly": 0.79,
    "other-stage": 0.72,
  }, categories, 0.5, 3);
  assert.deepEqual(selected, [
    ["sequence-qc-trimming", 0.82],
    ["read-alignment", 0.88],
    ["variant-calling", 0.91],
  ]);

  assert.deepEqual(pickPipelineSteps({
    "variant-calling": 0.49,
    "read-alignment": 0.2,
  }, categories), [["variant-calling", 0.49]]);

  assert.deepEqual(pickPipelineSteps({
    "other-stage": 0.8,
    "read-alignment": 0.7,
    "sequence-qc-trimming": 0.6,
  }, ["Other stage", "Read alignment", "Sequence QC & trimming"], 0.5, 3), [
    ["sequence-qc-trimming", 0.6],
    ["read-alignment", 0.7],
    ["other-stage", 0.8],
  ]);
});

test("scoreTools multiplies probabilities, ranks within categories, and skips missing entries", () => {
  const toolsById = new Map([
    ["a", { id: "a", name: "A" }],
    ["b", { id: "b", name: "B" }],
    ["c", { id: "c", name: "C" }],
  ]);
  const result = scoreTools(
    [["alpha", 0.5], ["beta", 0.4], ["missing", 0.9]],
    {
      alpha: { probabilities: { a: 0.8, b: 0.2, unknown: 0.99 } },
      beta: { probabilities: { c: 0.75 } },
    },
    toolsById,
  );
  assert.deepEqual(result.map(({ tool, score, rankInCat }) => [tool.id, score, rankInCat]), [
    ["a", 0.4, 1],
    ["c", 0.30000000000000004, 1],
    ["b", 0.1, 2],
  ]);
  assert.equal(result[0].pCat, 0.5);
  assert.equal(result[0].pTool, 0.8);
  assert.equal(result[0].catSlug, "alpha");
  assert.equal(result[2].catSlug, "alpha");
});

test("keywordSearch normalizes scores and ranks a matching category above unrelated tools", () => {
  const variantTool = {
    id: "variant-caller",
    name: "Variant Caller",
    category: "Variant calling",
    description: "Can call variants from sequencing reads.",
    inputs: ["BAM"],
    outputs: ["VCF"],
  };
  const unrelatedTool = {
    id: "tree-viewer",
    name: "Tree Viewer",
    category: "Phylogenetics & evolution",
    description: "Displays evolutionary trees.",
    inputs: ["Newick"],
    outputs: ["SVG"],
  };
  const results = keywordSearch("call variants from BAM", [unrelatedTool, variantTool]);
  assert.equal(results[0].tool, variantTool);
  assert.equal(results[0].score, 1);
  assert.deepEqual(results[0].matched, ["call", "variants", "bam"]);
  assert.deepEqual(keywordSearch("the and from to", [variantTool]), []);
  assert.deepEqual(keywordSearch("", [variantTool]), []);
});

test("keywordSearch lightly stems prefixes and does not match short or partial prefixes", () => {
  const tools = JSON.parse(readFileSync(new URL("../site/tools.json", import.meta.url), "utf8"));
  const results = keywordSearch(
    "Dock a library of natural compounds (SMILES) against a protein PDB",
    tools,
  );
  assert.equal(results[0].tool.category, "Molecular docking & virtual screening");

  const docTool = { name: "doc", category: "", description: "", inputs: [], outputs: [] };
  assert.deepEqual(keywordSearch("dock", [docTool]), []);

  const annotationTool = { name: "annotation", category: "", description: "", inputs: [], outputs: [] };
  assert.deepEqual(keywordSearch("annotate", [annotationTool]), []);
});

test("filterTools supports exact facets and the open-license sentinel", () => {
  const tools = [
    { id: "open", inputs: ["FASTQ"], outputs: ["BAM"], license: "MIT", language: "C++", install: "conda install x" },
    { id: "proprietary", inputs: ["FASTQ"], outputs: ["VCF"], license: "Proprietary/academic", language: "Python", install: "pip install y" },
    { id: "uncertain", inputs: ["BAM"], outputs: ["VCF"], license: "See project", language: "Python", install: "" },
  ];
  assert.deepEqual(filterTools(tools, { input: "FASTQ", output: "BAM", language: "C++", license: "MIT", install: "conda" }), [tools[0]]);
  assert.deepEqual(filterTools(tools, { license: "__open" }), [tools[0]]);
  assert.deepEqual(filterTools(tools, { license: "Python" }), []);
});

test("facetValues sorts values by frequency and then alphabetically", () => {
  const facets = facetValues([
    { inputs: ["BAM", "FASTQ"], outputs: ["VCF"], license: "MIT", language: "C++", install: "conda install a" },
    { inputs: ["FASTQ"], outputs: ["BAM"], license: "MIT", language: "Python", install: "pip install b" },
    { inputs: ["BAM"], outputs: ["BAM"], license: "GPL-3.0", language: "C++", install: "conda install c" },
  ]);
  assert.deepEqual(facets.inputs, ["BAM", "FASTQ"]);
  assert.deepEqual(facets.outputs, ["BAM", "VCF"]);
  assert.deepEqual(facets.licenses, ["MIT", "GPL-3.0"]);
  assert.deepEqual(facets.languages, ["C++", "Python"]);
  assert.deepEqual(facets.installs, ["conda", "pip"]);
});

test("share encoding round-trips unicode and ampersands with a default single mode", () => {
  const value = { q: "café & RNA-seq", mode: "pipeline" };
  assert.deepEqual(decodeShare(encodeShare(value)), value);
  assert.deepEqual(decodeShare(encodeShare({ q: "find reads", mode: "single" })), {
    q: "find reads",
    mode: "single",
  });
  assert.deepEqual(decodeShare(""), { q: "", mode: "single" });
});

test("addHistory deduplicates by query and mode, prepends, and caps results", () => {
  const existing = [
    { q: "old", mode: "single" },
    { q: "same", mode: "pipeline" },
  ];
  assert.deepEqual(addHistory(existing, { q: "same", mode: "pipeline" }), [
    { q: "same", mode: "pipeline" },
    { q: "old", mode: "single" },
  ]);
  assert.deepEqual(addHistory([], { q: "new", mode: "single" }, 0), []);
  assert.deepEqual(addHistory([{ q: "a" }, { q: "b" }], { q: "c" }, 2), [
    { q: "c" },
    { q: "a" },
  ]);
});

test("toggleFavorite returns a new list while adding or removing an id", () => {
  const ids = ["a", "b"];
  assert.deepEqual(toggleFavorite(ids, "c"), ["a", "b", "c"]);
  assert.deepEqual(toggleFavorite(ids, "a"), ["b"]);
  assert.deepEqual(ids, ["a", "b"]);
});

test("KevError exposes its kind and optional HTTP status", () => {
  const error = new KevError("auth", "Unauthorized", 401);
  assert.equal(error.name, "KevError");
  assert.equal(error.kind, "auth");
  assert.equal(error.status, 401);
});
