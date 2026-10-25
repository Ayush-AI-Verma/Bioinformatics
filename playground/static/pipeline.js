import * as core from "../../site/core.js";

export function stageQuestions(categories = core.STAGE_ORDER) {
  return Object.fromEntries(categories.map((category) => {
    const hint = core.CATEGORY_HINTS[category];
    return [
      core.slug(category),
      {
        type: "noul",
        instructions: `Does this task or pipeline include a step that needs ${category} tools${hint ? ` (${hint})` : ""}?`,
      },
    ];
  }));
}

export function pickStages(answers, categories = core.STAGE_ORDER) {
  const nouls = Object.fromEntries(categories.map((category) => {
    const key = core.slug(category);
    return [key, answers?.[key]?.noul];
  }));
  const namesBySlug = new Map(categories.map((category) => [core.slug(category), category]));
  return core.pickPipelineSteps(nouls, categories)
    .map(([categorySlug, p]) => ({ category: namesBySlug.get(categorySlug), p }))
    .filter((stage) => stage.category);
}

function toolDescription(tool) {
  const inputs = (tool.inputs || []).join(", ") || "n/a";
  const outputs = (tool.outputs || []).join(", ") || "n/a";
  const formats = (tool.inputs?.length || tool.outputs?.length)
    ? ` Input: ${inputs}; output: ${outputs}.`
    : "";
  return `${tool.name}: ${tool.description}${formats}`;
}

export function toolQuestion(category, tools) {
  const criteria = Object.fromEntries(
    tools.filter((tool) => tool.category === category)
      .map((tool) => [tool.id, toolDescription(tool)]),
  );
  return {
    [core.slug(category)]: {
      type: "choice",
      instructions: "Which tool in this list is the best fit for this task and data?",
      criteria,
    },
  };
}

export function topTools(answer, tools, n = 3) {
  const probabilities = answer?.probabilities || {};
  return tools
    .filter((tool) => Object.prototype.hasOwnProperty.call(probabilities, tool.id))
    .map((tool) => ({ tool, p: probabilities[tool.id] }))
    .filter(({ p }) => typeof p === "number" && Number.isFinite(p))
    .sort((a, b) => b.p - a.p)
    .slice(0, n);
}

export function stepState(task, category) {
  return `${task}\n\nCurrent pipeline step: ${category} — ${core.CATEGORY_HINTS[category]}`;
}
