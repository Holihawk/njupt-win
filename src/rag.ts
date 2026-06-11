import { hasApiPool, withApiFailover } from "./api-pool";
import { hybridSearch, type HybridSearchResult } from "./hybrid-search";

export type RagMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RagAnswer = {
  answer: string;
  sources: HybridSearchResult[];
};

type PreparedRagRequest = {
  sources: HybridSearchResult[];
  messages: { role: "system" | "user" | "assistant"; content: string }[];
};

export function hasRagConfig(): boolean {
  return hasApiPool("LLM");
}

/**
 * RAG 问答入口。
 *
 * 每轮都用当前问题和最近一次用户问题做检索，随后把命中的 chunk、原文 URL 与证据
 * 交给 LLM。系统提示明确要求资料不足时拒绝猜测，并使用 [1] 这类编号标注依据。
 */
export async function answerRagQuestion(messages: RagMessage[]): Promise<RagAnswer> {
  const prepared = await prepareRagRequest(messages);
  if (prepared.messages.length === 0) {
    return { answer: noSourcesAnswer, sources: [] };
  }
  const answer = await withApiFailover("LLM", async (endpoint) => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.1,
        max_tokens: 1400,
        messages: prepared.messages,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("LLM returned no content");
    return content;
  });

  return { answer, sources: publicSources(prepared.sources) };
}

/**
 * 返回模型原生流和检索依据。API route 会把模型 SSE 转为站内 NDJSON，
 * 便于浏览器同时接收 sources、增量文本和完成状态。
 */
export async function streamRagQuestion(messages: RagMessage[]) {
  const prepared = await prepareRagRequest(messages);
  if (prepared.messages.length === 0) {
    return { sources: [], stream: textStream(noSourcesAnswer) };
  }
  const stream = await withApiFailover("LLM", async (endpoint) => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: endpoint.model,
        temperature: 0.1,
        max_tokens: 1400,
        stream: true,
        messages: prepared.messages,
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    return requireFirstTextChunk(openAiTextStream(response.body));
  });
  return { sources: publicSources(prepared.sources), stream };
}

/**
 * HTTP 200 不代表模型端点可用：部分代理会返回没有任何文本的空 SSE。
 * 在轮询池选中端点前先读取首个文本块；空流会抛错并触发下一个端点故障转移。
 */
