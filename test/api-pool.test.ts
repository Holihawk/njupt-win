import { afterEach, describe, expect, it } from "vitest";
import { apiEndpoints, withApiFailover } from "../src/ai/api-pool.js";

const original = {
  urls: process.env.LLM_API_URLS,
  keys: process.env.LLM_API_KEYS,
  models: process.env.LLM_MODELS,
  url: process.env.LLM_API_URL,
  key: process.env.LLM_API_KEY,
  model: process.env.LLM_MODEL,
};

afterEach(() => {
  restore("LLM_API_URLS", original.urls);
  restore("LLM_API_KEYS", original.keys);
  restore("LLM_MODELS", original.models);
  restore("LLM_API_URL", original.url);
  restore("LLM_API_KEY", original.key);
  restore("LLM_MODEL", original.model);
});

describe("API endpoint pool", () => {
  it("pairs arrays by index and broadcasts a single model", () => {
    process.env.LLM_API_URLS = '["https://one.example/v1","https://two.example/v1"]';
    process.env.LLM_API_KEYS = '["key-one","key-two"]';
    process.env.LLM_MODELS = '["model"]';
    expect(apiEndpoints("LLM")).toMatchObject([
      { url: "https://one.example/v1", key: "key-one", model: "model" },
      { url: "https://two.example/v1", key: "key-two", model: "model" },
    ]);
  });

  it("falls over to the next endpoint after a failure", async () => {
    process.env.LLM_API_URLS = '["https://one.example/v1","https://two.example/v1"]';
    process.env.LLM_API_KEYS = '["key-one","key-two"]';
    process.env.LLM_MODELS = '["model"]';
    const attempted: string[] = [];
    const result = await withApiFailover("LLM", async (endpoint) => {
      attempted.push(endpoint.url);
      if (endpoint.url.includes("one")) throw new Error("temporary failure");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempted).toEqual(["https://one.example/v1", "https://two.example/v1"]);
  });
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
