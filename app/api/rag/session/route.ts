import { NextResponse } from "next/server";
import { assertSameOriginRequest, PublicApiError, publicError, readJsonBody } from "../../../../src/security/api-security";
import { deleteRagSession } from "../../../../src/rag/history";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const body = await readJsonBody<{ sessionId?: string }>(request, 2_000);
    const sessionId = body.sessionId?.trim() ?? "";
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(sessionId)) throw new PublicApiError("sessionId 格式不正确");
    const deleted = await deleteRagSession(sessionId);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    const exposed = publicError(error, "会话删除失败，请稍后重试");
    return NextResponse.json({ error: exposed.message }, { status: exposed.status });
  }
}
