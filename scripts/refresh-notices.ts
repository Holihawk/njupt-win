import { closeNoticeRefreshPool, refreshNotices } from "../src/summary/notice-refresh.js";

const rawLimit = process.argv.find((value) => value.startsWith("--limit="));
const limit = rawLimit ? Number(rawLimit.split("=")[1]) : 100;
if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
  throw new Error("--limit must be an integer from 1 to 100");
}

try {
  console.log(JSON.stringify(await refreshNotices(limit), null, 2));
} finally {
  await closeNoticeRefreshPool();
}
