import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import {
  absoluteUrl,
  extractDate,
  fileType,
  normalizeWhitespace,
  USER_AGENT,
} from "./crawler/utils";
import type { AdminSource } from "./admin-data";

export type EditableBlockType =
  | "heading"
  | "text"
  | "table"
  | "image"
  | "attachment"
  | "attachment_text"
  | "html"
  | "manual_note";

export type EditableBlock = {
  type: EditableBlockType;
  title: string;
  content: string;
  html: string;
  assetUrl: string;
  enabled: boolean;
  evidenceEnabled: boolean;
  evidenceTitle: string;
  evidenceDescription: string;
  metadata: Record<string, unknown>;
};

export type ImportedDraft = {
  sourceId: string | null;
  sourceName: string;
  title: string;
  url: string;
  publishedAt: string | null;
  author: string | null;
  content: string;
  documentType: "notice" | "guide" | "faq" | "news" | "manual";
  blocks: EditableBlock[];
};

const attachmentPattern = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar)(?:$|[?#])/i;

/**
 * 把任意公开 URL 解析成后台草稿。
 *
 * 解析器刻意不直接入库：学校站点模板差异很大，自动识别只能作为初稿，
 * 管理员需要在预览页删除导航噪音、修正图片说明和表格内容后再保存。
 */
export async function importUrlDraft(url: string, sources: AdminSource[] = []): Promise<ImportedDraft> {
  const normalizedUrl = new URL(url).toString();
  const html = await fetchImportHtml(normalizedUrl);
  const $ = cheerio.load(html);
  const parsedUrl = new URL(normalizedUrl);
  const baseUrl = parsedUrl.origin;
  const matchedSource = matchSource(parsedUrl, sources);

  $("script, style, noscript, iframe").remove();
  const sourceName = matchedSource?.name ?? inferSourceName(parsedUrl.hostname);
  const title = inferTitle($);
  const contentRoot = selectContentRoot($);
  const blocks = extractBlocks($, contentRoot, baseUrl);
  const content = normalizeWhitespace(
    blocks
      .filter((block) => block.enabled && ["heading", "text", "table"].includes(block.type))
      .map((block) => block.content)
      .join("\n\n"),
  );

  return {
    sourceId: matchedSource?.id ?? null,
    sourceName,
    title,
    url: normalizedUrl,
    publishedAt: extractDate(contentRoot.text()) ?? null,
    author: null,
    content: content || title,
    documentType: title.includes("通知") ? "notice" : "guide",
    blocks,
  };
}

/**
 * 后台 URL 导入使用独立 fetch，避免把 CLI 抓取器的 .js 扩展导入链带进 Next 构建。
 * 请求策略仍复用统一 User-Agent，便于学校网站侧识别为公开信息工具。
 */
async function fetchImportHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}

/** 从页面标题、正文标题和当前位置中选择最像内容标题的一项。 */
function inferTitle($: cheerio.CheerioAPI): string {
  const candidates = [
    $("h1.arti_title").first().text(),
    $("h1").first().text(),
    $(".title").first().text(),
    $("title").first().text().replace(/[-_].*$/, ""),
  ].map(normalizeWhitespace).filter(Boolean);
  return candidates[0] || "未命名页面";
}

/** 根据域名给导入草稿一个可读来源；保存时仍允许管理员改成正式来源。 */
function inferSourceName(hostname: string): string {
  if (hostname === "www.njupt.edu.cn") return "南京邮电大学官网";
  if (hostname === "lib.njupt.edu.cn") return "南京邮电大学图书馆";
  if (hostname === "jwc.njupt.edu.cn") return "南京邮电大学本科生院";
  return hostname;
}

/** 按 URL origin 匹配后台维护的数据源，导入草稿会自动带上 source_id 和官方名称。 */
function matchSource(url: URL, sources: AdminSource[]): AdminSource | null {
  return sources.find((source) => {
    try {
      return new URL(source.baseUrl).origin === url.origin;
    } catch {
      return false;
    }
  }) ?? null;
}

/**
 * 选择正文容器。
 *
 * WebPlus 页面常见正文类名不完全一致，所以先按明确正文容器找；
 * 找不到时退回到文本量最大的 main/div/section，避免把整站导航全部入库。
 */
function selectContentRoot($: cheerio.CheerioAPI): cheerio.Cheerio<AnyNode> {
  const selectors = [
    ".wp_articlecontent",
    ".articlecontent",
    ".article_content",
    ".wp_content",
    ".main_content",
    ".content",
    ".con",
    "main",
  ];
  for (const selector of selectors) {
    const candidate = $(selector)
      .filter((_, node: AnyNode) => normalizeWhitespace($(node).text()).length > 30)
      .first();
    if (candidate.length) return candidate;
  }
  const candidates = $("article, section, div").get().map((node) => ({
    node,
    length: normalizeWhitespace($(node).text()).length,
  }));
  const best = candidates.sort((a, b) => b.length - a.length)[0]?.node;
  return best ? $(best) : $("body");
}

function extractBlocks(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<AnyNode>,
  baseUrl: string,
): EditableBlock[] {
  const blocks: EditableBlock[] = [];
  const seenAssets = new Set<string>();

  root.find("h1,h2,h3,h4,p,li,table,img,a[href],[pdfsrc]").each((_, node) => {
    const element = $(node);
    if (element.parents("table").length && !element.is("table")) return;
    const tag = node.tagName?.toLowerCase();

    if (tag === "table") {
      const markdown = tableToMarkdown($, element);
      if (markdown) {
        blocks.push({
          type: "table",
          title: tableCaption($, element),
          content: markdown,
          html: element.prop("outerHTML") ?? "",
          assetUrl: "",
          enabled: true,
          evidenceEnabled: false,
          evidenceTitle: "",
          evidenceDescription: "",
          metadata: { rows: tableToRows($, element) },
        });
      }
      return;
    }

    if (tag === "img") {
      const src = element.attr("src") || element.attr("original-src");
      if (!src) return;
      const assetUrl = absoluteUrl(baseUrl, src);
      if (seenAssets.has(assetUrl)) return;
      seenAssets.add(assetUrl);
      blocks.push({
        type: "image",
        title: normalizeWhitespace(element.attr("alt") ?? element.attr("title") ?? ""),
        content: normalizeWhitespace(element.attr("alt") ?? ""),
        html: "",
        assetUrl,
        enabled: true,
        evidenceEnabled: true,
        evidenceTitle: normalizeWhitespace(element.attr("alt") ?? element.attr("title") ?? ""),
        evidenceDescription: normalizeWhitespace(element.attr("alt") ?? ""),
        metadata: { alt: element.attr("alt") ?? "", originalSrc: element.attr("original-src") ?? "" },
      });
      return;
    }

    const href = element.attr("href") ?? element.attr("pdfsrc");
    if (href && attachmentPattern.test(href)) {
      const assetUrl = absoluteUrl(baseUrl, href);
      if (seenAssets.has(assetUrl)) return;
      seenAssets.add(assetUrl);
      const title = normalizeWhitespace(element.text()) || assetUrl.split("/").at(-1) || "附件";
      blocks.push({
        type: "attachment",
        title,
        content: title,
        html: "",
        assetUrl,
        enabled: true,
        evidenceEnabled: true,
        evidenceTitle: title,
        evidenceDescription: "附件下载地址",
        metadata: { fileType: fileType(assetUrl) },
      });
      return;
    }

    if (/^h[1-4]$/.test(tag ?? "")) {
      const content = normalizeWhitespace(element.text());
      if (content) {
        blocks.push({
          type: "heading",
          title: "",
          content,
          html: "",
          assetUrl: "",
          enabled: true,
          evidenceEnabled: false,
          evidenceTitle: "",
          evidenceDescription: "",
          metadata: { level: Number(tag?.slice(1)) },
        });
      }
      return;
    }

    if (tag === "p" || tag === "li") {
      const content = normalizeWhitespace(element.text());
      if (content && content.length > 1) {
        blocks.push({
          type: "text",
          title: "",
          content,
          html: "",
          assetUrl: "",
          enabled: true,
          evidenceEnabled: false,
          evidenceTitle: "",
          evidenceDescription: "",
          metadata: {},
        });
      }
    }
  });

  return mergeTextBlocks(blocks).slice(0, 120);
}

/** 邻近短段落合并，降低后台编辑和后续向量分块的噪音。 */
function mergeTextBlocks(blocks: EditableBlock[]): EditableBlock[] {
  const result: EditableBlock[] = [];
  for (const block of blocks) {
    const previous = result.at(-1);
    if (block.type === "text" && previous?.type === "text" && previous.content.length < 500) {
      previous.content = normalizeWhitespace(`${previous.content}\n${block.content}`);
    } else {
      result.push(block);
    }
  }
  return result;
}

function tableCaption($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string {
  return normalizeWhitespace(table.find("caption").first().text() || table.prev("h1,h2,h3,h4,p").text());
}

function tableToRows($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string[][] {
  return table.find("tr").get().map((row: AnyNode) =>
    $(row).find("th,td").get().map((cell) => normalizeWhitespace($(cell).text())),
  ).filter((row: string[]) => row.some(Boolean));
}

function tableToMarkdown($: cheerio.CheerioAPI, table: cheerio.Cheerio<AnyNode>): string {
  const rows = tableToRows($, table);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ""));
  const [header, ...body] = normalized;
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}
