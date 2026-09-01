import type { WikiUsage } from "./cache";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LunaResult = {
  markdown: string;
  responseId?: string;
  usage?: WikiUsage;
};

export const LUNA_PRICING_PER_MILLION = {
  input: 0.2,
  cachedInput: 0.02,
  cacheWriteInput: 0.25,
  output: 1.2,
} as const;

type ResponseUsage = {
  input_tokens?: number;
  output_tokens?: number;
  input_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
  };
};

function capError(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n\n…[cortado, ${text.length - max} chars]`;
}

export function priceLunaUsage(usage: ResponseUsage): WikiUsage {
  const inputTokens = Math.max(0, usage.input_tokens ?? 0);
  const cachedInputTokens = Math.max(
    0,
    Math.min(inputTokens, usage.input_tokens_details?.cached_tokens ?? 0),
  );
  const cacheWriteInputTokens = Math.max(
    0,
    Math.min(
      inputTokens - cachedInputTokens,
      usage.input_tokens_details?.cache_write_tokens ?? 0,
    ),
  );
  const uncachedInputTokens = Math.max(
    0,
    inputTokens - cachedInputTokens - cacheWriteInputTokens,
  );
  const outputTokens = Math.max(0, usage.output_tokens ?? 0);
  const estimatedCostUsd = (
    uncachedInputTokens * LUNA_PRICING_PER_MILLION.input
    + cachedInputTokens * LUNA_PRICING_PER_MILLION.cachedInput
    + cacheWriteInputTokens * LUNA_PRICING_PER_MILLION.cacheWriteInput
    + outputTokens * LUNA_PRICING_PER_MILLION.output
  ) / 1_000_000;

  return {
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    estimatedCostUsd,
  };
}

export async function streamLuna(opts: {
  apiKey: string;
  model: string;
  reasoningEffort: string;
  messages: ChatMessage[];
  maxCompletionTokens: number;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Espera antes da única nova tentativa em 429/5xx. */
  retryDelayMs?: number;
  /** Tempo máximo total sem resposta antes de abortar. */
  timeoutMs?: number;
  /** Encadeia numa resposta anterior (store: true); instructions não são repetidas. */
  previousResponseId?: string;
}): Promise<LunaResult> {
  const instructions = opts.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = opts.messages
    .filter((message) => message.role !== "system")
    .map((message) => ({ role: message.role, content: message.content }));
  const body = JSON.stringify({
    model: opts.model,
    stream: true,
    store: true,
    reasoning: { effort: opts.reasoningEffort },
    max_output_tokens: opts.maxCompletionTokens,
    ...(opts.previousResponseId
      ? { previous_response_id: opts.previousResponseId }
      : { instructions }),
    input,
  });

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  let timedOut = false;
  const onOuterAbort = () => controller.abort();
  opts.signal.addEventListener("abort", onOuterAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await streamWithSignal({ ...opts, body, signal: controller.signal, isTimedOut: () => timedOut });
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener("abort", onOuterAbort);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function streamWithSignal(opts: {
  apiKey: string;
  body: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  retryDelayMs?: number;
  timeoutMs?: number;
  isTimedOut: () => boolean;
}): Promise<LunaResult> {
  const request = () => fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: opts.body,
    signal: opts.signal,
  });

  const timeoutError = () =>
    new Error(`O Luna não respondeu em ${Math.round((opts.timeoutMs ?? 60_000) / 1000)}s.`);

  let response: Response;
  try {
    response = await request();
    if (RETRYABLE.has(response.status)) {
      await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs ?? 800));
      if (!opts.signal.aborted) {
        response = await request();
      }
    }
  } catch (error) {
    if (opts.isTimedOut()) {
      throw timeoutError();
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI ${response.status}: ${capError(text, 800)}`);
  }
  if (!response.body) {
    throw new Error("OpenAI não devolveu stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let responseId: string | undefined;
  let usage: WikiUsage | undefined;
  let failure: string | undefined;

  const consumeEvent = (data: string) => {
    if (!data || data === "[DONE]") {
      return;
    }
    try {
      const json = JSON.parse(data) as {
        type?: string;
        delta?: string;
        response?: {
          id?: string;
          usage?: ResponseUsage;
          error?: { message?: string } | null;
        };
        error?: { message?: string };
      };
      responseId = json.response?.id ?? responseId;
      if (json.type === "response.output_text.delta" && typeof json.delta === "string") {
        full += json.delta;
        opts.onDelta(json.delta);
      }
      if (json.type === "response.completed" && json.response?.usage) {
        usage = priceLunaUsage(json.response.usage);
      }
      if (json.type === "response.failed" || json.type === "error") {
        failure = json.response?.error?.message ?? json.error?.message ?? "A resposta falhou.";
      }
    } catch {
      // Evento SSE desconhecido ou incompleto: os demais eventos seguem válidos.
    }
  };

  while (true) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (opts.isTimedOut()) {
        throw timeoutError();
      }
      throw error;
    }
    const { done, value } = chunk;
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      consumeEvent(data);
    }
  }
  const tail = buffer
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  consumeEvent(tail);

  if (failure) {
    throw new Error(failure);
  }
  return { markdown: full, responseId, usage };
}
