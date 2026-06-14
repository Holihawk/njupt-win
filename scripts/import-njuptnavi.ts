import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { PoolClient } from "pg";
import { importUrlDraft, type EditableBlock, type ImportedDraft } from "../src/admin/import.js";
import { getPool, transaction } from "../src/database/db.js";

const sourceId = "njupt-navi";
const sourceName = "NJUPT-NAVI 生存指南";
const baseUrl = "https://www.njuptnavi.top";
const sitemapUrl = `${baseUrl}/sitemap-0.xml`;

await ensureSource();
const urls = await sitemapUrls(sitemapUrl);
let created = 0;
let updated = 0;
let failed = 0;

for (const [index, url] of urls.entries()) {
  try {
    const draft = await importUrlDraft(url);
    const result = await saveDraft({ ...draft, sourceId, sourceName });
    if (result === "created") created += 1;
    else updated += 1;
    console.log(`[${index + 1}/${urls.length}] ${result} ${draft.title}`);
  } catch (error) {
    failed += 1;
    console.error(`[${index + 1}/${urls.length}] failed ${url}: ${(error as Error).message}`);
  }
}

console.log(JSON.stringify({ total: urls.length, created, updated, failed }, null, 2));
await getPool().end();

async function ensureSource() {
  await getPool().query(
    `INSERT INTO sources (
       id, name, base_url, list_url, source_type, parser_type,
       official_weight, auto_crawl, enabled, notes
     ) VALUES ($1,$2,$3,$4,'content','astro-starlight',0.65,false,true,$5)
     ON CONFLICT (id) DO UPDATE SET
       name=EXCLUDED.name, base_url=EXCLUDED.base_url, list_url=EXCLUDED.list_url,
       source_type=EXCLUDED.source_type, parser_type=EXCLUDED.parser_type,
       official_weight=EXCLUDED.official_weight, enabled=true, notes=EXCLUDED.notes,
       updated_at=now()`,
    [
      sourceId,
      sourceName,
      baseUrl,
      sitemapUrl,
      "社区维护的南邮生存指南，非官方来源；通过 sitemap 幂等导入，每条页面可在后台人工编辑。",
    ],
  );
}

async function sitemapUrls(url: string): Promise<string[]> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`sitemap HTTP ${response.status}`);
  const $ = cheerio.load(await response.text(), { xmlMode: true });
  return $("url > loc").map((_, node) => $(node).text().trim()).get().filter(Boolean);
}

async function saveDraft(draft: ImportedDraft): Promise<"created" | "updated"> {
  return transaction(async (client) => {
    const existing = await client.query<{ id: number }>("SELECT id FROM documents WHERE url=$1", [draft.url]);
    const document = await client.query<{ id: number }>(
      `INSERT INTO documents (
         source_id, source_name, title, url, published_at, author, content,
         document_type, ingestion_type, item_type, content_hash, fetched_at, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'guide','import','page',$8,now(),'active')
       ON CONFLICT (url) DO UPDATE SET
         source_id=EXCLUDED.source_id, source_name=EXCLUDED.source_name, title=EXCLUDED.title,
         published_at=EXCLUDED.published_at, author=EXCLUDED.author, content=EXCLUDED.content,
         document_type='guide', content_hash=EXCLUDED.content_hash, fetched_at=now(),
         status='active', updated_at=now()
       RETURNING id`,
      [
        sourceId, sourceName, draft.title, draft.url, draft.publishedAt, draft.author,
        draft.content, hashDraft(draft),
      ],
    );
    await replaceBlocks(client, document.rows[0].id, draft.blocks);
    return existing.rowCount ? "updated" : "created";
  });
}

async function replaceBlocks(client: PoolClient, documentId: number, blocks: EditableBlock[]) {
  await client.query("DELETE FROM document_blocks WHERE document_id=$1", [documentId]);
  for (const [index, block] of blocks.entries()) {
    await client.query(
      `INSERT INTO document_blocks (
         document_id, block_type, sort_order, title, content, html, asset_url, metadata,
         enabled, evidence_enabled, evidence_title, evidence_description
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        documentId, block.type, index, block.title || null, block.content,
        block.html || null, block.assetUrl || null, JSON.stringify(block.metadata),
        block.enabled, block.evidenceEnabled, block.evidenceTitle || null,
        block.evidenceDescription || null,
      ],
    );
  }
}

function hashDraft(draft: ImportedDraft): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: draft.title, content: draft.content, blocks: draft.blocks }))
    .digest("hex");
}
