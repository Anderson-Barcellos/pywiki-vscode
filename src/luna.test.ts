import assert from "node:assert/strict";
import { test } from "node:test";
import { priceLunaUsage, streamLuna } from "./luna.ts";

test("custo do Luna separa entrada normal, cache write, cache read e saída", () => {
  const usage = priceLunaUsage({
    input_tokens: 2_000,
    output_tokens: 1_000,
    input_tokens_details: { cached_tokens: 500, cache_write_tokens: 250 },
  });

  assert.deepEqual(usage, {
    inputTokens: 2_000,
    cachedInputTokens: 500,
    cacheWriteInputTokens: 250,
    outputTokens: 1_000,
    estimatedCostUsd: 0.0015225,
  });
});

test("Responses API transmite texto e devolve ID e uso sem encadear outra resposta", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  const encoder = new TextEncoder();
  const chunks = [
    'data: {"type":"response.created","response":{"id":"resp_pywiki"}}\n\n',
    'data: {"type":"response.output_text.delta","delta":"# Path"}\n\n',
    'data: {"type":"response.output_text.delta","delta":".mkdir"}\n\n',
    'data: {"type":"response.completed","response":{"id":"resp_pywiki","usage":{"input_tokens":1800,"output_tokens":700,"input_tokens_details":{"cached_tokens":0}}}}\n\n',
  ];
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }), { status: 200 });
  };

  try {
    const deltas: string[] = [];
    const result = await streamLuna({
      apiKey: "test-key",
      model: "gpt-5.6-luna",
      reasoningEffort: "low",
      messages: [
        { role: "system", content: "Documente somente a fonte." },
        { role: "user", content: "Símbolo: Path.mkdir" },
      ],
      maxCompletionTokens: 1_400,
      signal: new AbortController().signal,
      onDelta: (delta) => deltas.push(delta),
    });

    assert.equal(result.markdown, "# Path.mkdir");
    assert.equal(result.responseId, "resp_pywiki");
    assert.equal(result.usage?.estimatedCostUsd, 0.0012);
    assert.deepEqual(deltas, ["# Path", ".mkdir"]);
    assert.equal(requestBody?.store, true);
    assert.equal(requestBody?.instructions, "Documente somente a fonte.");
    assert.equal("previous_response_id" in (requestBody ?? {}), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  }), { status: 200 });
}

const baseOpts = {
  apiKey: "test-key",
  model: "gpt-5.6-luna",
  reasoningEffort: "low",
  messages: [{ role: "user" as const, content: "x" }],
  maxCompletionTokens: 100,
  onDelta: () => {},
};

test("Luna tenta de novo uma vez após 429 ou 5xx", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response("rate limited", { status: 429 });
    }
    return sseResponse(['data: {"type":"response.output_text.delta","delta":"ok"}\n\n']);
  };
  try {
    const result = await streamLuna({ ...baseOpts, signal: new AbortController().signal, retryDelayMs: 0 });
    assert.equal(result.markdown, "ok");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Luna não tenta de novo em 4xx que não seja 429", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("bad key", { status: 401 });
  };
  try {
    await assert.rejects(
      streamLuna({ ...baseOpts, signal: new AbortController().signal, retryDelayMs: 0 }),
      /OpenAI 401/,
    );
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Luna aborta com mensagem de tempo esgotado quando a API não responde", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    });
  });
  try {
    await assert.rejects(
      streamLuna({ ...baseOpts, signal: new AbortController().signal, timeoutMs: 20 }),
      /não respondeu/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pergunta de seguimento encadeia previous_response_id e não repete instructions", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return sseResponse(['data: {"type":"response.output_text.delta","delta":"segue"}\n\n']);
  };
  try {
    const result = await streamLuna({
      ...baseOpts,
      messages: [
        { role: "system", content: "sistema" },
        { role: "user", content: "E se parents=False?" },
      ],
      previousResponseId: "resp_anterior",
      signal: new AbortController().signal,
    });
    assert.equal(result.markdown, "segue");
    assert.equal(requestBody?.previous_response_id, "resp_anterior");
    assert.equal("instructions" in (requestBody ?? {}), false);
    assert.deepEqual(requestBody?.input, [{ role: "user", content: "E se parents=False?" }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
