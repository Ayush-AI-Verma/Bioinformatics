import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeUrl, STAGE_ORDER } from "../site/core.js";

const tools = JSON.parse(readFileSync(new URL("../site/tools.json", import.meta.url), "utf8"));
const requiredStrings = ["name", "category", "description", "language", "license", "url"];

test("catalog contains 299 tools with unique, non-empty IDs", () => {
  assert.ok(Array.isArray(tools));
  assert.equal(tools.length, 299);
  const ids = tools.map((tool) => tool.id);
  assert.ok(ids.every((id) => typeof id === "string" && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});

test("catalog entries have required strings and valid input/output/install types", () => {
  for (const tool of tools) {
    for (const field of requiredStrings) {
      assert.equal(typeof tool[field], "string", `${tool.id}: ${field} must be a string`);
      assert.ok(tool[field].trim().length > 0, `${tool.id}: ${field} must be non-empty`);
    }
    assert.equal(typeof tool.install, "string", `${tool.id}: install must be a string`);
    assert.ok(Array.isArray(tool.inputs), `${tool.id}: inputs must be an array`);
    assert.ok(tool.inputs.every((value) => typeof value === "string"), `${tool.id}: inputs must contain strings`);
    assert.ok(Array.isArray(tool.outputs), `${tool.id}: outputs must be an array`);
    assert.ok(tool.outputs.every((value) => typeof value === "string"), `${tool.id}: outputs must contain strings`);
  }
});

test("catalog uses every stage category and no categories outside STAGE_ORDER", () => {
  const usedCategories = new Set(tools.map((tool) => tool.category));
  for (const category of usedCategories) assert.ok(STAGE_ORDER.includes(category), category);
  assert.deepEqual([...usedCategories].sort(), [...STAGE_ORDER].sort());
});

test("every catalog URL is a safe HTTP or HTTPS URL", () => {
  for (const tool of tools) {
    assert.notEqual(safeUrl(tool.url), "#", `${tool.id}: ${tool.url}`);
  }
});
