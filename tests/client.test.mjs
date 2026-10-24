import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { KevError, listModels, systemOne } from "../site/core.js";

const questions = {
  category: { type: "choice", options: ["Variant calling"] },
  confidence: { type: "noul" },
};
const answers = {
  category: { type: "choice", choice: "Variant calling", probabilities: { "variant-calling": 1 } },
  confidence: { type: "noul", noul: 0.9 },
};

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(endpoint, server);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body;
}

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

function isKevError(kind) {
  return (error) => error instanceof KevError && error.kind === kind;
}

test("systemOne retries a 503 once and returns answers after success", async () => {
  let requestCount = 0;
  let requestBody;
  const retryEvents = [];
  await withServer((request, response) => {
    requestCount += 1;
    readBody(request).then((body) => {
      requestBody = JSON.parse(body);
      if (requestCount === 1) sendJson(response, 503, { error: "busy" });
      else sendJson(response, 200, { answers });
    });
  }, async (endpoint) => {
    const result = await systemOne({
      endpoint,
      state: { task: "call variants" },
      questions,
      backoffMs: [1, 1, 1],
      onRetry: (event) => retryEvents.push(event),
    });
    assert.deepEqual(result, answers);
    assert.equal(requestCount, 2);
    assert.deepEqual(requestBody, {
      model: "kev-latest",
      state: { task: "call variants" },
      questions,
    });
    assert.equal(retryEvents.length, 1);
    assert.equal(retryEvents[0].attempt, 1);
    assert.equal(retryEvents[0].error.kind, "server");
    assert.equal(retryEvents[0].error.status, 503);
    assert.equal(retryEvents[0].waitMs, 1);
  });
});

test("systemOne maps 401 to auth and does not retry", async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    sendJson(response, 401, { error: "no" });
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions, retries: 3, backoffMs: [1, 1, 1] }),
      isKevError("auth"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne maps 422 to bad_request and does not retry", async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    sendJson(response, 422, { error: "invalid input" });
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions, retries: 3, backoffMs: [1, 1, 1] }),
      isKevError("bad_request"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne reports timeout for a server that never responds", async () => {
  let requestCount = 0;
  await withServer(() => {
    requestCount += 1;
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions, timeoutMs: 50, retries: 0 }),
      isKevError("timeout"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne maps invalid JSON to bad_response without retrying", async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end("{not json");
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions, retries: 3, backoffMs: [1, 1, 1] }),
      isKevError("bad_response"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne rejects a response missing a question answer", async () => {
  await withServer((_request, response) => {
    sendJson(response, 200, { answers: { category: answers.category } });
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions }),
      isKevError("bad_response"),
    );
  });
});

test("systemOne maps caller abort during a request to aborted", async () => {
  const controller = new AbortController();
  let requestCount = 0;
  await withServer(() => {
    requestCount += 1;
    setTimeout(() => controller.abort(), 10);
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({ endpoint, state: {}, questions, signal: controller.signal, retries: 0 }),
      isKevError("aborted"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne aborts while waiting between retries", async () => {
  const controller = new AbortController();
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    sendJson(response, 503, { error: "busy" });
  }, async (endpoint) => {
    await assert.rejects(
      systemOne({
        endpoint,
        state: {},
        questions,
        signal: controller.signal,
        backoffMs: [100],
        onRetry: () => setTimeout(() => controller.abort(), 5),
      }),
      isKevError("aborted"),
    );
    assert.equal(requestCount, 1);
  });
});

test("systemOne sends authorization only when a key is supplied and normalizes endpoint slashes", async () => {
  const seen = [];
  await withServer(async (request, response) => {
    await readBody(request);
    seen.push({ authorization: request.headers.authorization, url: request.url });
    sendJson(response, 200, { answers });
  }, async (endpoint) => {
    await systemOne({ endpoint: `${endpoint}///`, state: {}, questions });
    await systemOne({ endpoint: `${endpoint}/`, key: "test-key", state: {}, questions });
    assert.deepEqual(seen, [
      { authorization: undefined, url: "/v1/systemone" },
      { authorization: "Bearer test-key", url: "/v1/systemone" },
    ]);
  });
});

test("listModels GETs the models endpoint, returns JSON, and does not retry", async () => {
  const models = [{ name: "kev-latest", run: "jaredpalmer/kev-27b" }];
  let requestCount = 0;
  await withServer((request, response) => {
    requestCount += 1;
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/v1/models");
    sendJson(response, 200, { models });
  }, async (endpoint) => {
    assert.deepEqual(await listModels({ endpoint: `${endpoint}/`, key: "api-key" }), { models });
    assert.equal(requestCount, 1);
  });
});

test("listModels reports bad_response for a missing models array and does not retry", async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    sendJson(response, 200, { data: [] });
  }, async (endpoint) => {
    await assert.rejects(listModels({ endpoint }), isKevError("bad_response"));
    assert.equal(requestCount, 1);
  });
});

test("listModels does not retry a retryable server error", async () => {
  let requestCount = 0;
  await withServer((_request, response) => {
    requestCount += 1;
    sendJson(response, 503, { error: "busy" });
  }, async (endpoint) => {
    await assert.rejects(listModels({ endpoint }), isKevError("server"));
    assert.equal(requestCount, 1);
  });
});
