import { query } from "../database/db";
import type { EditableBlock, EditableBlockType } from "./import";

export type AdminSource = {
  id: string;
  name: string;
  baseUrl: string;
  listUrl: string | null;
  sourceType: "notice" | "content" | "service";
  parserType: string;
  officialWeight: string;
  autoCrawl: boolean;
  enabled: boolean;
  notes: string | null;
  documentCount: number;
};

export type AdminDocument = {
  id: number;
  sourceId: string | null;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  author: string | null;
  content: string;
  documentType: "notice" | "guide" | "faq" | "news" | "manual";
  ingestionType: "crawler" | "manual" | "import";
  status: "active" | "archived" | "failed";
  pinned: boolean;
  expiresAt: string | null;
  blocks: AdminDocumentBlock[];
};

export type AdminDocumentBlock = EditableBlock & {
  id: number;
  sortOrder: number;
};

export type AdminQuestionHistory = {
  id: number;
  question: string;
  answer: string;
  status: "pending" | "completed" | "stopped" | "failed";
  sourceCount: number;
  routeMode: "campus_rag" | "general_chat" | "mixed" | "unsafe" | null;
  modePreference: "auto" | "campus_rag" | "general_chat";
  feedback: "helpful" | "unhelpful" | null;
  sources: { title: string; url: string; sourceName: string }[];
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

/**
 * 数据源列表包含每个来源下的文档数，便于管理员判断哪些来源已经接入内容。
 */
export async function listAdminSources(): Promise<AdminSource[]> {
  const rows = await query<SourceRow>(
    `SELECT s.*, count(d.id)::int AS document_count
     FROM sources s LEFT JOIN documents d ON d.source_id = s.id
     GROUP BY s.id ORDER BY s.enabled DESC, s.name`,
  );
  return rows.map(mapSource);
}

export async function getAdminSource(id: string): Promise<AdminSource | null> {
  const rows = await query<SourceRow>(
    `SELECT s.*, count(d.id)::int AS document_count
     FROM sources s LEFT JOIN documents d ON d.source_id = s.id
     WHERE s.id = $1 GROUP BY s.id`,
    [id],
  );
  return rows[0] ? mapSource(rows[0]) : null;
}

/**
 * 后台文档列表只查管理页需要展示的字段。
 *
 * 这里不展开 blocks，避免列表页因为大型表格、图片和附件元数据变得很重；
 * 进入单篇编辑页时再调用 getAdminDocument 加载完整可编辑内容。
 */
export async function listAdminDocuments(limit = 35, offset = 0): Promise<AdminDocument[]> {
  const rows = await query<DocumentRow>(
    `SELECT id, source_id, source_name, title, url, published_at::text, author, content,
            document_type, ingestion_type, status, pinned, expires_at::text
     FROM documents ORDER BY updated_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map(mapDocument);
}

/** 后台分页必须覆盖所有文档，因此总数单独查询，不使用列表页的 LIMIT 估算。 */
export async function countAdminDocuments(): Promise<number> {
  const rows = await query<{ count: number }>("SELECT count(*)::int AS count FROM documents");
  return rows[0]?.count ?? 0;
}

/** 提问历史按最新时间倒序分页，回答和引用来源仅在后台展示。 */
export async function listAdminQuestionHistory(limit = 35, offset = 0): Promise<AdminQuestionHistory[]> {
  const rows = await query<QuestionHistoryRow>(
    `SELECT id, question, answer, status, source_count, route_mode, mode_preference, feedback, sources, error,
            created_at::text, completed_at::text
     FROM rag_question_history
     ORDER BY created_at DESC, id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  return rows.map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    sourceCount: row.source_count,
    routeMode: row.route_mode,
    modePreference: row.mode_preference,
    feedback: row.feedback,
    sources: Array.isArray(row.sources) ? row.sources : [],
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));
}

export async function countAdminQuestionHistory(): Promise<number> {
  const rows = await query<{ count: number }>("SELECT count(*)::int AS count FROM rag_question_history");
  return rows[0]?.count ?? 0;
}

/** 单篇编辑页需要完整 blocks，管理员可在同一表单里修正文档元数据和结构化内容。 */
export async function getAdminDocument(id: number): Promise<AdminDocument | null> {
  const rows = await query<DocumentRow>(
    `SELECT id, source_id, source_name, title, url, published_at::text, author, content,
            document_type, ingestion_type, status, pinned, expires_at::text
     FROM documents WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const blocks = await query<BlockRow>(
    `SELECT id, block_type, sort_order, title, content, html, asset_url, metadata,
            enabled, evidence_enabled, evidence_title, evidence_description
     FROM document_blocks WHERE document_id = $1 ORDER BY sort_order`,
    [id],
  );
  return { ...mapDocument(rows[0]), blocks: blocks.map(mapBlock) };
}

type SourceRow = {
  id: string;
  name: string;
  base_url: string;
  list_url: string | null;
  source_type: AdminSource["sourceType"];
  parser_type: string;
  official_weight: string;
  auto_crawl: boolean;
  enabled: boolean;
  notes: string | null;
  document_count: number;
};

type DocumentRow = {
  id: number;
  source_id: string | null;
  source_name: string;
  title: string;
  url: string;
  published_at: string | null;
  author: string | null;
  content: string;
  document_type: AdminDocument["documentType"];
  ingestion_type: AdminDocument["ingestionType"];
  status: AdminDocument["status"];
  pinned: boolean;
  expires_at: string | null;
};

type BlockRow = {
  id: number;
  block_type: EditableBlockType;
  sort_order: number;
  title: string | null;
  content: string;
  html: string | null;
  asset_url: string | null;
  metadata: Record<string, unknown>;
  enabled: boolean;
  evidence_enabled: boolean;
  evidence_title: string | null;
  evidence_description: string | null;
};

type QuestionHistoryRow = {
  id: number;
  question: string;
  answer: string;
  status: AdminQuestionHistory["status"];
  source_count: number;
  route_mode: AdminQuestionHistory["routeMode"];
  mode_preference: AdminQuestionHistory["modePreference"];
  feedback: AdminQuestionHistory["feedback"];
  sources: AdminQuestionHistory["sources"];
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

function mapSource(row: SourceRow): AdminSource {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    listUrl: row.list_url,
    sourceType: row.source_type,
    parserType: row.parser_type,
    officialWeight: row.official_weight,
    autoCrawl: row.auto_crawl,
    enabled: row.enabled,
    notes: row.notes,
    documentCount: row.document_count,
  };
}

function mapDocument(row: DocumentRow): AdminDocument {
  return {
    id: row.id,
    sourceId: row.source_id,
    sourceName: row.source_name,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    author: row.author,
    content: row.content,
    documentType: row.document_type,
    ingestionType: row.ingestion_type,
    status: row.status,
    pinned: row.pinned,
    expiresAt: row.expires_at,
    blocks: [],
  };
}

function mapBlock(row: BlockRow): AdminDocumentBlock {
  return {
    id: row.id,
    sortOrder: row.sort_order,
    type: row.block_type,
    title: row.title ?? "",
    content: row.content,
    html: row.html ?? "",
    assetUrl: row.asset_url ?? "",
    enabled: row.enabled,
    evidenceEnabled: row.evidence_enabled,
    evidenceTitle: row.evidence_title ?? "",
    evidenceDescription: row.evidence_description ?? "",
    metadata: row.metadata,
  };
}
