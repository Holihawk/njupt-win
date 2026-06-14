import { query } from "../database/db";
import type { Document } from "../types";

/** 页面层所需的轻量通知结构，避免把正文和 HTML 等大字段传入组件。 */
export type Notice = Pick<
  Document,
  "title" | "url" | "publishedAt" | "sourceName" | "itemType"
>;

/**
 * 返回指定时间窗口内最新的通知。
 *
 * @param documents 抓取后保存的全部文档。
 * @param now 计算时间窗口的基准时间；测试中传入固定时间可避免结果漂移。
 * @param days 向前包含的天数，默认最近 14 天。
 * @param limit 最多返回数量。
 */
export function recentNotices(
  documents: Document[],
  now: Date,
  days = 14,
  limit = 5,
): Notice[] {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  return documents
    .filter((document) => document.status === "active" && document.publishedAt)
    .filter((document) => new Date(`${document.publishedAt}T00:00:00`) >= cutoff)
    .sort(compareNewest)
    .slice(0, limit);
}

/**
 * 对通知标题执行最小可用搜索。
 *
 * 当前阶段仅做不区分大小写的包含匹配，并优先返回发布时间较近的结果。
 * 后续迁移 PostgreSQL 时，可以保持此函数签名并替换为数据库查询。
 */
export function searchNotices(documents: Document[], query: string, limit = 7): Notice[] {
  const normalized = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalized) return [];
  return documents
    .filter((document) => document.status === "active")
    .filter((document) => document.title.toLocaleLowerCase("zh-CN").includes(normalized))
    .sort(compareNewest)
    .slice(0, limit);
}

/** 从 PostgreSQL 加载有效文档及附件。 */
export async function loadDocuments(): Promise<Document[]> {
  const rows = await query<DocumentRow>(
    `SELECT d.source_id, d.source_name, d.title, d.url, d.published_at::text,
            d.author, d.content, d.content_html, d.item_type, d.content_hash,
            d.fetched_at, d.status, d.error,
            COALESCE(
              json_agg(json_build_object(
                'title', a.title, 'url', a.url, 'fileType', a.file_type
              ) ORDER BY a.id) FILTER (WHERE a.id IS NOT NULL),
              '[]'::json
            ) AS attachments
     FROM documents d
     LEFT JOIN attachments a ON a.document_id = d.id
     WHERE d.status = 'active'
     GROUP BY d.id
     ORDER BY d.published_at DESC NULLS LAST`,
  );
  return rows.map((row) => ({
    sourceId: row.source_id ?? "manual",
    sourceName: row.source_name,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    author: row.author,
    content: row.content,
    contentHtml: row.content_html,
    attachments: row.attachments,
    itemType: row.item_type,
    hash: row.content_hash,
    fetchedAt: asIso(row.fetched_at),
    status: row.status,
    ...(row.error ? { error: row.error } : {}),
  }));
}

/** 按发布日期降序排列；缺少日期的通知自然排在最后。 */
function compareNewest(a: Notice, b: Notice): number {
  return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
}

type DocumentRow = {
  source_id: string | null;
  source_name: string;
  title: string;
  url: string;
  published_at: string | null;
  author: string | null;
  content: string;
  content_html: string | null;
  attachments: Document["attachments"];
  item_type: Document["itemType"];
  content_hash: string;
  fetched_at: Date | string | null;
  status: Document["status"];
  error: string | null;
};

function asIso(value: Date | string | null): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
