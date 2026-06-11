import { getPool } from "../src/db.js";
import { rebuildChunks } from "../src/chunking.js";

const report = await rebuildChunks();
console.log(JSON.stringify(report, null, 2));
await getPool().end();
