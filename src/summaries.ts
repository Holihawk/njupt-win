import { query, transaction } from "./db";
import { hasApiPool } from "./api-pool";
import type { Document } from "./types";

export const noticeCategories = [
  "考试",
  "竞赛",
  "教务",
  "活动",
  "就业",
  "科研",
  "校园事务",
  "其他",
] as const;

export type NoticeCategory = (typeof noticeCategories)[number];

/** 标签的名称、颜色语义和分类规则集中定义，避免页面与生成脚本各自维护一套判断。 */
export const noticeCategoryMeta: Record<
  NoticeCategory,
  { label: string; tone: string; pattern: RegExp }
> = {
  考试: { label: "考试", tone: "red", pattern: /考试|四六级|考场|准考证|成绩|补考|重修/ },
  教务: { label: "教务", tone: "blue", pattern: /教务|课程|教学|选课|转专业|学位|培养方案|专业建设/ },
  活动: { label: "活动", tone: "yellow", pattern: /活动|讲座|沙龙|展览|征集|访学|交流项目|校园文化/ },
  竞赛: { label: "竞赛", tone: "pink", pattern: /竞赛|比赛|作品遴选|创新实验班/ },
  科研: { label: "科研", tone: "purple", pattern: /科研|研究项目|课题|科技成果|学术/ },
  就业: { label: "就业", tone: "green", pattern: /就业|招聘|创业|实习|资助项目/ },
  校园事务: { label: "校园事务", tone: "orange", pattern: /交通|安全|后勤|巡察|放假|校园事务|体质|专项行动/ },
  其他: { label: "其他", tone: "gray", pattern: /$a/ },
};

export type NoticeSummary = {
  documentUrl: string;
  documentHash: string;
  title: string;
  summary: string;
  category: NoticeCategory;
  audience: string[];
  importance: number;
  deadline: string | null;
  keywords: string[];
  provider: "local" | "llm";
  generatedAt: string;
};

/** 只有模型地址、密钥和模型名均存在时，首页才展示 AI 摘要。 */
export function hasLlmConfig(): boolean {
  return hasApiPool("LLM");
}

/**
 * 使用确定性规则生成本地摘要。
 *
 * 它既是未配置模型时的开发回退，也是 LLM 调用失败时的容错方案。
 */
export function localSummary(document: Document, now = new Date()): NoticeSummary {
  const source = document.content.trim() || attachmentContext(document);
  const combined = `${document.title} ${source}`;
  return {
    documentUrl: document.url,
    documentHash: document.hash,
    title: document.title,
    summary: compactSummary(summarizeText(source, document.title)),
    category: classifyNotice(combined),
    audience: detectAudience(combined),
    importance: detectImportance(combined),
    deadline: detectDeadline(combined),
    keywords: detectKeywords(combined),
    provider: "local",
    generatedAt: now.toISOString(),
  };
}

/**
 * 根据标题、正文和关键词进行确定性分类。
 *
 * 规则顺序即优先级，例如包含“考试”的教务通知优先归为考试，
 * 包含“比赛”的教学通知优先归为竞赛，以降低用户识别成本。
 */
export function classifyNotice(value: string, keywords: string[] = []): NoticeCategory {
  const searchable = `${value} ${keywords.join(" ")}`;
  return noticeCategories.find((category) => noticeCategoryMeta[category].pattern.test(searchable))
    ?? "其他";
}

/** 返回标签展示元数据，供组件使用同一套名称和颜色语义。 */
export function getNoticeCategoryMeta(category: NoticeCategory) {
  return noticeCategoryMeta[category];
}

/** 统一清洗并截断摘要，保证模型输出和本地输出遵守相同的 50 字限制。 */
export function compactSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 50 ? `${normalized.slice(0, 49)}…` : normalized;
}

/**
 * 选择首页需要展示的近期摘要。
 *
 * 只有摘要保存的 documentHash 与当前文档一致时才展示，防止正文更新后继续显示旧摘要。
 */
export function selectRecentSummaries(
  summaries: NoticeSummary[],
  documents: Document[],
  now: Date,
  days = 14,
  limit = 5,
): NoticeSummary[] {
  const documentByUrl = new Map(documents.map((document) => [document.url, document]));
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);

  return summaries
    .filter((summary) => {
      const document = documentByUrl.get(summary.documentUrl);
      return (
        document?.publishedAt &&
        document.hash === summary.documentHash &&
        new Date(`${document.publishedAt}T00:00:00`) >= cutoff
      );
    })
    .sort((a, b) =>
      (documentByUrl.get(b.documentUrl)?.publishedAt ?? "").localeCompare(
        documentByUrl.get(a.documentUrl)?.publishedAt ?? "",
      ),
    )
    .slice(0, limit);
}