async function requireFirstTextChunk(stream: ReadableStream<string>): Promise<ReadableStream<string>> {
  const reader = stream.getReader();
  const first = await reader.read();
  if (first.done || !first.value) {
    await reader.cancel();
    throw new Error("LLM returned an empty stream");
  }
  let emittedFirst = false;
  return new ReadableStream<string>({
    async pull(controller) {
      if (!emittedFirst) {
        emittedFirst = true;
        controller.enqueue(first.value);
        return;
      }
      const next = await reader.read();
      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel() {
      reader.cancel();
    },
  });
}

async function prepareRagRequest(messages: RagMessage[]): Promise<PreparedRagRequest> {
  const recentMessages = messages.slice(-8);
  const question = [...recentMessages].reverse().find((message) => message.role === "user")?.content.trim();
  if (!question) throw new Error("问题不能为空");
  if (!hasRagConfig()) throw new Error("LLM API 尚未配置");

  const previousQuestion = [...recentMessages]
    .slice(0, -1)
    .reverse()
    .find((message) => message.role === "user")?.content.trim();
  const retrievalQuery = previousQuestion ? `${previousQuestion}\n追问：${question}` : question;
  const sources = selectRelevantEvidence(await hybridSearch(retrievalQuery, 6), question);
  if (sources.length === 0) {
    return { sources: [], messages: [] };
  }

  const context = sources.map((source, index) => {
    const evidence = source.evidences
      .slice(0, 8)
      .map((item) => `${item.type === "image" ? "图片" : "附件"}：${item.title} ${item.assetUrl ?? ""}`)
      .join("\n");
    return [
      `[${index + 1}] ${source.title}`,
      `来源：${source.sourceName}`,
      `发布时间：${source.publishedAt ?? "未知"}`,
      `原文：${source.url}`,
      `内容：${source.context.slice(0, 2200)}`,
      evidence,
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return {
    sources,
    messages: [
      {
        role: "system",
        content:
          "你是南京邮电大学校园信息问答助手。只能依据提供的检索资料回答，不得补充资料中没有的事实。资料不足、冲突或日期不明确时必须直接说明。回答使用简洁中文，并在相关句子后用 [1]、[2] 标注来源编号。附件或图片与问题相关时应明确提醒用户查看对应证据。",
      },
      ...recentMessages.map((message) => ({ role: message.role, content: message.content.slice(0, 3000) })),
      { role: "user", content: `检索资料如下：\n\n${context}\n\n请回答当前问题：${question}` },
    ],
  };
}

/**
 * 证据展示必须比文档召回更严格。
 *
 * 文档可能包含很多图片，但用户询问“仙林地图”时只需要标题最匹配的一张地图。
 * 图片类问题最多保留一张图片；附件按标题相关度最多保留三个，避免把整篇文档的资产全部返回。
 */
export function selectRelevantEvidence(sources: HybridSearchResult[], question: string): HybridSearchResult[] {
  const normalizedQuestion = normalizeEvidenceText(question);
  const terms = evidenceTerms(normalizedQuestion);
  const wantsImage = /地图|图片|图像|照片|二维码|流程图|示意图/.test(normalizedQuestion);
  const wantsAttachment = /附件|下载|表格|文件|pdf|word|excel|安排表/.test(normalizedQuestion);

  const rankedImages = sources.flatMap((source, sourceIndex) =>
    source.evidences
      .filter((evidence) => evidence.type === "image" && evidence.assetUrl)
      .map((evidence) => ({ sourceIndex, evidence, score: evidenceScore(evidence, terms, normalizedQuestion) })),
  ).sort((a, b) => b.score - a.score);
  const selectedImage = wantsImage && rankedImages[0]?.score > 0 ? rankedImages[0] : null;

  const selectedAttachments = sources.flatMap((source, sourceIndex) =>
    source.evidences
      .filter((evidence) => evidence.type === "attachment" && evidence.assetUrl)
      .map((evidence) => ({ sourceIndex, evidence, score: evidenceScore(evidence, terms, normalizedQuestion) })),
  )
    .filter((item) => wantsAttachment ? item.score > 0 : item.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, wantsAttachment ? 3 : 1);

  return sources.map((source, sourceIndex) => {
    const attachments = selectedAttachments
      .filter((item) => item.sourceIndex === sourceIndex)
      .map((item) => item.evidence);
    const images = selectedImage?.sourceIndex === sourceIndex ? [selectedImage.evidence] : [];
    return { ...source, evidences: [...images, ...attachments] };
  });
}

function evidenceScore(
  evidence: HybridSearchResult["evidences"][number],
  terms: string[],
  normalizedQuestion: string,
): number {
  const text = normalizeEvidenceText(`${evidence.title} ${evidence.description}`);
  let score = 0;
  if (text && normalizedQuestion.includes(text)) score += 8;
  if (text && text.includes(normalizedQuestion)) score += 6;
  for (const term of terms) {
    if (text.includes(term)) score += term.length >= 4 ? 3 : 1;
  }
  return score;
}

function evidenceTerms(value: string): string[] {
  const ignored = new Set(["给我", "帮我", "查看", "看看", "寻找", "需要", "相关", "这个", "一个"]);
  const words = value.split(/[\s,，。；;、！？?]+/).filter((term) => term.length >= 2 && !ignored.has(term));
  const grams = new Set(words);
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index + size <= value.length; index += 1) {
      const term = value.slice(index, index + size);
      if (!ignored.has(term)) grams.add(term);
    }
  }
  return [...grams];
}

function normalizeEvidenceText(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "").replace(/[给我帮找看一下请]/g, "");
}

const noSourcesAnswer = "当前信息库中没有找到足够可靠的资料。请尝试换一种问法，或先在后台导入相关官方页面。";

function publicSources(sources: HybridSearchResult[]): HybridSearchResult[] {
  return sources.map((source) => ({ ...source, context: "" }));
}

function textStream(value: string): ReadableStream<string> {
  return new ReadableStream({ start(controller) { controller.enqueue(value); controller.close(); } });
}

function openAiTextStream(body: ReadableStream<Uint8Array>): ReadableStream<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pending: string[] = [];
  return new ReadableStream<string>({
    async pull(controller) {
      if (pending.length > 0) {
        controller.enqueue(pending.shift()!);
        return;
      }
      while (true) {
        const { done, value } = await reader.read();
        buffer += value ? decoder.decode(value, { stream: !done }) : "";
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const data = line.startsWith("data:") ? line.slice(5).trim() : "";
          if (!data || data === "[DONE]") continue;
          try {
            const payload = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
            const content = payload.choices?.[0]?.delta?.content;
            if (content) pending.push(content);
          } catch {
            // 第三方兼容端点偶尔会发送非 JSON 心跳，忽略即可。
          }
        }
        if (pending.length > 0) {
          controller.enqueue(pending.shift()!);
          return;
        }
        if (done) {
          controller.close();
          return;
        }
      }
    },
    cancel() {
      reader.cancel();
    },
  });
}
