import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as core from "../site/core.js";
import {
  modelState,
  NO_MODEL_CATEGORIES,
  pickStages,
  stageQuestions,
  stepState,
  toolQuestion,
  topTools,
} from "../playground/static/pipeline.js";

const tools = JSON.parse(await readFile(new URL("../site/tools.json", import.meta.url), "utf8"));

test("stageQuestions asks one hinted yes/no question per category", () => {
  const questions = stageQuestions(core.STAGE_ORDER);
  assert.equal(Object.keys(questions).length, 21);
  for (const category of core.STAGE_ORDER) {
    const question = questions[core.slug(category)];
    const hint = core.CATEGORY_HINTS[category];
    assert.equal(question.type, "noul");
    assert.equal(
      question.instructions,
      `Does this task or pipeline include a step that needs ${category} tools${hint ? ` (${hint})` : ""}?`,
    );
  }
});

test("pickStages includes scores at threshold and follows STAGE_ORDER", () => {
  const answers = Object.fromEntries(core.STAGE_ORDER.map((category) => [core.slug(category), { noul: 0.1 }]));
  answers[core.slug("Natural products & metabolomics")] = { noul: 0.8 };
  answers[core.slug("Genome assembly")] = { noul: 0.5 };
  answers[core.slug("Sequence QC & trimming")] = { noul: 0.49 };

  assert.deepEqual(pickStages(answers), [
    { category: "Genome assembly", p: 0.5 },
    { category: "Natural products & metabolomics", p: 0.8 },
  ]);
});

test("pickStages falls back to the top category below threshold", () => {
  const answers = Object.fromEntries(core.STAGE_ORDER.map((category) => [core.slug(category), { noul: 0.1 }]));
  answers[core.slug("Cheminformatics")] = { noul: 0.35 };

  assert.deepEqual(pickStages(answers), [{ category: "Cheminformatics", p: 0.35 }]);
});

test("pickStages caps results at six and preserves STAGE_ORDER", () => {
  const answers = Object.fromEntries(core.STAGE_ORDER.map((category) => [core.slug(category), { noul: 0.9 }]));
  const expected = core.STAGE_ORDER.slice(0, 6).map((category) => ({ category, p: 0.9 }));

  assert.deepEqual(pickStages(answers), expected);
});

test("toolQuestion lists only the selected category's tools with IO criteria", () => {
  const category = "Natural products & metabolomics";
  const question = toolQuestion(category, tools)[core.slug(category)];
  const matchingTools = tools.filter((tool) => tool.category === category);

  assert.equal(question.type, "choice");
  assert.equal(question.instructions, "Which tool in this list is the best fit for this task and data?");
  assert.deepEqual(Object.keys(question.criteria).sort(), matchingTools.map((tool) => tool.id).sort());
  assert.match(question.criteria.antismash, /antiSMASH:.*Input: FASTA/);
});

test("topTools ranks the available tool probabilities and respects n", () => {
  const categoryTools = tools.filter((tool) => tool.category === "Genome assembly").slice(0, 4);
  const answer = {
    probabilities: Object.fromEntries(categoryTools.map((tool, i) => [tool.id, (i + 1) / 10])),
  };

  assert.deepEqual(topTools(answer, categoryTools, 2).map(({ tool, p }) => [tool.id, p]), [
    [categoryTools[3].id, 0.4],
    [categoryTools[2].id, 0.3],
  ]);
});

test("stepState includes the task, category, and exact category hint", () => {
  const task = "Assemble a bacterial genome";
  const category = "Genome assembly";
  assert.equal(
    stepState(task, category),
    `${task}\n\nCurrent pipeline step: ${category} — ${core.CATEGORY_HINTS[category]}`,
  );
});

test("modelState isolates the category and its hint from the overall task", () => {
  const category = "Genome assembly";
  const task = "Assemble a bacterial genome, find BGCs, then dock products";
  const state = modelState(category);

  assert.equal(state, `Pipeline step: ${category} — ${core.CATEGORY_HINTS[category]}.`);
  assert.ok(state.includes(category));
  assert.ok(state.includes(core.CATEGORY_HINTS[category]));
  assert.equal(state.includes(task), false);
});

test("NO_MODEL_CATEGORIES contains only pipeline stages", () => {
  for (const category of NO_MODEL_CATEGORIES) {
    assert.ok(core.STAGE_ORDER.includes(category), `${category} is not a pipeline stage`);
  }
});
