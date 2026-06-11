import { getPool } from "../src/db.js";
import { summarizeNotices } from "../src/summary-batch.js";

const report = await summarizeNotices({ force: process.argv.includes("--force") });
console.log(JSON.stringify(report, null, 2));
await getPool().end();
