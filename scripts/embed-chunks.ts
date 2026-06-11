import { embedPendingChunks } from "../src/embeddings.js";
import { getPool } from "../src/db.js";

const rawLimit = process.argv.find((value) => value.startsWith("--limit="));
const rawBatch = process.argv.find((value) => value.startsWith("--batch="));
const limit = rawLimit ? Number(rawLimit.split("=")[1]) : 100;
const batch = rawBatch ? Number(rawBatch.split("=")[1]) : 16;

const report = await embedPendingChunks(limit, batch);
console.log(JSON.stringify(report, null, 2));
await getPool().end();
