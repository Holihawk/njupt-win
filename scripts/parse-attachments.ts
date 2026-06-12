import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { getPool, transaction } from "../src/db.js";
import { USER_AGENT } from "../src/crawler/utils.js";

const parserVersion = "attachment-parser-v1";
const limitArg = process.argv.find((value) => value.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 20;
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");

const candidates = await getPool().query<{
  id: number;
  document_id: number;
  title: string;
  url: string;
  file_type: string | null;
}>(
  `SELECT id, document_id, title, url, file_type
   FROM attachments
   WHERE parse_status IN ('pending', 'failed') OR file_hash IS NULL
   ORDER BY created_at DESC
   LIMIT $1`,
  [limit],
);

let parsed = 0;
let reused = 0;
let skipped = 0;
let failed = 0;

for (const attachment of candidates.rows) {
  try {
    const file = await downloadAttachment(attachment.url);
    const fileHash = sha256(file);
    const fileType = attachment.file_type ?? fileTypeFromUrl(attachment.url);
    const storagePath = await saveAttachmentFile(file, fileHash, fileType);
    const cached = await getPool().query<{
      extracted_text: string;
      parse_status: "parsed" | "failed" | "skipped";
      error: string | null;
    }>("SELECT extracted_text, parse_status, error FROM attachment_parse_cache WHERE file_hash=$1", [
      fileHash,
    ]);

    if (cached.rowCount) {
      await applyParsedAttachment(
        attachment,
        fileHash,
        fileType,
        storagePath,
        cached.rows[0].extracted_text,
        cached.rows[0].parse_status,
        cached.rows[0].error,
      );
      reused += 1;
      continue;
    }

    const parseResult = await parseByType(file, fileType);
    await transaction(async (client) => {
      await client.query(
        `INSERT INTO attachment_parse_cache (
           file_hash, file_type, storage_path, extracted_text, parser_version, parse_status, error
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          fileHash, fileType, storagePath, parseResult.text, parserVersion,
          parseResult.status, parseResult.error,
        ],
      );
    });
    await applyParsedAttachment(
      attachment,
      fileHash,
      fileType,
      storagePath,
      parseResult.text,
      parseResult.status,
      parseResult.error,
    );
    if (parseResult.status === "skipped") skipped += 1;
    else parsed += 1;
  } catch (error) {
    failed += 1;
    const message = errorMessage(error);
    await getPool().query(
      `UPDATE attachments SET parse_status='failed', error=$2, parsed_at=now()
       WHERE id=$1`,
      [attachment.id, message],
    );
    console.error(`[attachment failed] ${attachment.url}: ${message}`);
  }
}

console.log(JSON.stringify({ parsed, reused, skipped, failed }, null, 2));
await getPool().end();

/** 下载附件并返回 Buffer；解析脚本只处理公开附件 URL。 */
async function downloadAttachment(url: string): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: "*/*",
          referer: new URL("/", url).toString(),
          "user-agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        console.warn(`[attachment retry ${attempt}/3] ${url}: ${errorMessage(error)}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 2_000));
      }
    }
  }
  throw new Error(`download failed after 3 attempts: ${errorMessage(lastError)}`);
}

async function saveAttachmentFile(file: Buffer, fileHash: string, fileType: string | null): Promise<string> {
  await mkdir("data/attachments", { recursive: true });
  const filename = `${fileHash}${fileType ? `.${fileType}` : ""}`;
  const storagePath = path.join("data/attachments", filename);
  await writeFile(storagePath, file);
  return storagePath;
}

async function parseByType(
  file: Buffer,
  fileType: string | null,
): Promise<{ text: string; status: "parsed" | "skipped"; error: string | null }> {
  if (fileType === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file });
    try {
      return { text: normalizeParsedText((await parser.getText()).text), status: "parsed", error: null };
    } finally {
      await parser.destroy();
    }
  }
  if (fileType === "docx") {
    return {
      text: normalizeParsedText((await mammoth.extractRawText({ buffer: file })).value),
      status: "parsed",
      error: null,
    };
  }
  if (fileType === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);
    const text = workbook.worksheets.map((sheet) => {
      const rows: string[] = [];
      sheet.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values.map((value) => String(value ?? "")).join(","));
      });
      return `# ${sheet.name}\n${rows.join("\n").trim()}`;
    }).join("\n\n").trim();
    return { text, status: "parsed", error: null };
  }
  return {
    text: "",
    status: "skipped",
    error: `unsupported file type: ${fileType ?? "unknown"}`,
  };
}

async function applyParsedAttachment(
  attachment: { id: number; document_id: number; title: string; url: string },
  fileHash: string,
  fileType: string | null,
  storagePath: string,
  extractedText: string,
  status: "parsed" | "failed" | "skipped",
  error: string | null,
) {
  await transaction(async (client) => {
    await client.query(
      `UPDATE attachments SET file_hash=$2, file_type=$3, storage_path=$4,
         extracted_text=$5, parser_version=$6, parse_status=$7, error=$8, parsed_at=now()
       WHERE id=$1`,
      [attachment.id, fileHash, fileType, storagePath, extractedText, parserVersion, status, error],
    );
    if (status === "parsed" && extractedText) {
      const current = await client.query<{ max: number | null }>(
        "SELECT max(sort_order) FROM document_blocks WHERE document_id=$1",
        [attachment.document_id],
      );
      const nextOrder = (current.rows[0].max ?? -1) + 1;
      await client.query(
        `INSERT INTO document_blocks (
           document_id, block_type, sort_order, title, content, asset_url, enabled,
           evidence_enabled, evidence_title, evidence_description, metadata
         ) VALUES ($1,'attachment_text',$2,$3,$4,$5,true,false,$3,'附件解析文本',$6)
         ON CONFLICT (document_id, sort_order) DO NOTHING`,
        [
          attachment.document_id,
          nextOrder,
          attachment.title,
          extractedText,
          attachment.url,
          JSON.stringify({ attachmentId: attachment.id, fileHash, fileType, parserVersion }),
        ],
      );
    }
  });
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function fileTypeFromUrl(value: string): string | null {
  try {
    return new URL(value).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function normalizeParsedText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const messages = [error.message];
  let cause = error.cause;
  while (cause instanceof Error) {
    messages.push(cause.message);
    cause = cause.cause;
  }
  return [...new Set(messages)].join(": ");
}
