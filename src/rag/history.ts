import { createHash } from "node:crypto";
import { query } from "../database/db";
import type { HybridSearchResult } from "../search/hybrid-search";
import type { RagRouteMode } from "./routing";

export type RagHistoryStatus = "pending" | "completed" | "stopped" | "failed";

/**
 * 每次用户提问创建一条独立历史记录。
 *
 * 第一版刻意不记录 IP、Cookie 或浏览器标识，只保存管理员进行内容覆盖分析所需的
 * 问题、回答状态和引用来源，避免无必要的用户身份追踪。
 */
export async function createRagQuestionHistory(
  question: string,
  sessionId: string,
): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO rag_question_history (question, session_id, mode_preference)
     VALUES ($1, $2, 'auto') RETURNING id`,
    [question, sessionDigest(sessionId)],
  );
  return rows[0].id;
}

/** 检索完成后立即保存来源，流式回答中断时管理员仍能看到当时命中了哪些资料。 */
export async function setRagQuestionSources(id: number, routeMode: RagRouteMode, sources: HybridSearchResult[]) {
  await query(
    `UPDATE rag_question_history SET route_mode=$2, source_count=$3, sources=$4
     WHERE id=$1`,
    [
      id,
      routeMode,
      sources.length,
      JSON.stringify(sources.map((source) => ({
        title: source.title,
        url: source.url,
        sourceName: source.sourceName,
      }))),
    ],
  );
}

export async function setRagQuestionFeedback(
  id: number,
  sessionId: string,
  feedback: "helpful" | "unhelpful",
): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `UPDATE rag_question_history SET feedback=$3
     WHERE id=$1 AND session_id=$2 RETURNING id`,
    [id, sessionDigest(sessionId), feedback],
  );
  return rows.length > 0;
}

/** 用户删除匿名会话时同步清除服务端问题记录；sessionId 是唯一授权凭据。 */
export async function deleteRagSession(sessionId: string): Promise<number> {
  const rows = await query<{ id: number }>(
    "DELETE FROM rag_question_history WHERE session_id=$1 RETURNING id",
    [sessionDigest(sessionId)],
  );
  return rows.length;
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

/** 数据库只保存匿名会话凭据的摘要，后台或备份泄露时不能直接操作用户会话。 */
function sessionDigest(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}
