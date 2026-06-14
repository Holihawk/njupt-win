import type { HybridSearchResult } from "../search/hybrid-search";

/**
 * 混合检索的弱向量命中通常也会获得约 6 分，因此默认要求至少 7 分，并只保留与最高分
 * 差距不超过 4 分的资料。阈值可根据生产问题日志通过 RAG_MIN_SOURCE_SCORE 调整。
 */
export function filterReliableSources(
  sources: HybridSearchResult[],
  minimumScore = configuredMinimumSourceScore(),
  retrievalQuery = "",
): HybridSearchResult[] {
  const intentTerms = retrievalIntentTerms(retrievalQuery);
  const concepts = retrievalIntentConcepts(retrievalQuery);
  const scoredCandidates = sources
    .map((source) => ({ source, coverage: sourceIntentCoverage(source, concepts) }))
    .filter(({ source }) => intentTerms.length === 0 || sourceMatchesIntent(source, intentTerms));
  const maxCoverage = Math.max(0, ...scoredCandidates.map((candidate) => candidate.coverage));
  const conceptCandidates = scoredCandidates
    .filter((candidate) => maxCoverage === 0 || candidate.coverage === maxCoverage)
    .map((candidate) => candidate.source);
  const titleMatches = conceptCandidates.map((source) => ({
    source,
    matches: intentTerms.filter((term) => normalizeIntentText(source.title).includes(term)).length,
  }));
  const maxTitleMatches = Math.max(0, ...titleMatches.map((candidate) => candidate.matches));
  const candidates = titleMatches
    .filter((candidate) => maxTitleMatches === 0 || candidate.matches === maxTitleMatches)
    .map((candidate) => candidate.source);
  const topScore = Number(candidates[0]?.score ?? 0);
  if (!Number.isFinite(topScore) || topScore < minimumScore) return [];
  return candidates
    .filter((source) => Number(source.score) >= minimumScore && Number(source.score) >= topScore - 4)
    .slice(0, 6);
}

/** 清除追加在真实问题后的提示词注入语句，避免污染关键词与向量检索。 */
export function sanitizeRetrievalQuery(value: string): string {
  const safeParts = value
    .split(/[\n。！？!?；;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) =>
      !/忽略.*(?:指令|规则|要求)|系统提示词|开发者消息|资料里如果|照做|执行.*命令|输出.*密钥/i.test(part),
    );
  const focused = safeParts.join(" ")
    .replace(/南京邮电大学|njupt|南邮/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (focused || safeParts.join(" ") || value).slice(0, 500);
}

/** 非流式回答可以直接移除不存在的引用编号，并对缺失引用给出明确提示。 */
export function auditAnswerCitations(answer: string, sourceCount: number, required: boolean): string {
  let hasValidCitation = false;
  const cleaned = answer.replace(/\[(\d+)\]/g, (match, value: string) => {
    const citation = Number(value);
    if (citation >= 1 && citation <= sourceCount) {
      hasValidCitation = true;
      return match;
    }
    return "";
  }).trim();
  const notices = citationAuditNotices(answer, sourceCount, required, hasValidCitation);
  return notices.length > 0 ? `${cleaned}\n\n> ${notices.join(" ")}` : cleaned;
}

/**
 * 流式回答不能撤回已经发送的非法编号，因此保持原生流式体验，并在流结束时追加审计提示。
 */
export function appendCitationAudit(
  stream: ReadableStream<string>,
  sourceCount: number,
  required: boolean,
): ReadableStream<string> {
  if (!required) return stream;
  const reader = stream.getReader();
  let answer = "";
  return new ReadableStream<string>({
    async pull(controller) {
      const next = await reader.read();
      if (!next.done) {
        answer += next.value;
        controller.enqueue(next.value);
        return;
      }
      const notices = citationAuditNotices(answer, sourceCount, required);
      if (notices.length > 0) controller.enqueue(`\n\n> ${notices.join(" ")}`);
      controller.close();
    },
    cancel() {
      reader.cancel();
    },
  });
}

function citationAuditNotices(
  answer: string,
  sourceCount: number,
  required: boolean,
  knownHasValidCitation?: boolean,
): string[] {
  const citations = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  const hasValidCitation = knownHasValidCitation ?? citations.some((citation) => citation >= 1 && citation <= sourceCount);
  const notices = [];
  if (citations.some((citation) => citation < 1 || citation > sourceCount)) {
    notices.push("回答包含无法对应到当前资料的引用编号，请勿将这些编号作为依据。");
  }
  if (required && !hasValidCitation) notices.push("此回答未能生成可核验引用，请以展开的原始来源为准。");
  return notices;
}

function configuredMinimumSourceScore(): number {
  const configured = Number(process.env.RAG_MIN_SOURCE_SCORE ?? 7);
  return Number.isFinite(configured) && configured > 0 ? configured : 7;
}

function sourceMatchesIntent(source: HybridSearchResult, terms: string[]): boolean {
  const text = normalizeIntentText(`${source.title} ${source.context} ${source.snippet}`);
  return terms.some((term) => text.includes(term));
}

function retrievalIntentTerms(value: string): string[] {
  const terms = new Set<string>();
  for (const chunk of retrievalIntentConcepts(value)) {
    terms.add(chunk);
    for (let size = 3; size <= Math.min(5, chunk.length); size += 1) {
      for (let index = 0; index + size <= chunk.length; index += 1) terms.add(chunk.slice(index, index + size));
    }
  }
  return [...terms].filter((term) => term.length >= 2);
}

function retrievalIntentConcepts(value: string): string[] {
  const normalized = normalizeIntentText(sanitizeRetrievalQuery(value))
    .replace(/南京邮电大学|njupt|南邮|请问|帮我|告诉我|查询|查找|哪里|在哪|怎么|如何|什么|相关|最新/g, " ")
    .replace(/\d{4}(?:-\d{2,4})?年?/g, " ")
    .replace(/第?[一二三四五六七八九十\d]+学期|学年度?|安排/g, " ");
  return [...new Set(normalized.split(/\s+/).filter((chunk) => chunk.length >= 2))];
}

function sourceIntentCoverage(source: HybridSearchResult, concepts: string[]): number {
  const text = normalizeIntentText(`${source.title} ${source.context} ${source.snippet}`);
  return concepts.filter((concept) => text.includes(concept)).length;
}

function normalizeIntentText(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
