import { embedTexts, hasEmbeddingConfig, vectorLiteral } from "./embeddings";
import { query } from "./db";

export type SearchEvidence = {
  type: string;
  title: string;
  description: string;
  assetUrl: string | null;
};

export type HybridSearchResult = {
  documentId: number;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string | null;
  documentType: string;
  blockType: string;
  snippet: string;
  /** 命中的原始 chunk，仅供 RAG 组装上下文；搜索结果卡片仍展示较短的 snippet。 */
  context: string;
  score: number;
  evidences: SearchEvidence[];
};

type SearchRow = {
  document_id: number;
  title: string;
  url: string;
  source_name: string;
  published_at: string | null;
  document_type: string;
  block_type: string;
  content: string;
  score: number;
};

/**
 * 混合检索入口。
 *
 * 当前先做“搜索结果增强”，不生成 AI 答案；召回来源包括标题关键词、block 内容关键词，
 * 在配置 embedding 且 chunk 已有向量时叠加向量召回。最终按文档去重并附带图片/附件证据。
 */
export async function hybridSearch(searchText: string, limit = 8): Promise<HybridSearchResult[]> {
  const term = searchText.trim();
  if (!term) return [];
  const terms = searchTerms(term);
  const [keywordRows, vectorRows] = await Promise.all([
    keywordSearch(term, terms, limit * 3),
    vectorSearch(term, limit * 3),
  ]);
  const merged = mergeRows([...keywordRows, ...vectorRows], limit);
  const documentIds = merged.map((row) => row.document_id);
  const [evidences, documentContexts] = await Promise.all([
    evidenceByDocument(documentIds),
    contextByDocument(documentIds),
  ]);
  return merged.map((row) => ({
    documentId: row.document_id,
    title: row.title,
    url: row.url,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    documentType: row.document_type,
    blockType: row.block_type,
    snippet: snippet(row.content, term),
    context: documentContexts.get(row.document_id) ?? row.content,
    score: row.score,
    evidences: evidences.get(row.document_id) ?? [],
  }));
}

/**
 * RAG 不能只读取用于排序的最高分 chunk，否则标题 chunk 可能遮住同一文档内的答案正文。
 * 这里在文档完成召回后补充聚合正文；保留命中 chunk 在最前面，并限制长度避免提示词失控。
 */
async function contextByDocument(documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await query<{ id: number; content: string }>(
    `SELECT id, content FROM documents WHERE id = ANY($1::bigint[])`,
    [documentIds],
  );
  return new Map(rows.map((row) => [row.id, row.content.slice(0, 7000)]));
}

async function keywordSearch(term: string, terms: string[], limit: number): Promise<SearchRow[]> {
  return query<SearchRow>(
    `SELECT d.id AS document_id, d.title, d.url, d.source_name, d.published_at::text,
            d.document_type, c.block_type, c.content,
            (
              CASE WHEN d.title ILIKE '%' || $1 || '%' THEN 8 ELSE 0 END +
              CASE WHEN c.content ILIKE '%' || $1 || '%' THEN 5 ELSE 0 END +
              (
                SELECT count(*)::numeric FROM unnest($2::text[]) token
                WHERE d.title ILIKE '%' || token || '%' OR c.content ILIKE '%' || token || '%'
              ) * 1.8 +
              similarity(d.title, $1) * 4 +
              similarity(c.content, $1) * 2 +
              CASE WHEN d.pinned THEN 2 ELSE 0 END +
              COALESCE(s.official_weight, 1) +
              CASE
                WHEN d.published_at IS NULL OR d.document_type <> 'notice' THEN 0
                ELSE GREATEST(0, 1.5 - (CURRENT_DATE - d.published_at)::numeric / 180)
              END
            ) AS score
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     LEFT JOIN sources s ON s.id = d.source_id
     WHERE d.status='active'
       AND (d.expires_at IS NULL OR d.expires_at >= CURRENT_DATE)
       AND (d.title ILIKE '%' || $1 || '%' OR c.content ILIKE '%' || $1 || '%'
            OR EXISTS (
              SELECT 1 FROM unnest($2::text[]) token
              WHERE d.title ILIKE '%' || token || '%' OR c.content ILIKE '%' || token || '%'
            )
            OR similarity(d.title, $1) > 0.08 OR similarity(c.content, $1) > 0.08)
     ORDER BY score DESC, d.published_at DESC NULLS LAST
     LIMIT $3`,
    [term, terms, limit],
  );
}

