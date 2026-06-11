import { createHash } from "node:crypto";

export const USER_AGENT =
  "njupt.win-crawler/0.1 (+https://njupt.win; public campus notices only)";

/** 统一空白字符，保留必要换行，提升哈希稳定性和摘要质量。 */
export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 将相对链接转为绝对 HTTPS 链接。 */
export function absoluteUrl(baseUrl: string, href: string): string {
  return new URL(href, baseUrl).toString().replace(/^http:/, "https:");
}

/** 从 URL 路径提取小写文件扩展名。 */
export function fileType(url: string): string | null {
  const match = new URL(url).pathname.match(/\.([a-zA-Z0-9]+)$/);
  return match?.[1]?.toLowerCase() ?? null;
}

/** WebPlus 详情页以 /page.htm 结尾，其余列表链接按附件处理。 */
export function isAttachmentUrl(url: string): boolean {
  return !new URL(url).pathname.endsWith("/page.htm");
}

/** 生成正文与附件状态的稳定 SHA-256，用于判断远端内容是否变化。 */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** 从常见中文或数字日期格式中提取 YYYY-MM-DD。 */
export function extractDate(value: string): string | null {
  const match = value.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}
