import { createHash } from "node:crypto";
import { getPool, transaction } from "./db.js";

const textBlockTypes = new Set(["heading", "text", "table", "manual_note", "attachment_text"]);
const evidenceBlockTypes = new Set(["image", "attachment"]);

type BlockRow = {
  document_id: number;
  source_id: string | null;
  published_at: string | null;
  document_type: string;
  title: string;
  url: string;
  pinned: boolean;
  block_id: number;
  block_type: string;
  block_title: string | null;
  content: string;
  asset_url: string | null;
  evidence_enabled: boolean;
  evidence_title: string | null;
  evidence_description: string | null;
  metadata: Record<string, unknown>;
};

export type ChunkBuildReport = {
  documents: number;
  chunks: number;
  deleted: number;
};

/**
 * 从启用的 block 生成检索 chunk。
 *
 * 文本、表格、附件正文会直接切块；图片和附件链接即使没有正文，也会用标题、说明、
 * alt 文本、文件名生成一个“证据检索 chunk”。这样地图、图片说明、附件下载入口
 * 可以被搜索召回，真正展示时仍然回到 document_blocks 里的证据 URL。
 *
 * 这里不调用 embedding，只维护 chunk 文本和证据元数据；embedding 脚本会根据
 * content_hash 判断哪些 chunk 需要补向量，避免每次后台修正都重算全部内容。
 */
export async function rebuildChunks(): Promise<ChunkBuildReport> {
  const rows = await getPool().query<BlockRow>(
    `SELECT d.id AS document_id, d.source_id, d.published_at::text, d.document_type,
            d.title, d.url, d.pinned,
            b.id AS block_id, b.block_type, b.title AS block_title, b.content,
            b.asset_url, b.evidence_enabled, b.evidence_title,
            b.evidence_description, b.metadata
     FROM document_blocks b
     JOIN documents d ON d.id = b.document_id
     WHERE d.status='active' AND b.enabled=true
     ORDER BY d.id, b.sort_order`,
  );
  const byDocument = new Map<number, BlockRow[]>();
  for (const row of rows.rows) {
    byDocument.set(row.document_id, [...(byDocument.get(row.document_id) ?? []), row]);
  }

  let chunks = 0;
  let deleted = 0;
  await transaction(async (client) => {
    for (const [documentId, blocks] of byDocument.entries()) {
      const keep: { blockId: number; chunkIndex: number }[] = [];
      for (const block of blocks) {
        const parts = chunkContentForBlock(block);
        for (const [chunkIndex, content] of parts.entries()) {
          const contentHash = sha256(content);
          const evidence = evidenceForBlock(block);
          await client.query(
            `INSERT INTO document_chunks (
               document_id, block_id, chunk_index, content, content_hash, source_id,
               published_at, document_type, block_type, title, url, evidence
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (document_id, block_id, chunk_index) DO UPDATE SET
               content = EXCLUDED.content,
               embedding = CASE
                 WHEN document_chunks.content_hash = EXCLUDED.content_hash
                 THEN document_chunks.embedding
                 ELSE NULL
               END,
               embedding_model = CASE
                 WHEN document_chunks.content_hash = EXCLUDED.content_hash
                 THEN document_chunks.embedding_model
                 ELSE NULL
               END,
               content_hash = EXCLUDED.content_hash,
               source_id = EXCLUDED.source_id,
               published_at = EXCLUDED.published_at,
               document_type = EXCLUDED.document_type,
               block_type = EXCLUDED.block_type,
               title = EXCLUDED.title,
               url = EXCLUDED.url,
               evidence = EXCLUDED.evidence,
               updated_at = now()`,
            [
              documentId, block.block_id, chunkIndex, content, contentHash, block.source_id,
              block.published_at, block.document_type, block.block_type, block.title,
              block.url, JSON.stringify(evidence),
            ],
          );
          keep.push({ blockId: block.block_id, chunkIndex });
          chunks += 1;
        }
      }
      const deletedRows = await client.query(
        `DELETE FROM document_chunks
         WHERE document_id = $1 AND NOT (
           (block_id::text || ':' || chunk_index::text) = ANY($2::text[])
         )`,
        [documentId, keep.map((item) => `${item.blockId}:${item.chunkIndex}`)],
      );
      deleted += deletedRows.rowCount ?? 0;
    }
  });
  return { documents: byDocument.size, chunks, deleted };
}

function chunkContentForBlock(block: BlockRow): string[] {
  if (textBlockTypes.has(block.block_type)) {
    const prefix = [block.title, block.block_title].filter(Boolean).join("\n");
    return splitText([prefix, block.content].filter(Boolean).join("\n"));
  }

  if (evidenceBlockTypes.has(block.block_type)) {
    const content = evidenceSearchText(block);
    return content ? [content] : [];
  }

  return [];
}

function evidenceSearchText(block: BlockRow): string {
  const metadata = block.metadata ?? {};
  const alt = typeof metadata.alt === "string" ? metadata.alt : "";
  const originalSrc = typeof metadata.originalSrc === "string" ? metadata.originalSrc : "";
  const filename = filenameFromUrl(block.asset_url ?? originalSrc);
  return [
    block.title,
    block.block_title,
    block.block_type === "image" ? "图片 图像 地图 照片" : "附件 下载 文件",
    block.evidence_title,
    block.evidence_description,
    block.content,
    alt,
    filename,
  ].filter(Boolean).join("\n").replace(/[ \t]+/g, " ").trim();
}

function splitText(value: string, maxLength = 1200, overlap = 120): string[] {
  const normalized = value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim();
  if (!normalized) return [];
  if (normalized.length <= maxLength) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(normalized.length, start + maxLength);
    chunks.push(normalized.slice(start, end).trim());
    if (end === normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

function evidenceForBlock(block: BlockRow) {
  return {
    enabled: block.evidence_enabled,
    title: block.evidence_title || block.block_title || block.title,
    description: block.evidence_description || "",
    assetUrl: block.asset_url,
    blockType: block.block_type,
    metadata: block.metadata ?? {},
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function filenameFromUrl(value: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() ?? "");
  } catch {
    return value.split("/").pop() ?? "";
  }
}
