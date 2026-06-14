const defaultMaxBodyBytes = 32_000;

/** 拒绝明确来自跨站页面的写请求，降低匿名会话凭据被滥用的风险。 */
export function assertSameOriginRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new PublicApiError("不允许跨站请求", 403);

  const origin = request.headers.get("origin");
  if (origin && !requestOrigins(request).has(origin)) throw new PublicApiError("不允许跨站请求", 403);
}

/**
 * Next 开发服务器或反向代理看到的 request.url 主机名可能是 0.0.0.0 或内部容器地址，
 * 而浏览器 Origin 使用 localhost、局域网 IP 或正式域名。Host 与转发头才代表用户
 * 实际访问入口，因此一起纳入允许列表。
 */
function requestOrigins(request: Request): Set<string> {
  const requestUrl = new URL(request.url);
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto")) ?? requestUrl.protocol.slice(0, -1);
  const hosts = [
    requestUrl.host,
    firstHeaderValue(request.headers.get("host")),
    firstHeaderValue(request.headers.get("x-forwarded-host")),
  ].filter(Boolean) as string[];
  return new Set(hosts.map((host) => `${forwardedProto}://${host}`));
}

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",")[0]?.trim() || null;
}

/** 在 JSON 解析前检查 Content-Length，并在读取后再次检查实际字节数。 */
export async function readJsonBody<T>(request: Request, maxBytes = defaultMaxBodyBytes): Promise<T> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw new PublicApiError("请求内容过大", 413);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new PublicApiError("请求内容过大", 413);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new PublicApiError("请求 JSON 格式不正确", 400);
  }
}

export class PublicApiError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** 未显式标记为公开的异常不能返回给用户，避免泄露数据库、端点和内部实现信息。 */
export function publicError(error: unknown, fallback: string): { message: string; status: number } {
  if (error instanceof PublicApiError) return { message: error.message, status: error.status };
  return { message: fallback, status: 500 };
}

/** 后台可保存有限的错误摘要，但不保存 API key、Bearer token 或超长响应。 */
export function internalErrorSummary(error: unknown): string {
  return String((error as Error)?.message ?? error ?? "unknown error")
    .replace(/bearer\s+[^\s|]+/gi, "Bearer [redacted]")
    .replace(/(?:sk|key)-[a-zA-Z0-9_-]{8,}/g, "[redacted]")
    .slice(0, 500);
}
