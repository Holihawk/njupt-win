import { query } from "./db";
import type { HybridSearchResult } from "./hybrid-search";

export type RagHistoryStatus = "pending" | "completed" | "stopped" | "failed";

/**
 * 每次用户提问创建一条独立历史记录。
 *
 * 第一版刻意不记录 IP、Cookie 或浏览器标识，只保存管理员进行内容覆盖分析所需的
 * 问题、回答状态和引用来源，避免无必要的用户身份追踪。
 */
export async function createRagQuestionHistory(question: string): Promise<number> {
  const rows = await query<{ id: number }>(
    "INSERT INTO rag_question_history (question) VALUES ($1) RETURNING id",
    [question],
  );
  return rows[0].id;
}

/** 检索完成后立即保存来源，流式回答中断时管理员仍能看到当时命中了哪些资料。 */
export async function setRagQuestionSources(id: number, sources: HybridSearchResult[]) {
  await query(
    `UPDATE rag_question_history SET source_count=$2, sources=$3
     WHERE id=$1`,
    [
      id,
      sources.length,
      JSON.stringify(sources.map((source) => ({
        title: source.title,
        url: source.url,
        sourceName: source.sourceName,
      }))),
    ],
  );
}

export async function finishRagQuestionHistory(
  id: number,
  status: Exclude<RagHistoryStatus, "pending">,
  answer: string,
  error: string | null = null,
) {
  await query(
    `UPDATE rag_question_history
     SET status=$2, answer=$3, error=$4, completed_at=now()
     WHERE id=$1 AND status='pending'`,
    [id, status, answer, error],
  );
}
