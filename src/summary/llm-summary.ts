import type { Document } from "../types.js";
import { withApiFailover } from "../ai/api-pool.js";
import {
  compactSummary,
  classifyNotice,
  noticeCategories,
  type NoticeCategory,
  type NoticeSummary,
} from "./summaries.js";

type ModelOutput = Pick<
  NoticeSummary,
  "summary" | "category" | "audience" | "importance" | "deadline" | "keywords"
>;

/**
 * 调用兼容 Chat Completions 的模型生成结构化通知摘要。
 *
 * 模型只接收公开通知正文，且要求输出 JSON。返回前仍会经过 validateModelOutput，
 * 因为即便启用了 JSON 模式，也不能假设第三方模型完全遵守字段类型和长度要求。
 */
export async function llmSummary(document: Document): Promise<NoticeSummary> {
  const raw = await withApiFailover("LLM", async (endpoint) => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "你是校园通知摘要助手。只基于输入内容，输出合法 JSON。字段为 summary、category、audience、importance、deadline、keywords。summary 必须是50个中文字符以内的一句话，清楚说明最关键事项；importance 为0-5；无明确截止日期时 deadline 为 null。",
          },
          {
            role: "user",
            content: `标题：${document.title}\n发布时间：${document.publishedAt ?? "未知"}\n正文：${document.content.slice(0, 6000)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("returned no content");
    return content;
  });
  if (!raw) throw new Error("LLM returned no content");
  const parsed = validateModelOutput(JSON.parse(raw) as Partial<ModelOutput>, document);
  return {
    documentUrl: document.url,
    documentHash: document.hash,
    title: document.title,
    ...parsed,
    provider: "llm",
    generatedAt: new Date().toISOString(),
  };
}

/**
 * 校验并规范化模型输出。
 *
 * 非法类别会回退为“其他”，数组字段限制数量，重要度限制在 0-5，
 * 摘要通过 compactSummary 强制满足页面展示长度要求。
 */
function validateModelOutput(value: Partial<ModelOutput>, document: Document): ModelOutput {
  const modelCategory: NoticeCategory = noticeCategories.includes(value.category as NoticeCategory)
    ? (value.category as NoticeCategory)
    : "其他";
  const keywords = Array.isArray(value.keywords)
    ? value.keywords.filter((item): item is string => typeof item === "string").slice(0, 6)
    : [];
  const category = classifyNotice(
    document.title,
    keywords,
    modelCategory,
  );
  if (typeof value.summary !== "string" || value.summary.trim().length < 10) {
    throw new Error("LLM summary is invalid");
  }
  return {
    summary: compactSummary(value.summary),
    category,
    audience: Array.isArray(value.audience)
      ? value.audience.filter((item): item is string => typeof item === "string").slice(0, 4)
      : ["全校师生"],
    importance:
      typeof value.importance === "number"
        ? Math.max(0, Math.min(5, Math.round(value.importance)))
        : 3,
    deadline: typeof value.deadline === "string" ? value.deadline : null,
    keywords,
  };
}
