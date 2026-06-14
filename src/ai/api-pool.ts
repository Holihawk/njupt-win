export type ApiEndpoint = {
  url: string;
  key: string;
  model: string;
  index: number;
};

type PoolKind = "LLM" | "EMBEDDING";

const cursors: Record<PoolKind, number> = { LLM: 0, EMBEDDING: 0 };

/**
 * 读取一组 API 端点。
 *
 * 推荐使用 *_API_URLS、*_API_KEYS、*_MODELS JSON 数组并按索引配对。
 * 为兼容旧配置，单数变量仍会作为只有一个端点的池；数组中某项只有一个值时会广播复用。
 */
export function apiEndpoints(kind: PoolKind): ApiEndpoint[] {
  const urls = envList(`${kind}_API_URLS`, `${kind}_API_URL`);
  const keys = envList(`${kind}_API_KEYS`, `${kind}_API_KEY`);
  const models = envList(`${kind}_MODELS`, `${kind}_MODEL`);
  if (urls.length === 0 || keys.length === 0 || models.length === 0) return [];
  const count = Math.max(urls.length, keys.length, models.length);
  assertCompatibleLength(`${kind}_API_URLS`, urls, count);
  assertCompatibleLength(`${kind}_API_KEYS`, keys, count);
  assertCompatibleLength(`${kind}_MODELS`, models, count);
  return Array.from({ length: count }, (_, index) => ({
    url: pick(urls, index),
    key: pick(keys, index),
    model: pick(models, index),
    index,
  }));
}

export function hasApiPool(kind: PoolKind): boolean {
  return apiEndpoints(kind).length > 0;
}

/**
 * 从轮询游标开始依次尝试全部端点。
 *
 * 成功后下次请求从后一端点开始；失败端点不会永久摘除，便于临时限流或网络故障恢复后
 * 自动重新参与轮询。错误消息不包含 key。
 */
export async function withApiFailover<T>(
  kind: PoolKind,
  request: (endpoint: ApiEndpoint) => Promise<T>,
): Promise<T> {
  const endpoints = apiEndpoints(kind);
  if (endpoints.length === 0) throw new Error(`${kind} API pool is not configured`);
  const start = cursors[kind] % endpoints.length;
  const errors: string[] = [];

  for (let offset = 0; offset < endpoints.length; offset += 1) {
    const endpoint = endpoints[(start + offset) % endpoints.length];
    try {
      const result = await request(endpoint);
      cursors[kind] = (endpoint.index + 1) % endpoints.length;
      return result;
    } catch (error) {
      errors.push(`#${endpoint.index + 1} ${sanitizedEndpoint(endpoint.url)}: ${(error as Error).message}`);
    }
  }
  throw new Error(`${kind} API pool exhausted: ${errors.join(" | ")}`);
}

export function sanitizedEndpoint(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

function envList(pluralName: string, singularName: string): string[] {
  const plural = process.env[pluralName]?.trim();
  if (plural) {
    try {
      const parsed = JSON.parse(plural) as unknown;
      if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string" && value.trim())) {
        throw new Error("must be a non-empty string array");
      }
      return parsed.map((value) => value.trim());
    } catch (error) {
      throw new Error(`${pluralName} must be a JSON string array: ${(error as Error).message}`);
    }
  }
  const singular = process.env[singularName]?.trim();
  return singular ? [singular] : [];
}

function assertCompatibleLength(name: string, values: string[], count: number) {
  if (values.length !== 1 && values.length !== count) {
    throw new Error(`${name} must contain either 1 or ${count} values`);
  }
}

function pick(values: string[], index: number): string {
  return values.length === 1 ? values[0] : values[index];
}