/** 从 PostgreSQL 加载摘要。 */
export async function loadSummaries(): Promise<NoticeSummary[]> {
  const rows = await query<SummaryRow>(
    `SELECT d.url AS document_url, s.document_hash, d.title, s.summary, s.category,
            s.audience, s.importance, s.deadline::text, s.keywords, s.provider, s.generated_at
     FROM document_summaries s
     JOIN documents d ON d.id = s.document_id
     WHERE d.status = 'active'
     ORDER BY s.generated_at DESC`,
  );
  return rows.map((row) => ({
    documentUrl: row.document_url,
    documentHash: row.document_hash,
    title: row.title,
    summary: row.summary,
    category: row.category,
    audience: row.audience,
    importance: row.importance,
    deadline: row.deadline,
    keywords: row.keywords,
    provider: row.provider,
    generatedAt: row.generated_at instanceof Date
      ? row.generated_at.toISOString()
      : new Date(row.generated_at).toISOString(),
  }));
}

/** 批量写入 PostgreSQL；文档 URL 必须已经存在。 */
export async function saveSummaries(summaries: NoticeSummary[]): Promise<void> {
  await transaction(async (client) => {
    for (const summary of summaries) {
      await client.query(
        `INSERT INTO document_summaries (
           document_id, document_hash, summary, category, audience, importance,
           deadline, keywords, provider, generated_at
         )
         SELECT id, $2, $3, $4, $5, $6, $7, $8, $9, $10
         FROM documents WHERE url = $1
         ON CONFLICT (document_id) DO UPDATE SET
           document_hash = EXCLUDED.document_hash, summary = EXCLUDED.summary,
           category = EXCLUDED.category, audience = EXCLUDED.audience,
           importance = EXCLUDED.importance, deadline = EXCLUDED.deadline,
           keywords = EXCLUDED.keywords, provider = EXCLUDED.provider,
           generated_at = EXCLUDED.generated_at`,
        [
          summary.documentUrl, summary.documentHash, summary.summary, summary.category,
          summary.audience, summary.importance, summary.deadline, summary.keywords,
          summary.provider, summary.generatedAt,
        ],
      );
    }
  });
}

/** 对只有附件、没有正文的通知构造可用于摘要的上下文。 */
function attachmentContext(document: Document): string {
  if (document.attachments.length === 0) return document.title;
  return `该通知主要提供${document.attachments.length}个附件，包括：${document.attachments
    .slice(0, 3)
    .map((attachment) => attachment.title)
    .join("、")}。`;
}

/** 从正文前部提取较完整句子，最终长度由 compactSummary 统一约束。 */
function summarizeText(content: string, title: string): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (!cleaned) return title;
  if (cleaned.length < 30) return `${title}：${cleaned}`;
  const sentences = cleaned.split(/(?<=[。！？；])/).map((value) => value.trim()).filter(Boolean);
  let result = sentences.slice(0, 2).join("");
  if (result.length < 45) result = cleaned.slice(0, 140);
  return result.length > 160 ? `${result.slice(0, 157)}…` : result;
}

/** 从标题与正文中识别可能受影响的人群。 */
function detectAudience(value: string): string[] {
  const rules = [
    ["本科生", /本科生|本科|学生/],
    ["研究生", /研究生|硕士|博士/],
    ["教师", /教师|教职工/],
    ["毕业生", /毕业生|毕业/],
  ] as const;
  const result = rules.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  return result.length > 0 ? [...new Set(result)] : ["全校师生"];
}

/** 根据考试、截止、申报等高影响关键词估算通知重要度。 */
function detectImportance(value: string): number {
  if (/考试|选课|截止|放假|报名|安全|交通管制/.test(value)) return 5;
  if (/公示|申报|遴选|竞赛|活动时间/.test(value)) return 4;
  return 3;
}

/** 只提取正文中明确出现的截止日期，不对模糊日期做猜测。 */
function detectDeadline(value: string): string | null {
  const match = value.match(/(?:截止(?:时间)?[：:\s]*|至)(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/** 提取预定义高价值关键词，用于后续筛选和检索。 */
function detectKeywords(value: string): string[] {
  return [
    "四六级",
    "期末考试",
    "考试安排",
    "转专业",
    "报名",
    "公示",
    "申报",
    "竞赛",
    "活动",
    "创业",
    "教学",
    "课程",
  ].filter((keyword) => value.includes(keyword)).slice(0, 4);
}

type SummaryRow = {
  document_url: string;
  document_hash: string;
  title: string;
  summary: string;
  category: NoticeCategory;
  audience: string[];
  importance: number;
  deadline: string | null;
  keywords: string[];
  provider: "local" | "llm";
  generated_at: Date | string;
};
