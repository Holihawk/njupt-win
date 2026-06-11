CREATE TABLE IF NOT EXISTS document_blocks (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  block_type text NOT NULL
    CHECK (block_type IN ('heading', 'text', 'table', 'image', 'attachment', 'html', 'manual_note')),
  sort_order integer NOT NULL,
  title text,
  content text NOT NULL DEFAULT '',
  html text,
  asset_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, sort_order)
);

CREATE INDEX IF NOT EXISTS document_blocks_document_idx
  ON document_blocks (document_id, sort_order);
CREATE INDEX IF NOT EXISTS document_blocks_type_idx ON document_blocks (block_type);
CREATE INDEX IF NOT EXISTS document_blocks_content_trgm_idx
  ON document_blocks USING gin (content gin_trgm_ops);
