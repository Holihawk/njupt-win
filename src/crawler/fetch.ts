import { USER_AGENT } from "./utils.js";

/**
 * 请求公开网页并返回 HTML。
 *
 * 最多尝试三次，每次失败后线性退避。超时和非 2xx 响应都会进入重试，
 * 避免学校网站偶发网络抖动导致整次抓取任务失败。
 */
export async function fetchHtml(url: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
      }
    }
  }
  throw new Error(`request failed after 3 attempts: ${url}`, { cause: lastError });
}
