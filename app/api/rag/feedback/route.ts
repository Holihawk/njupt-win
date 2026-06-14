import { NextResponse } from "next/server";
import { assertSameOriginRequest, PublicApiError, publicError, readJsonBody } from "../../../../src/security/api-security";
import { setRagQuestionFeedback } from "../../../../src/rag/history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const body = await readJsonBody<{
      historyId?: number;
      sessionId?: string;
      feedback?: "helpful" | "unhelpful";
    }>(request, 2_000);
    const historyId = Number(body.historyId);
    const sessionId = body.sessionId?.trim() ?? "";
    if (!Number.isSafeInteger(historyId) || historyId <= 0) throw new PublicApiError("historyId 格式不正确");
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sessionId)) throw new PublicApiError("sessionId 格式不正确");
    if (!body.feedback || !["helpful", "unhelpful"].includes(body.feedback)) {
      throw new PublicApiError("feedback 格式不正确");
    }

    const updated = await setRagQuestionFeedback(historyId, sessionId, body.feedback);
    if (!updated) return NextResponse.json({ error: "未找到对应问答记录" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const exposed = publicError(error, "反馈提交失败，请稍后重试");
    return NextResponse.json({ error: exposed.message }, { status: exposed.status });
  }
}
