ALTER TABLE document_chunks
  ALTER COLUMN embedding TYPE vector(2560)
  USING embedding::vector(2560);

-- pgvector 的 vector HNSW 索引最多支持 2000 维；Qwen3-Embedding-4B 是 2560 维。
-- 这里保留完整精度 vector(2560) 作为入库数据，同时用 halfvec 表达式索引做近似召回。
CREATE INDEX IF NOT EXISTS document_chunks_embedding_hnsw_idx
  ON document_chunks USING hnsw ((embedding::halfvec(2560)) halfvec_cosine_ops)
  WHERE embedding IS NOT NULL;
