ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS block_id bigint REFERENCES document_blocks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_id text,
  ADD COLUMN IF NOT EXISTS published_at date,
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS block_type text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS url text,
  ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS document_chunks_block_idx ON document_chunks (block_id);
CREATE INDEX IF NOT EXISTS document_chunks_source_idx ON document_chunks (source_id);
CREATE INDEX IF NOT EXISTS document_chunks_published_idx ON document_chunks (published_at DESC);
CREATE INDEX IF NOT EXISTS document_chunks_content_trgm_idx
  ON document_chunks USING gin (content gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS document_chunks_block_chunk_key
  ON document_chunks (document_id, block_id, chunk_index);
