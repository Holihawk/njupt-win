import { readFile } from "node:fs/promises";
import type { PoolClient } from "pg";
import { transaction, getPool } from "../src/db.js";
import type { Document } from "../src/types.js";
import type { NoticeSummary } from "../src/summaries.js";
import { sources } from "../src/crawler/sources.js";
import type { EditableBlock } from "../src/admin-import.js";

const documents = JSON.parse(await readFile("data/documents.json", "utf8")) as Document[];
const summaries = JSON.parse(await readFile("data/notice-summaries.json", "utf8")) as NoticeSummary[];
const summaryByUrl = new Map(summaries.map((summary) => [summary.documentUrl, summary]));
const configuredSources = new Map(sources.map((source) => [source.id, source]));
const departmentSources = await loadDepartmentSources();

await transaction(async (client) => {
  for (const source of departmentSources) {
    await client.query(
      `INSERT INTO sources (
         id, name, base_url, source_type, parser_type, official_weight,
         auto_crawl, enabled, notes
       ) VALUES ($1,$2,$3,$4,'unknown',1.00,false,false,$5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, base_url = EXCLUDED.base_url,
         source_type = EXCLUDED.source_type,
         notes = COALESCE(sources.notes, EXCLUDED.notes), updated_at = now()`,
      [source.id, source.name, source.baseUrl, source.sourceType, "由 department.txt 导入，需配置栏目和解析器后启用"],
    );
  }
  for (const document of documents) {
    const configured = configuredSources.get(document.sourceId);
    await client.query(
      `INSERT INTO sources (
         id, name, base_url, list_url, source_type, parser_type, official_weight, auto_crawl, enabled
       ) VALUES ($1, $2, $3, $4, 'notice', 'webplus', 1.00, $5, true)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, base_url = EXCLUDED.base_url,
         list_url = COALESCE(EXCLUDED.list_url, sources.list_url),
         auto_crawl = sources.auto_crawl OR EXCLUDED.auto_crawl,
         updated_at = now()`,
      [
        document.sourceId, document.sourceName,
        configured?.baseUrl ?? new URL(document.url).origin,
        configured?.listUrl ?? null,
        Boolean(configured),
      ],
    );
    const documentId = await upsertDocument(client, document);
    await client.query("DELETE FROM attachments WHERE document_id = $1", [documentId]);
    for (const attachment of document.attachments) {
      await client.query(
        `INSERT INTO attachments (document_id, title, url, file_type)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (document_id, url) DO UPDATE
         SET title = EXCLUDED.title, file_type = EXCLUDED.file_type`,
        [documentId, attachment.title, attachment.url, attachment.fileType],
      );
    }
    const summary = summaryByUrl.get(document.url);
    if (summary) await upsertSummary(client, documentId, summary);
    await upsertLegacyBlocks(client, documentId, document);
  }
});

console.log(JSON.stringify({
  sources: departmentSources.length,
  documents: documents.length,
  summaries: summaries.length,
}, null, 2));
await getPool().end();

async function upsertDocument(client: PoolClient, document: Document): Promise<number> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO documents (
       source_id, source_name, title, url, published_at, author, content, content_html,
       ingestion_type, item_type, content_hash, fetched_at, status, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import',$9,$10,$11,$12,$13)
     ON CONFLICT (url) DO UPDATE SET
       source_id = EXCLUDED.source_id, source_name = EXCLUDED.source_name,
       title = EXCLUDED.title, published_at = EXCLUDED.published_at, author = EXCLUDED.author,
       content = EXCLUDED.content, content_html = EXCLUDED.content_html,
       item_type = EXCLUDED.item_type, content_hash = EXCLUDED.content_hash,
       fetched_at = EXCLUDED.fetched_at, status = EXCLUDED.status, error = EXCLUDED.error,
       updated_at = now()
     RETURNING id`,
    [
      document.sourceId, document.sourceName, document.title, document.url,
      document.publishedAt, document.author, document.content, document.contentHtml,
      document.itemType, document.hash, document.fetchedAt, document.status,
      document.error ?? null,
    ],
  );
  return result.rows[0].id;
}

async function upsertSummary(client: PoolClient, documentId: number, summary: NoticeSummary) {
  await client.query(
    `INSERT INTO document_summaries (
       document_id, document_hash, summary, category, audience, importance,
       deadline, keywords, provider, generated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (document_id) DO UPDATE SET
       document_hash = EXCLUDED.document_hash, summary = EXCLUDED.summary,
       category = EXCLUDED.category, audience = EXCLUDED.audience,
       importance = EXCLUDED.importance, deadline = EXCLUDED.deadline,
       keywords = EXCLUDED.keywords, provider = EXCLUDED.provider,
       generated_at = EXCLUDED.generated_at`,
    [
      documentId, summary.documentHash, summary.summary, summary.category,
      summary.audience, summary.importance, summary.deadline, summary.keywords,
      summary.provider, summary.generatedAt,
    ],
  );
}

async function upsertLegacyBlocks(client: PoolClient, documentId: number, document: Document) {
  const existing = await client.query("SELECT 1 FROM document_blocks WHERE document_id = $1 LIMIT 1", [
    documentId,
  ]);
  if (existing.rowCount) return;
  const blocks: EditableBlock[] = [];
  if (document.content.trim()) {
    blocks.push({
      type: "text",
      title: "",
      content: document.content,
      html: document.contentHtml ?? "",
      assetUrl: "",
      enabled: true,
      evidenceEnabled: false,
      evidenceTitle: "",
      evidenceDescription: "",
      metadata: { importedFrom: "data/documents.json" },
    });
  }
  for (const attachment of document.attachments) {
    blocks.push({
      type: "attachment",
      title: attachment.title,
      content: attachment.title,
      html: "",
      assetUrl: attachment.url,
      enabled: true,
      evidenceEnabled: true,
      evidenceTitle: attachment.title,
      evidenceDescription: "附件下载地址",
      metadata: { fileType: attachment.fileType },
    });
  }
  for (const [index, block] of blocks.entries()) {
    await client.query(
      `INSERT INTO document_blocks (
         document_id, block_type, sort_order, title, content, html, asset_url,
         metadata, enabled, evidence_enabled, evidence_title, evidence_description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        documentId, block.type, index, block.title || null, block.content, block.html || null,
        block.assetUrl || null, JSON.stringify(block.metadata), block.enabled,
        block.evidenceEnabled, block.evidenceTitle || null, block.evidenceDescription || null,
      ],
    );
  }
}

async function loadDepartmentSources() {
  const text = await readFile("department.txt", "utf8");
  let sourceType: "notice" | "content" | "service" = "notice";
  return text.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed === "职能部门与直属单位") sourceType = "notice";
    if (trimmed === "各学院网站") sourceType = "content";
    if (trimmed === "公共服务与支撑平台") sourceType = "service";
    const match = trimmed.match(/^([^：]+)：(.+)$/);
    if (!match) return [];
    const host = match[1].trim();
    const id = host === "www.njupt.edu.cn"
      ? "njupt-main"
      : host === "jwc.njupt.edu.cn"
        ? "njupt-jwc"
        : host.replace(/\.njupt\.edu\.cn$/, "").replace(/\./g, "-");
    return [{ id, name: match[2].trim(), baseUrl: `https://${host}`, sourceType }];
  });
}
