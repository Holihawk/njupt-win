import { mkdir, writeFile } from "node:fs/promises";
import { crawl } from "./crawler/crawl.js";
import { getPool, query } from "./db.js";
import { PostgresDocumentStore } from "./store/postgres-store.js";
import { summarizeNotices, type SummaryBatchReport } from "./summary-batch.js";
import type { CrawlReport, SourceConfig } from "./types.js";

export type NoticeRefreshReport = {
  changed: boolean;
  crawl: CrawlReport;
  summary: SummaryBatchReport | null;
};

/**
 * 自动更新任务：先增量抓取，再仅在官网内容变化时更新摘要。
 *
 * created + updated 为零时完全跳过摘要阶段，避免没有更新时调用 LLM。
 * archived 不触发摘要生成，因为归档文档不会出现在首页有效摘要中。
 */
export async function refreshNotices(limit = 100): Promise<NoticeRefreshReport> {
  const sources = await query<{
    id: string;
    name: string;
    base_url: string;
    list_url: string;
  }>(
    `SELECT id, name, base_url, list_url
     FROM sources
     WHERE enabled=true AND auto_crawl=true AND list_url IS NOT NULL
     ORDER BY id`,
  );
  if (sources.length === 0) throw new Error("no enabled auto_crawl sources with list_url");

  const configs: SourceConfig[] = sources.map((source) => ({
    id: source.id,
    name: source.name,
    baseUrl: source.base_url,
    listUrl: source.list_url,
  }));
  const store = new PostgresDocumentStore();
  const crawlReport = await crawl(
    configs,
    (sourceId, documents, softDelete) =>
      store.saveCrawlResult(sourceId, documents, softDelete),
    limit,
    false,
  );
  const changed = crawlReport.created + crawlReport.updated > 0;
  const changedRows = changed
    ? await query<{ url: string }>(
      `SELECT url FROM documents
       WHERE ingestion_type='crawler' AND updated_at >= $1::timestamptz`,
      [crawlReport.startedAt],
    )
    : [];
  const summaryReport = changed
    ? await summarizeNotices({
      onlyUrls: new Set(changedRows.map((row) => row.url)),
      upgradeLocal: false,
    })
    : null;
  const report = { changed, crawl: crawlReport, summary: summaryReport };

  await mkdir("data", { recursive: true });
  await writeFile("data/notice-refresh-report.json", `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function closeNoticeRefreshPool() {
  await getPool().end();
}
