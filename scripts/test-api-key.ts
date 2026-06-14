import { apiEndpoints, sanitizedEndpoint, type ApiEndpoint } from "../src/ai/api-pool.js";
import { expectedEmbeddingDimensions } from "../src/ai/embeddings.js";

const testLlm = !process.argv.includes("--embedding-only");
const testEmbedding = !process.argv.includes("--llm-only");

void main();

/**
 * 逐个验证所有配置端点，而不是只测试轮询池中的第一个。
 *
 * 输出只包含端点序号、脱敏 URL、模型、延迟和响应摘要，不输出任何 API Key。
 */
async function main(): Promise<void> {
  const results: TestResult[] = [];
  if (testLlm) {
    const endpoints = apiEndpoints("LLM");
    if (endpoints.length === 0) results.push(missingPoolResult("llm"));
    for (const endpoint of endpoints) results.push(await testLlmEndpoint(endpoint));
  }
  if (testEmbedding) {
    const endpoints = apiEndpoints("EMBEDDING");
    if (endpoints.length === 0) results.push(missingPoolResult("embedding"));
    for (const endpoint of endpoints) {
      results.push(await testEmbeddingEndpoint(endpoint));
    }
  }
  console.log(JSON.stringify({ success: results.every((result) => result.success), results }, null, 2));
  if (results.some((result) => !result.success)) process.exitCode = 1;
}

async function testLlmEndpoint(endpoint: ApiEndpoint): Promise<TestResult> {
  return testEndpoint("llm", endpoint, async () => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: authHeaders(endpoint.key),
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0,
        max_tokens: 128,
        stream: false,
        messages: [{ role: "user", content: "只回复：API_OK" }],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${safePreview(body)}`);
    const parsed = parseLlmResponse(body);
    if (!parsed.text) throw new Error(`response has no text; shape=${parsed.shape}`);
    return { response: parsed.text.slice(0, 100), usage: parsed.usage };
  });
}

/**
 * 部分 OpenAI-compatible 代理会忽略 stream:false 并始终返回 SSE。
 * Key 测试同时兼容普通 JSON 与 SSE，避免把可用端点误判为失败。
 */
function parseLlmResponse(body: string): { text: string | null; usage: unknown; shape: string } {
  if (!body.trimStart().startsWith("data:")) {
    const payload = JSON.parse(body) as Record<string, unknown>;
    return {
      text: extractText(payload) ?? extractDeltaText(payload),
      usage: payload.usage ?? null,
      shape: responseShape(payload),
    };
  }

  let text = "";
  let usage: unknown = null;
  const shapes = new Set<string>();
  for (const line of body.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    const payload = JSON.parse(data) as Record<string, unknown>;
    shapes.add(responseShape(payload));
    usage = payload.usage ?? usage;
    text += extractText(payload) ?? extractDeltaText(payload) ?? "";
  }
  return { text: text.trim() || null, usage, shape: [...shapes].join(",") };
}

async function testEmbeddingEndpoint(endpoint: ApiEndpoint): Promise<TestResult> {
  return testEndpoint("embedding", endpoint, async () => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: authHeaders(endpoint.key),
      body: JSON.stringify({ model: endpoint.model, input: ["API_OK"] }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${safePreview(body)}`);
    const payload = JSON.parse(body) as { data?: { embedding?: number[] }[]; usage?: unknown };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) throw new Error("response has no embedding");
    if (vector.length !== expectedEmbeddingDimensions) {
      throw new Error(`embedding dimensions ${vector.length} do not match expected ${expectedEmbeddingDimensions}`);
    }
    return { dimensions: vector.length, usage: payload.usage ?? null };
  });
}

async function testEndpoint(
  kind: "llm" | "embedding",
  endpoint: ApiEndpoint,
  request: () => Promise<Record<string, unknown>>,
): Promise<TestResult> {
  warnInsecure(endpoint.url);
  const startedAt = performance.now();
  try {
    const details = await request();
    return {
      success: true,
      kind,
      endpointIndex: endpoint.index + 1,
      endpoint: sanitizedEndpoint(endpoint.url),
      model: endpoint.model,
      latencyMs: Math.round(performance.now() - startedAt),
      ...details,
    };
  } catch (error) {
    return {
      success: false,
      kind,
      endpointIndex: endpoint.index + 1,
      endpoint: sanitizedEndpoint(endpoint.url),
      model: endpoint.model,
      latencyMs: Math.round(performance.now() - startedAt),
      error: (error as Error).message,
    };
  }
}

function missingPoolResult(kind: "llm" | "embedding"): TestResult {
  return {
    success: false,
    kind,
    endpointIndex: 0,
    endpoint: "",
    model: "",
    latencyMs: 0,
    error: `${kind.toUpperCase()} API pool is missing or incomplete`,
  };
}

type TestResult = {
  success: boolean;
  kind: "llm" | "embedding";
  endpointIndex: number;
  endpoint: string;
  model: string;
  latencyMs: number;
  [key: string]: unknown;
};

function authHeaders(key: string) {
  return { authorization: `Bearer ${key}`, "content-type": "application/json" };
}

function warnInsecure(value: string) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:" && !isLocalhost(endpoint.hostname)) {
    console.warn(`Warning: ${sanitizedEndpoint(value)} does not use HTTPS.`);
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function safePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300);
}

function extractText(payload: Record<string, unknown>): string | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  const message = firstChoice && isRecord(firstChoice.message) ? firstChoice.message : null;
  const messageText = message ? contentToText(message.content) : null;
  if (messageText) return messageText;
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  return null;
}

function extractDeltaText(payload: Record<string, unknown>): string | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : null;
  const delta = firstChoice && isRecord(firstChoice.delta) ? firstChoice.delta : null;
  return delta ? contentToText(delta.content) : null;
}

function contentToText(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").join("").trim();
  return text || null;
}

function responseShape(payload: Record<string, unknown>): string {
  return JSON.stringify({ rootKeys: Object.keys(payload) });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

process.on("unhandledRejection", (error) => {
  console.error(`API test failed: ${(error as Error).message}`);
  process.exitCode = 1;
});
