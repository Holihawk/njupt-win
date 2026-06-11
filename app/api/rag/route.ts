import { NextResponse } from "next/server";
import { streamRagQuestion, type RagMessage } from "../../../src/rag";
import {
  createRagQuestionHistory,
  finishRagQuestionHistory,
  setRagQuestionSources,
} from "../../../src/rag-history";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: RagMessage[] };
    const messages = validateMessages(body.messages);
    const question = [...messages].reverse().find((message) => message.role === "user")!.content;
    const historyId = await createRagQuestionHistory(question);
    request.signal.addEventListener("abort", () => {
      void finishRagQuestionHistory(historyId, "stopped", "");
    }, { once: true });
    let result;
    try {
      result = await streamRagQuestion(messages);
      await setRagQuestionSources(historyId, result.sources);
    } catch (error) {
      await finishRagQuestionHistory(historyId, "failed", "", (error as Error).message);
      throw error;
    }
    const encoder = new TextEncoder();
    const reader = result.stream.getReader();
    let answer = "";
    let finished = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "sources", sources: result.sources })}\n`));
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            answer += value;
            controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", content: value })}\n`));
          }
          finished = true;
          await finishRagQuestionHistory(historyId, "completed", answer);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "done" })}\n`));
          controller.close();
        } catch (error) {
          finished = true;
          await finishRagQuestionHistory(historyId, "failed", answer, (error as Error).message);
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: (error as Error).message })}\n`));
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
    return NextResponse.json(
      { error: (error as Error).message || "问答请求失败" },
      { status: 400 },
    );
  }
}

function validateMessages(value: RagMessage[] | undefined): RagMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error("messages 不能为空");
  return value.slice(-8).map((message) => {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string") {
      throw new Error("messages 格式不正确");
    }
    const content = message.content.trim().slice(0, 3000);
    if (!content) throw new Error("消息内容不能为空");
    return { role: message.role, content };
  });
}