async function vectorSearch(term: string, limit: number): Promise<SearchRow[]> {
  if (!hasEmbeddingConfig()) return [];
  const [embedding] = await embedTexts([term]);
  if (!embedding) return [];
  return query<SearchRow>(
    `SELECT d.id AS document_id, d.title, d.url, d.source_name, d.published_at::text,
            d.document_type, c.block_type, c.content,
            (
              10 / (1 + (c.embedding::halfvec(2560) <=> $1::halfvec(2560))) +
              CASE WHEN d.pinned THEN 2 ELSE 0 END +
              COALESCE(s.official_weight, 1)
            ) AS score
     FROM document_chunks c
     JOIN documents d ON d.id = c.document_id
     LEFT JOIN sources s ON s.id = d.source_id
     WHERE d.status='active' AND c.embedding IS NOT NULL
       AND (d.expires_at IS NULL OR d.expires_at >= CURRENT_DATE)
     ORDER BY c.embedding::halfvec(2560) <=> $1::halfvec(2560)
     LIMIT $2`,
    [vectorLiteral(embedding), limit],
  );
}

function mergeRows(rows: SearchRow[], limit: number): SearchRow[] {
  const byDocument = new Map<number, SearchRow>();
  for (const row of rows) {
    const previous = byDocument.get(row.document_id);
    if (!previous || row.score > previous.score) byDocument.set(row.document_id, row);
  }
  return [...byDocument.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

async function evidenceByDocument(documentIds: number[]): Promise<Map<number, SearchEvidence[]>> {
  if (documentIds.length === 0) return new Map();
  const rows = await query<{
    document_id: number;
    block_type: string;
    block_title: string | null;
    evidence_title: string | null;
    evidence_description: string | null;
    asset_url: string | null;
  }>(
    `SELECT document_id, block_type, title AS block_title,
            evidence_title, evidence_description, asset_url
     FROM document_blocks
     WHERE document_id = ANY($1::bigint[]) AND enabled=true AND evidence_enabled=true
       AND block_type IN ('image', 'attachment')
     ORDER BY sort_order`,
    [documentIds],
  );
  const result = new Map<number, SearchEvidence[]>();
  for (const row of rows) {
    const list = result.get(row.document_id) ?? [];
    list.push({
      type: row.block_type,
      title: row.evidence_title ?? row.block_title ?? (row.block_type === "image" ? "相关图片" : "相关附件"),
      description: row.evidence_description ?? "",
      assetUrl: row.asset_url,
    });
    result.set(row.document_id, list);
  }
  return result;
}

function snippet(content: string, term: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  const index = compact.toLocaleLowerCase("zh-CN").indexOf(term.toLocaleLowerCase("zh-CN"));
  const start = index >= 0 ? Math.max(0, index - 60) : 0;
  const value = compact.slice(start, start + 180);
  return `${start > 0 ? "…" : ""}${value}${start + 180 < compact.length ? "…" : ""}`;
}

function searchTerms(value: string): string[] {
  const compact = value.replace(/\s+/g, "");
  const words = value.split(/[\s,，。；;、]+/).map((item) => item.trim()).filter(Boolean);
  const grams = new Set([...words, compact]);
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= compact.length; index += 1) {
      grams.add(compact.slice(index, index + size));
    }
  }
  return [...grams].filter((term) => term.length >= 2).slice(0, 32);
}
