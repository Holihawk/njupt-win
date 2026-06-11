import { describe, expect, it } from "vitest";
import type { Document } from "../src/types.js";
import { recentNotices, searchNotices } from "../src/notices.js";
import {
  classifyNotice,
  hasLlmConfig,
  localSummary,
  selectRecentSummaries,
} from "../src/summaries.js";

const documents = Array.from({ length: 10 }, (_, index) => ({
  title: `${index % 2 ? "考试" : "活动"}通知 ${index}`,
  url: `https://example.com/${index}`,
  publishedAt: `2026-06-${String(10 - index).padStart(2, "0")}`,
  sourceName: "测试来源",
  sourceId: "njupt-main",
  author: null,
  content: "content",
  contentHtml: null,
  attachments: [],
  itemType: "page",
  hash: String(index),
  fetchedAt: "2026-06-10",
  status: "active",
})) as Document[];

describe("notice queries", () => {
  it("returns at most five notices from the latest two weeks", () => {
    expect(recentNotices(documents, new Date(2026, 5, 10))).toHaveLength(5);
  });

  it("searches titles and returns newest seven at most", () => {
    const results = searchNotices(documents, "通知");
    expect(results).toHaveLength(7);
    expect(results[0].publishedAt).toBe("2026-06-10");
  });

  it("creates structured summaries and selects recent matching hashes", () => {
    const summaries = documents.map((document) =>
      localSummary(document, new Date("2026-06-10T00:00:00Z")),
    );
    expect(summaries[0].summary.length).toBeGreaterThan(10);
    expect(summaries.every((summary) => summary.summary.length <= 50)).toBe(true);
    expect(selectRecentSummaries(summaries, documents, new Date(2026, 5, 10))).toHaveLength(5);
  });

  it("only enables summary display with complete LLM config", () => {
    const previous = {
      apiUrl: process.env.LLM_API_URL,
      apiKey: process.env.LLM_API_KEY,
      model: process.env.LLM_MODEL,
    };
    delete process.env.LLM_API_KEY;
    expect(hasLlmConfig()).toBe(false);
    process.env.LLM_API_URL = "https://example.com";
    process.env.LLM_API_KEY = "key";
    process.env.LLM_MODEL = "model";
    expect(hasLlmConfig()).toBe(true);
    process.env.LLM_API_URL = previous.apiUrl;
    process.env.LLM_API_KEY = previous.apiKey;
    process.env.LLM_MODEL = previous.model;
  });

  it("classifies notices from title, content and keywords", () => {
    expect(classifyNotice("大学英语四六级考试安排")).toBe("考试");
    expect(classifyNotice("本科生选课通知")).toBe("教务");
    expect(classifyNotice("校园科技工作者沙龙")).toBe("活动");
    expect(classifyNotice("微课教学", ["作品遴选", "比赛"])).toBe("竞赛");
  });
});
