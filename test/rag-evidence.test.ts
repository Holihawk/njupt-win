import { describe, expect, it } from "vitest";
import { selectRelevantEvidence } from "../src/rag.js";
import type { HybridSearchResult } from "../src/hybrid-search.js";

describe("selectRelevantEvidence", () => {
  it("returns only the most relevant image for a specific map question", () => {
    const [result] = selectRelevantEvidence(
      [source([
        evidence("仙林校区地图", "xianlin.jpg"),
        evidence("三牌楼校区地图", "sanpailou.jpg"),
        evidence("Contributor avatar", "avatar.jpg"),
      ])],
      "给我找仙林地图",
    );

    expect(result.evidences).toEqual([evidence("仙林校区地图", "xianlin.jpg")]);
  });

  it("does not return unrelated images for a text-only question", () => {
    const [result] = selectRelevantEvidence(
      [source([evidence("仙林校区地图", "xianlin.jpg")])],
      "校园卡怎么充值",
    );

    expect(result.evidences).toEqual([]);
  });
});

function source(evidences: HybridSearchResult["evidences"]): HybridSearchResult {
  return {
    documentId: 1,
    title: "校区地图",
    url: "https://example.com",
    sourceName: "测试来源",
    publishedAt: null,
    documentType: "guide",
    blockType: "image",
    snippet: "",
    context: "",
    score: 10,
    evidences,
  };
}

function evidence(title: string, assetUrl: string): HybridSearchResult["evidences"][number] {
  return { type: "image", title, description: title, assetUrl };
}
