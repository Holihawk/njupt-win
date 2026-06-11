import * as cheerio from "cheerio";
import type { Attachment, ListItem, SourceConfig } from "../types.js";
import { absoluteUrl, extractDate, fileType, normalizeWhitespace } from "./utils.js";

export type ParsedDetail = {
  title: string;
  publishedAt: string | null;
  author: string | null;
  content: string;
  contentHtml: string;
  attachments: Attachment[];
};

/**
 * 解析 WebPlus 通知详情页。
 *
 * 提取标题、发布时间、发布单位、正文 HTML/纯文本和附件。附件既可能是普通链接，
 * 也可能藏在 pdfsrc 属性中，因此两种形式都会扫描并按 URL 去重。
 */
export function parseDetail(html: string, item: ListItem, source: SourceConfig): ParsedDetail {
  const $ = cheerio.load(html);
  const content = $(".wp_articlecontent").first();
  const title =
    normalizeWhitespace($("h1.arti_title").first().text()) ||
    normalizeWhitespace($(".info > .title").first().text()) ||
    item.title;
  const pageText = normalizeWhitespace($(".arti_metas, .infoMore").first().text());
  const authorMatch =
    source.id === "njupt-main"
      ? pageText.match(/文章来源：([^\n]+)/)
      : pageText.match(/发布者：(.+?)(?:发布时间|浏览次数|$)/);
  const attachments = new Map<string, Attachment>();

  content.find("a[href], [pdfsrc]").each((_, element) => {
    const node = $(element);
    const href = node.attr("href") ?? node.attr("pdfsrc");
    if (!href || !href.includes("/_upload/")) return;
    const url = absoluteUrl(source.baseUrl, href);
    attachments.set(url, {
      title: normalizeWhitespace(node.text()) || url.split("/").at(-1) || "附件",
      url,
      fileType: fileType(url),
    });
  });

  return {
    title,
    publishedAt: extractDate(pageText) ?? item.publishedAt,
    author: authorMatch?.[1]?.trim() ?? null,
    content: normalizeWhitespace(content.text()),
    contentHtml: content.html() ?? "",
    attachments: [...attachments.values()],
  };
}
