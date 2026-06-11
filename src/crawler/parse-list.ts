import * as cheerio from "cheerio";
import type { ListItem, SourceConfig } from "../types.js";
import { absoluteUrl, extractDate, isAttachmentUrl, normalizeWhitespace } from "./utils.js";

/**
 * 将通知列表页解析为统一 ListItem。
 *
 * 两个数据源使用不同模板，因此按 source.id 选择 CSS 选择器；
 * 直接链接 XLS/PDF 的条目会标记为 attachment，不再误当详情页请求。
 */
export function parseList(html: string, source: SourceConfig): ListItem[] {
  const $ = cheerio.load(html);
  const selector =
    source.id === "njupt-main"
      ? "section.pageNews a.news"
      : ".col_news_list ul.news_list li.news > a";

  return $(selector)
    .map((_, element) => {
      const anchor = $(element);
      const url = absoluteUrl(source.baseUrl, anchor.attr("href") ?? "");
      const title = normalizeWhitespace(
        anchor.find(source.id === "njupt-main" ? ".title" : ".news_title").text(),
      );
      const dateText =
        source.id === "njupt-main"
          ? `${anchor.find(".y").text()}-${anchor.find(".d").text()}`
          : anchor.find(".news_meta").text();
      return {
        sourceId: source.id,
        title,
        url,
        publishedAt: extractDate(dateText),
        itemType: isAttachmentUrl(url) ? "attachment" : "page",
      } satisfies ListItem;
    })
    .get()
    .filter((item) => item.title && item.url);
}
