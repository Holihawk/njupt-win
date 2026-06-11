import type { CrawlReport, Document, ListItem, SourceConfig } from "../types.js";
import { fetchHtml } from "./fetch.js";
import { parseDetail } from "./parse-detail.js";
import { parseList } from "./parse-list.js";
import { fileType, sha256 } from "./utils.js";

const wait = () => new Promise((resolve) => setTimeout(resolve, 350));

/**
 * 将列表中直接链接附件的条目转换为统一 Document。
 *
 * 这类条目没有详情页，因此使用标题构造最小正文，并把链接同时记录为附件。
 */
function attachmentDocument(item: ListItem, source: SourceConfig): Document {
  const content = `列表项直接链接到附件：${item.title}`;
  return {
    sourceId: source.id, sourceName: source.name, title: item.title, url: item.url,
    publishedAt: item.publishedAt, author: null, content, contentHtml: null,
    attachments: [{ title: item.title, url: item.url, fileType: fileType(item.url) }],
    itemType: "attachment", hash: sha256(content), fetchedAt: new Date().toISOString(),
    status: "active",
  };
}

/**
 * 执行完整抓取任务。
 *
 * 流程为：抓列表 -> 逐条抓详情/记录附件 -> 计算哈希 -> 与已有数据比较 -> 保存。
 * 每个数据源和每个条目都独立捕获错误，单个页面失败不会中断其他来源。
 * 对未变化文档计入 skipped，保证重复执行具有幂等性。
 */
export async function crawl(
  sources: SourceConfig[],
  saveSourceDocuments: (sourceId: string, documents: Document[], softDelete: boolean) => Promise<{
    created: number;
    updated: number;
    skipped: number;
    archived?: number;
  }>,
  limitPerSource = 20,
  softDelete = false,
): Promise<CrawlReport> {
  const startedAt = new Date().toISOString();
  const report: CrawlReport = {
    startedAt, finishedAt: startedAt, created: 0, updated: 0, skipped: 0, failed: 0,
    archived: 0,
    sources: {},
  };

  for (const source of sources) {
    let items: ListItem[];
    const sourceDocuments: Document[] = [];
    try {
      items = parseList(await fetchHtml(source.listUrl), source).slice(0, limitPerSource);
    } catch (error) {
      const message = (error as Error).message;
      report.failed += 1;
      report.sources[source.id] = { listed: 0, pages: 0, attachments: 0, error: message };
      console.error(`[failed source] ${source.listUrl}: ${message}`);
      continue;
    }
    report.sources[source.id] = {
      listed: items.length,
      pages: items.filter((item) => item.itemType === "page").length,
      attachments: items.filter((item) => item.itemType === "attachment").length,
    };

    for (const item of items) {
      try {
        let document: Document;
        if (item.itemType === "attachment") {
          document = attachmentDocument(item, source);
        } else {
          const detail = parseDetail(await fetchHtml(item.url), item, source);
          if (!detail.content && detail.attachments.length === 0) {
            throw new Error("detail page has no content or attachments");
          }
          // 哈希只包含影响用户内容和下游任务的字段，不包含 fetchedAt 等运行时字段。
          const hash = sha256(JSON.stringify({
            title: detail.title,
            publishedAt: detail.publishedAt,
            author: detail.author,
            content: detail.content,
            attachments: detail.attachments,
          }));
          document = {
            sourceId: source.id, sourceName: source.name, title: detail.title, url: item.url,
            publishedAt: detail.publishedAt, author: detail.author, content: detail.content,
            contentHtml: detail.contentHtml, attachments: detail.attachments, itemType: "page",
            hash, fetchedAt: new Date().toISOString(), status: "active",
          };
        }

        sourceDocuments.push(document);
      } catch (error) {
        report.failed += 1;
        console.error(`[failed] ${item.url}: ${(error as Error).message}`);
      }
      await wait();
    }
    const result = await saveSourceDocuments(source.id, sourceDocuments, softDelete);
    report.created += result.created;
    report.updated += result.updated;
    report.skipped += result.skipped;
    report.archived = (report.archived ?? 0) + (result.archived ?? 0);
  }

  report.finishedAt = new Date().toISOString();
  return report;
}
