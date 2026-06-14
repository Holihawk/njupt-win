import { NextResponse } from "next/server";
import {
  assertSameOriginRequest,
  internalErrorSummary,
  PublicApiError,
  publicError,
  readJsonBody,
} from "../../../src/security/api-security";
import { streamRagQuestion, type RagMessage } from "../../../src/rag/index";
import {
  createRagQuestionHistory,
  finishRagQuestionHistory,
  setRagQuestionSources,
} from "../../../src/rag/history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const body = await readJsonBody<{
      messages?: RagMessage[];
      sessionId?: string;
    }>(request);
    const messages = validateMessages(body.messages);
    const sessionId = validateSessionId(body.sessionId);
    const question = [...messages].reverse().find((message) => message.role === "user")!.content;
    const historyId = await createRagQuestionHistory(question, sessionId);
    request.signal.addEventListener("abort", () => {
      void finishRagQuestionHistory(historyId, "stopped", "");
    }, { once: true });
    let result;
    try {
      result = await streamRagQuestion(messages);
      await setRagQuestionSources(historyId, result.route.mode, result.sources);
    } catch (error) {
      await finishRagQuestionHistory(historyId, "failed", "", internalErrorSummary(error));
      throw error;
    }
    const encoder = new TextEncoder();
    const reader = result.stream.getReader();
    let answer = "";
    let finished = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({
          type: "meta",
          historyId,
          mode: result.route.mode,
        })}\n`));
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "sources", sources: result.sources })}\n`));
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            answer += value;
            if (answer.length > 40_000) {
              await reader.cancel();
              throw new Error("LLM answer exceeded maximum length");
            }
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", content: value })}\n`));
          }
          finished = true;
          await finishRagQuestionHistory(historyId, "completed", answer);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
          controller.close();
        } catch (error) {
          finished = true;
          await finishRagQuestionHistory(historyId, "failed", answer, internalErrorSummary(error));
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: "回答生成失败，请稍后重试" })}\n`));
          controller.close();
        }
      },
      cancel() {
        reader.cancel();
        if (!finished) void finishRagQuestionHistory(historyId, "stopped", answer);
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  } catch (error) {
    const exposed = publicError(error, "问答请求失败，请稍后重试");
    return NextResponse.json(
      { error: exposed.message },
      { status: exposed.status },
    );
  }
}

function validateSessionId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(normalized)) throw new PublicApiError("sessionId 格式不正确");
  return normalized;
}

function validateMessages(value: RagMessage[] | undefined): RagMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new PublicApiError("messages 不能为空");
  if (value.length > 16) throw new PublicApiError("对话消息过多，请新建会话");
  let totalLength = 0;
  const messages = value.map((message, index) => {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new PublicApiError("messages 格式不正确");
    }
    const expectedRole = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== expectedRole) throw new PublicApiError("messages 顺序不正确");
    const content = message.content.trim().slice(0, 3000);
    if (!content) throw new PublicApiError("消息内容不能为空");
    totalLength += content.length;
    return { role: message.role, content };
  });
  if (messages.at(-1)?.role !== "user") throw new PublicApiError("最后一条消息必须是用户问题");
  if (totalLength > 18_000) throw new PublicApiError("对话内容过长，请新建会话");
  return messages;
}
