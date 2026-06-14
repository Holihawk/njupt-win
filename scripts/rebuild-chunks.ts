import { getPool } from "../src/database/db.js";
import { rebuildChunks } from "../src/search/chunking.js";

const report = await rebuildChunks();
console.log(JSON.stringify(report, null, 2));
await getPool().end();
