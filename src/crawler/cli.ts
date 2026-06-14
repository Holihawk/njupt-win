import { mkdir, writeFile } from "node:fs/promises";
import { query, getPool } from "../database/db.js";
import { PostgresDocumentStore } from "../store/postgres-store.js";
import type { SourceConfig } from "../types.js";
import { crawl } from "./crawl.js";

// 命令行入口仅负责参数校验和文件输出，核心抓取逻辑保留在 crawl 中以便测试与复用。
const rawLimit = process.argv.find((value) => value.startsWith("--limit="));
const limit = rawLimit ? Number(rawLimit.split("=")[1]) : 20;
const softDelete = process.argv.includes("--soft-delete");
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit must be an integer from 1 to 100");
}

const sources = await query<{
  id: string;
  name: string;
  base_url: string;
  list_url: string;
}>(
  `SELECT id, name, base_url, list_url
   FROM sources
   WHERE enabled=true AND auto_crawl=true AND list_url IS NOT NULL
   ORDER BY id`,
);
if (sources.length === 0) {
  throw new Error("no enabled auto_crawl sources with list_url");
}
const configs: SourceConfig[] = sources.map((source) => ({
  id: source.id,
  name: source.name,
  baseUrl: source.base_url,
  listUrl: source.list_url,
}));
const store = new PostgresDocumentStore();
const report = await crawl(
  configs,
  (sourceId, documents, shouldSoftDelete) =>
    store.saveCrawlResult(sourceId, documents, shouldSoftDelete),
  limit,
  softDelete,
);
await mkdir("data", { recursive: true });
await writeFile("data/crawl-report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
await getPool().end();
