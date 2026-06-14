"use server";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { clearAdminSession, requireAdmin } from "../../src/admin/auth";
import { query, transaction } from "../../src/database/db";
import type { EditableBlock, EditableBlockType } from "../../src/admin/import";

/** 清除后台 cookie 后回到登录页。 */
export async function logout() {
  await clearAdminSession();
  redirect("/admin/login");
}

/** 新增数据源。来源可先停用，等配置好栏目和解析器后再接入增量抓取。 */
export async function createSource(formData: FormData) {
  await requireAdmin();
  const value = sourceFields(formData);
  await query(
    `INSERT INTO sources (
       id, name, base_url, list_url, source_type, parser_type,
       official_weight, auto_crawl, enabled, notes
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      value.id, value.name, value.baseUrl, value.listUrl, value.sourceType,
      value.parserType, value.officialWeight, value.autoCrawl, value.enabled, value.notes,
    ],
  );
  revalidatePath("/admin");
}

/** 编辑数据源元信息。source id 作为外键和解析器标识，创建后不允许修改。 */
export async function updateSource(formData: FormData) {
  await requireAdmin();
  const value = sourceFields(formData);
  await query(
    `UPDATE sources SET name=$2, base_url=$3, list_url=$4, source_type=$5,
       parser_type=$6, official_weight=$7, auto_crawl=$8, enabled=$9, notes=$10,
       updated_at=now() WHERE id=$1`,
    [
      value.id, value.name, value.baseUrl, value.listUrl, value.sourceType,
      value.parserType, value.officialWeight, value.autoCrawl, value.enabled, value.notes,
    ],
  );
  revalidatePath("/admin");
  redirect("/admin");
}

/** 软切换来源状态；停用来源不会删除已经入库的历史文档。 */
export async function toggleSource(formData: FormData) {
  await requireAdmin();
  await query("UPDATE sources SET enabled = NOT enabled, updated_at=now() WHERE id=$1", [
    required(formData, "id"),
  ]);
  revalidatePath("/admin");
}

/** 手动创建文档，同时用正文生成一个 text block，保证后续 RAG 有统一入口。 */
export async function createDocument(formData: FormData) {
  await requireAdmin();
  const value = documentFields(formData);
  const blocks = blocksFromForm(formData, value.content);
  const content = contentFromBlocks(blocks, value.content);
  const hashed = hash({ ...value, content });
  await transaction(async (client) => {
    const document = await client.query<{ id: number }>(
      `INSERT INTO documents (
         source_id, source_name, title, url, published_at, author, content,
         document_type, ingestion_type, item_type, content_hash, fetched_at,
         status, pinned, expires_at
       ) VALUES ($1,COALESCE((SELECT name FROM sources WHERE id=$1),$2),$3,$4,$5,$6,$7,$8,'manual','page',$9,now(),$10,$11,$12)
       RETURNING id`,
      [
        value.sourceId, value.sourceName, value.title, value.url, value.publishedAt,
        value.author, content, value.documentType, hashed, value.status,
        value.pinned, value.expiresAt,
      ],
    );
    await replaceBlocks(client, document.rows[0].id, blocks);
    await replaceAttachmentRows(client, document.rows[0].id, blocks);
  });
  revalidatePublicPages();
}

/** 保存文档和内容块。blocks 是正文、表格、图片、附件的统一后台编辑模型。 */
export async function updateDocument(formData: FormData) {
  await requireAdmin();
  const id = Number(required(formData, "id"));
  const value = documentFields(formData);
  const blocks = blocksFromForm(formData, value.content);
  const content = contentFromBlocks(blocks, value.content);
  const hashed = hash({ ...value, content });
  await transaction(async (client) => {
    await client.query(
      `UPDATE documents SET source_id=$2,
         source_name=COALESCE((SELECT name FROM sources WHERE id=$2),$3), title=$4, url=$5,
         published_at=$6, author=$7, content=$8, document_type=$9, content_hash=$10,
         status=$11, pinned=$12, expires_at=$13, updated_at=now()
       WHERE id=$1`,
      [
        id, value.sourceId, value.sourceName, value.title, value.url, value.publishedAt,
        value.author, content, value.documentType, hashed, value.status,
        value.pinned, value.expiresAt,
      ],
    );
    await replaceBlocks(client, id, blocks);
    await replaceAttachmentRows(client, id, blocks);
  });
  revalidatePublicPages();
  redirect("/admin");
}

/** 归档而不是硬删除，避免下一次抓取或导入把被人工删除的内容重新暴露给用户。 */
export async function archiveDocument(formData: FormData) {
  await requireAdmin();
  await query("UPDATE documents SET status='archived', updated_at=now() WHERE id=$1", [
    Number(required(formData, "id")),
  ]);
  revalidatePublicPages();
}

/** 将 URL 导入预览页确认后的草稿保存为正式文档，并同步附件表。 */
export async function createImportedDocument(formData: FormData) {
  await requireAdmin();
  const value = documentFields(formData);
  const blocks = blocksFromForm(formData, value.content);
  const content = contentFromBlocks(blocks, value.content);
  const hashed = hash({ ...value, content });
  await transaction(async (client) => {
    const document = await client.query<{ id: number }>(
      `INSERT INTO documents (
         source_id, source_name, title, url, published_at, author, content,
         document_type, ingestion_type, item_type, content_hash, fetched_at,
         status, pinned, expires_at
       ) VALUES ($1,COALESCE((SELECT name FROM sources WHERE id=$1),$2),$3,$4,$5,$6,$7,$8,'manual','page',$9,now(),$10,$11,$12)
       ON CONFLICT (url) DO UPDATE SET
         source_id = EXCLUDED.source_id,
         source_name = EXCLUDED.source_name,
         title = EXCLUDED.title,
         published_at = EXCLUDED.published_at,
         author = EXCLUDED.author,
         content = EXCLUDED.content,
         document_type = EXCLUDED.document_type,
         content_hash = EXCLUDED.content_hash,
         status = EXCLUDED.status,
         pinned = EXCLUDED.pinned,
         expires_at = EXCLUDED.expires_at,
         updated_at = now()
       RETURNING id`,
      [
        value.sourceId, value.sourceName, value.title, value.url, value.publishedAt,
        value.author, content, value.documentType, hashed, value.status,
        value.pinned, value.expiresAt,
      ],
    );
    const documentId = document.rows[0].id;
    await replaceBlocks(client, documentId, blocks);
    await replaceAttachmentRows(client, documentId, blocks);
  });
  revalidatePublicPages();
  redirect("/admin");
}

function sourceFields(formData: FormData) {
  const id = required(formData, "id");
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(id)) {
    throw new Error("source id must use lowercase letters, numbers and hyphens");
  }
  return {
    id,
    name: required(formData, "name"),
    baseUrl: validUrl(required(formData, "baseUrl")),
    listUrl: optional(formData, "listUrl") ? validUrl(optional(formData, "listUrl")!) : null,
    sourceType: required(formData, "sourceType"),
    parserType: required(formData, "parserType"),
    officialWeight: Number(required(formData, "officialWeight")),
    autoCrawl: formData.get("autoCrawl") === "on",
    enabled: formData.get("enabled") === "on",
    notes: optional(formData, "notes"),
  };
}

function documentFields(formData: FormData) {
  return {
    sourceId: optional(formData, "sourceId"),
    sourceName: required(formData, "sourceName"),
    title: required(formData, "title"),
    url: validUrl(required(formData, "url")),
    publishedAt: optional(formData, "publishedAt"),
    author: optional(formData, "author"),
    content: required(formData, "content"),
    documentType: required(formData, "documentType"),
    status: required(formData, "status"),
    pinned: formData.get("pinned") === "on",
    expiresAt: optional(formData, "expiresAt"),
  };
}

/**
 * 从可编辑 block 表单还原结构化内容。
 *
 * 前端使用 block.0.type 这类稳定字段名，避免依赖 FormData 顺序；
 * disabled block 仍保存，便于管理员临时隐藏图片或表格后再恢复。
 */
function blocksFromForm(formData: FormData, fallbackContent: string): EditableBlock[] {
  const count = Number(formData.get("blockCount") ?? 0);
  if (!Number.isInteger(count) || count <= 0) {
    return [{
      type: "text",
      title: "",
      content: fallbackContent,
      html: "",
      assetUrl: "",
      enabled: true,
      evidenceEnabled: false,
      evidenceTitle: "",
      evidenceDescription: "",
      metadata: {},
    }];
  }
  return Array.from({ length: count }, (_, index) => {
    const prefix = `block.${index}`;
    const type = required(formData, `${prefix}.type`) as EditableBlockType;
    const assetUrl = optional(formData, `${prefix}.assetUrl`) ?? "";
    const metadata = normalizeBlockMetadata(
      type,
      assetUrl,
      parseMetadata(optional(formData, `${prefix}.metadata`)),
    );
    return {
      type,
      title: optional(formData, `${prefix}.title`) ?? "",
      content: optional(formData, `${prefix}.content`) ?? "",
      html: optional(formData, `${prefix}.html`) ?? "",
      assetUrl,
      enabled: formData.get(`${prefix}.enabled`) === "on",
      evidenceEnabled: formData.get(`${prefix}.evidenceEnabled`) === "on",
      evidenceTitle: optional(formData, `${prefix}.evidenceTitle`) ?? "",
      evidenceDescription: optional(formData, `${prefix}.evidenceDescription`) ?? "",
      metadata,
    };
  }).filter((block) => block.content || block.assetUrl || block.html);
}

/**
 * 聚合正文由启用的文本型 block 自动生成。
 *
 * 这样管理员删除导航噪音、禁用图片或重排表格后，不需要再手动同步 content；
 * 后续摘要、搜索和向量化都能读到清理后的内容。
 */
function contentFromBlocks(blocks: EditableBlock[], fallbackContent: string): string {
  const content = blocks
    .filter((block) => block.enabled)
    .filter((block) => ["heading", "text", "table", "manual_note", "attachment_text"].includes(block.type))
    .map((block) => [block.title, block.content].filter(Boolean).join("\n"))
    .join("\n\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return content || fallbackContent;
}

function normalizeBlockMetadata(
  type: EditableBlockType,
  assetUrl: string,
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  if (type === "attachment" && assetUrl && typeof metadata.fileType !== "string") {
    return { ...metadata, fileType: fileTypeFromUrl(assetUrl) };
  }
  if (type === "image" && assetUrl) {
    return {
      ...metadata,
      displayInAnswer: typeof metadata.displayInAnswer === "boolean" ? metadata.displayInAnswer : true,
    };
  }
  return metadata;
}

async function replaceBlocks(
  client: PoolClient,
  documentId: number,
  blocks: EditableBlock[],
) {
  // 采用整体替换而不是逐条 diff，保证管理员重排/禁用/修正 block 后状态一致；
  // 后续如果需要保留 block 历史，可以在这里改为写 document_block_versions。
  await client.query("DELETE FROM document_blocks WHERE document_id = $1", [documentId]);
  for (const [index, block] of blocks.entries()) {
    await client.query(
      `INSERT INTO document_blocks (
         document_id, block_type, sort_order, title, content, html, asset_url,
         metadata, enabled, evidence_enabled, evidence_title, evidence_description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        documentId, block.type, index, block.title || null, block.content, block.html || null,
        block.assetUrl || null, JSON.stringify(block.metadata ?? {}), block.enabled,
        block.evidenceEnabled, block.evidenceTitle || null, block.evidenceDescription || null,
      ],
    );
  }
}

