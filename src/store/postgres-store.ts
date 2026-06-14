import type { PoolClient } from "pg";
import { transaction } from "../database/db.js";
import type { Document } from "../types.js";

/**
 * 抓取器的 PostgreSQL 存储层。
 *
 * 它只负责把解析后的 Document 增量写入数据库，并在“本次列表已经消失”的情况下
 * 软归档旧抓取文档；人工录入和手动导入的文档不会被抓取任务归档。
 */
export class PostgresDocumentStore {
  async saveCrawlResult(sourceId: string, documents: Document[], softDelete = false) {
    return transaction(async (client) => {
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const activeUrls = documents.map((document) => document.url);

      for (const document of documents) {
        const existing = await client.query<{ id: number; content_hash: string }>(
          "SELECT id, content_hash FROM documents WHERE url = $1",
          [document.url],
        );
        if (existing.rowCount && existing.rows[0].content_hash === document.hash) {
          skipped += 1;
          await touchDocument(client, existing.rows[0].id, document);
          continue;
        }
        const documentId = await upsertDocument(client, document);
        if (documentId === null) {
          skipped += 1;
          continue;
        }
        await replaceAttachments(client, documentId, document);
        await replaceCrawledBlocks(client, documentId, document);
        if (existing.rowCount) updated += 1;
        else created += 1;
      }

      const archived = !softDelete || activeUrls.length === 0
        ? 0
        : (await client.query(
          `UPDATE documents SET status='archived', updated_at=now()
           WHERE source_id=$1 AND ingestion_type='crawler' AND status='active'
             AND NOT (url = ANY($2::text[]))`,
          [sourceId, activeUrls],
        )).rowCount ?? 0;

      return { created, updated, skipped, archived };
    });
  }
}

async function upsertDocument(client: PoolClient, document: Document): Promise<number | null> {
  const result = await client.query<{ id: number }>(
    `INSERT INTO documents (
       source_id, source_name, title, url, published_at, author, content, content_html,
       document_type, ingestion_type, item_type, content_hash, fetched_at, status, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'notice','crawler',$9,$10,$11,$12,$13)
     ON CONFLICT (url) DO UPDATE SET
       source_id=EXCLUDED.source_id, source_name=EXCLUDED.source_name,
       title=EXCLUDED.title, published_at=EXCLUDED.published_at, author=EXCLUDED.author,
       content=EXCLUDED.content, content_html=EXCLUDED.content_html,
       item_type=EXCLUDED.item_type, content_hash=EXCLUDED.content_hash,
       ingestion_type=CASE
         WHEN documents.ingestion_type='import' THEN 'crawler'
         ELSE documents.ingestion_type
       END,
       fetched_at=EXCLUDED.fetched_at, status=EXCLUDED.status, error=EXCLUDED.error,
       updated_at=now()
     WHERE documents.ingestion_type IN ('crawler', 'import')
     RETURNING id`,
    [
      document.sourceId, document.sourceName, document.title, document.url,
      document.publishedAt, document.author, document.content, document.contentHtml,
      document.itemType, document.hash, document.fetchedAt, document.status,
      document.error ?? null,
    ],
  );
  if (result.rows[0]) return result.rows[0].id;
  const existing = await client.query<{ ingestion_type: string }>("SELECT ingestion_type FROM documents WHERE url=$1", [
    document.url,
  ]);
  if (existing.rows[0]?.ingestion_type === "manual") return null;
  throw new Error(`document upsert returned no id for ${document.url}`);
}

async function touchDocument(client: PoolClient, id: number, document: Document) {
  // 内容哈希未变化时只记录最后检查时间，不更新 updated_at，避免后台误认为文档有更新。
  await client.query(
    `UPDATE documents SET fetched_at=$2, status='active', error=NULL
     WHERE id=$1`,
    [id, document.fetchedAt],
  );
}

async function replaceAttachments(client: PoolClient, documentId: number, document: Document) {
  await client.query("DELETE FROM attachments WHERE document_id = $1", [documentId]);
  for (const attachment of document.attachments) {
    await client.query(
      `INSERT INTO attachments (document_id, title, url, file_type)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (document_id, url) DO UPDATE
       SET title=EXCLUDED.title, file_type=EXCLUDED.file_type`,
      [documentId, attachment.title, attachment.url, attachment.fileType],
    );
  }
}

async function replaceCrawledBlocks(client: PoolClient, documentId: number, document: Document) {
  await client.query("DELETE FROM document_blocks WHERE document_id = $1", [documentId]);
  let order = 0;
  if (document.content) {
    await client.query(
      `INSERT INTO document_blocks (
         document_id, block_type, sort_order, content, html, enabled, evidence_enabled, metadata
       ) VALUES ($1,'text',$2,$3,$4,true,false,$5)`,
      [documentId, order, document.content, document.contentHtml, JSON.stringify({ source: "crawler" })],
    );
    order += 1;
  }
  for (const attachment of document.attachments) {
    await client.query(
      `INSERT INTO document_blocks (
         document_id, block_type, sort_order, title, content, asset_url, enabled,
         evidence_enabled, evidence_title, evidence_description, metadata
       ) VALUES ($1,'attachment',$2,$3,$4,$5,true,true,$3,'附件下载地址',$6)`,
      [
        documentId, order, attachment.title, attachment.title, attachment.url,
        JSON.stringify({ fileType: attachment.fileType }),
      ],
    );
    order += 1;
  }
}
