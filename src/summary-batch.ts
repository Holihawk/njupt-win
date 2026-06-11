import { hasApiPool } from "./api-pool.js";
import { llmSummary } from "./llm-summary.js";
import { loadDocuments } from "./notices.js";
import {
  classifyNotice,
  loadSummaries,
  localSummary,
  saveSummaries,
  type NoticeSummary,
} from "./summaries.js";

export type SummaryBatchReport = {
  provider: "llm" | "local";
  created: number;
  skipped: number;
  fallback: number;
};

export type SummaryBatchOptions = {
  force?: boolean;
  onlyUrls?: Set<string>;
  upgradeLocal?: boolean;
};

/**
 * 增量生成通知摘要。
 *
 * 默认只处理新文档、正文哈希变化的文档，以及配置了 LLM 但旧摘要仍为 local 的文档。
 * 未变化摘要不会重新请求模型，因此自动任务可以安全地重复执行。
 */
export async function summarizeNotices(options: SummaryBatchOptions = {}): Promise<SummaryBatchReport> {
  const { force = false, onlyUrls, upgradeLocal = true } = options;
  const useLlm = hasApiPool("LLM");
  const documents = (await loadDocuments()).filter((document) => !onlyUrls || onlyUrls.has(document.url));
  const existing = new Map((await loadSummaries()).map((summary) => [summary.documentUrl, summary]));
  const summaries: NoticeSummary[] = [];
  let created = 0;
  let skipped = 0;
  let fallback = 0;

  for (const document of documents) {
    const previous = existing.get(document.url);
    if (
      !force &&
      previous?.documentHash === document.hash &&
      (!useLlm || previous.provider === "llm" || !upgradeLocal)
    ) {
      summaries.push({
        ...previous,
        category: classifyNotice(
          `${document.title} ${document.content} ${previous.summary}`,
          previous.keywords,
        ),
      });
      skipped += 1;
      continue;
    }

    let summary: NoticeSummary;
    if (useLlm) {
      try {
        summary = await llmSummary(document);
      } catch (error) {
        console.error(`[summary fallback] ${document.title}: ${(error as Error).message}`);
        summary = localSummary(document);
        fallback += 1;
      }
    } else {
      summary = localSummary(document);
    }
    summaries.push(summary);
    created += 1;
  }

  await saveSummaries(summaries);
  return { provider: useLlm ? "llm" : "local", created, skipped, fallback };
}
