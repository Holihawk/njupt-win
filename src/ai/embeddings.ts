import { getPool } from "../database/db";
import { apiEndpoints, hasApiPool, withApiFailover } from "./api-pool";

export const expectedEmbeddingDimensions = 2560;

export function hasEmbeddingConfig(): boolean {
  return hasApiPool("EMBEDDING");
}

export function embeddingModel(): string {
  const models = [...new Set(apiEndpoints("EMBEDDING").map((endpoint) => endpoint.model))];
  if (models.length === 0) throw new Error("EMBEDDING API pool is not configured");
  if (models.length > 1) throw new Error("all embedding endpoints must use the same model");
  return models[0];
}

/** 调用 OpenAI-compatible embeddings 接口，返回与输入一一对应的向量。 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  return withApiFailover("EMBEDDING", async (endpoint) => {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${endpoint.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: endpoint.model, input: texts }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { data?: { embedding?: number[]; index?: number }[] };
    const data = payload.data ?? [];
    const vectors = data
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item) => {
        if (!Array.isArray(item.embedding)) throw new Error("response is invalid");
        return item.embedding;
      });
    if (vectors.length !== texts.length) throw new Error("response count does not match input");
    const invalid = vectors.find((vector) => vector.length !== expectedEmbeddingDimensions);
    if (invalid) {
      throw new Error(`embedding dimensions ${invalid.length} do not match expected ${expectedEmbeddingDimensions}`);
    }
    return vectors;
  });
}

export async function embedPendingChunks(limit = 100, batchSize = 16) {
  const model = embeddingModel();
  const rows = await getPool().query<{ id: number; content: string }>(
    `SELECT id, content FROM document_chunks
     WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1
     ORDER BY updated_at DESC LIMIT $2`,
    [model, limit],
  );
  let updated = 0;
  for (let index = 0; index < rows.rows.length; index += batchSize) {
    const batch = rows.rows.slice(index, index + batchSize);
    const vectors = await embedTexts(batch.map((row) => row.content));
    for (const [itemIndex, row] of batch.entries()) {
      await getPool().query(
        "UPDATE document_chunks SET embedding=$2::vector, embedding_model=$3 WHERE id=$1",
        [row.id, vectorLiteral(vectors[itemIndex]), model],
      );
      updated += 1;
    }
  }
  return { selected: rows.rowCount, updated, model };
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
