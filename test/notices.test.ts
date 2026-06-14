import { describe, expect, it } from "vitest";
import type { Document } from "../src/types.js";
import { recentNotices, searchNotices } from "../src/content/notices.js";
import {
  classifyNotice,
  hasLlmConfig,
  localSummary,
  selectRecentSummaries,
} from "../src/summary/summaries.js";

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
    expect(classifyNotice("微课教学比赛", ["作品遴选", "比赛"])).toBe("竞赛");
  });

  it("prioritizes strong title signals and avoids incidental content keywords", () => {
    expect(classifyNotice("关于仙林校区实施临时交通管制的通知", ["考试"])).toBe("校园事务");
    expect(classifyNotice("2026-2027学年第一学期学生选课通知", ["考试", "重修"])).toBe("教务");
    expect(classifyNotice("【教务管理办公室】关于部分教学楼封楼的通知", [], "教务")).toBe("考试");
    expect(classifyNotice("C/C++ 开发环境", ["考试"])).toBe("其他");
    expect(classifyNotice("普通通知", [], "科研")).toBe("科研");
  });
});