async function replaceAttachmentRows(
  client: PoolClient,
  documentId: number,
  blocks: EditableBlock[],
) {
  // 附件 block 是 RAG 展示下载来源的权威输入，因此保存导入草稿时同步 attachments 表。
  // 附件正文解析仍由后续解析任务负责，这里只维护 URL、标题和文件类型。
  await client.query("DELETE FROM attachments WHERE document_id = $1", [documentId]);
  const blockRows = await client.query<{ id: number; sort_order: number }>(
    "SELECT id, sort_order FROM document_blocks WHERE document_id = $1 ORDER BY sort_order",
    [documentId],
  );
  for (const [index, block] of blocks.entries()) {
    if (block.type !== "attachment" || !block.assetUrl) continue;
    const sourceBlockId = blockRows.rows.find((row) => row.sort_order === index)?.id ?? null;
    await client.query(
      `INSERT INTO attachments (document_id, source_block_id, title, url, file_type)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (document_id, url) DO UPDATE
       SET title = EXCLUDED.title, file_type = EXCLUDED.file_type,
           source_block_id = EXCLUDED.source_block_id`,
      [
        documentId,
        sourceBlockId,
        block.title || block.content || "附件",
        block.assetUrl,
        typeof block.metadata.fileType === "string" ? block.metadata.fileType : null,
      ],
    );
  }
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function hash(value: ReturnType<typeof documentFields>): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function required(formData: FormData, key: string): string {
  const value = String(formData.get(key) ?? "").trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function optional(formData: FormData, key: string): string | null {
  return String(formData.get(key) ?? "").trim() || null;
}

function validUrl(value: string): string {
  return new URL(value).toString();
}

function fileTypeFromUrl(value: string): string | null {
  try {
    return new URL(value).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function revalidatePublicPages() {
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/admin");
}
