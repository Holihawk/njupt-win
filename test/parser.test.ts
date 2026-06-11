import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseDetail } from "../src/crawler/parse-detail.js";
import { parseList } from "../src/crawler/parse-list.js";
import { sources } from "../src/crawler/sources.js";

const main = sources.find((source) => source.id === "njupt-main")!;
const jwc = sources.find((source) => source.id === "njupt-jwc")!;

describe("list parsers", () => {
  it("parses main-site notices", async () => {
    const items = parseList(await readFile("test/fixtures/main-list.html", "utf8"), main);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items[0]).toMatchObject({
      sourceId: "njupt-main", publishedAt: "2026-05-27", itemType: "page",
    });
  });

  it("recognizes JWC direct attachment items", async () => {
    const items = parseList(await readFile("test/fixtures/jwc-list.html", "utf8"), jwc);
    expect(items.length).toBeGreaterThanOrEqual(10);
    expect(items.some((item) => item.itemType === "attachment")).toBe(true);
    expect(items.find((item) => item.itemType === "attachment")?.url).toMatch(/\.xls$/);
  });
});

describe("detail parser", () => {
  it("extracts main-site text and metadata", async () => {
    const html = await readFile("test/fixtures/main-detail.html", "utf8");
    const item = parseList(await readFile("test/fixtures/main-list.html", "utf8"), main)[0];
    const detail = parseDetail(html, item, main);
    expect(detail.title).toContain("科技工作者沙龙");
    expect(detail.publishedAt).toBe("2026-05-27");
    expect(detail.author).toContain("科学技术处");
    expect(detail.content.length).toBeGreaterThan(300);
  });

  it("extracts JWC attachments including embedded PDFs", async () => {
    const html = await readFile("test/fixtures/jwc-detail.html", "utf8");
    const item = parseList(await readFile("test/fixtures/jwc-list.html", "utf8"), jwc)
      .find((candidate) => candidate.url.includes("303545"))!;
    const detail = parseDetail(html, item, jwc);
    expect(detail.title).toContain("大学英语四、六级考试");
    expect(detail.publishedAt).toBe("2026-06-05");
    expect(detail.attachments.length).toBeGreaterThanOrEqual(7);
    expect(detail.attachments.some((attachment) => attachment.fileType === "pdf")).toBe(true);
  });
});
