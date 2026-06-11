ALTER TABLE document_blocks
  ADD COLUMN IF NOT EXISTS evidence_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS evidence_title text,
  ADD COLUMN IF NOT EXISTS evidence_description text;

ALTER TABLE document_blocks DROP CONSTRAINT IF EXISTS document_blocks_block_type_check;
ALTER TABLE document_blocks ADD CONSTRAINT document_blocks_block_type_check
  CHECK (block_type IN (
    'heading', 'text', 'table', 'image', 'attachment', 'attachment_text',
    'html', 'manual_note'
  ));

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS source_block_id bigint REFERENCES document_blocks(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS attachment_parse_cache (
  file_hash text PRIMARY KEY,
  file_type text,
  storage_path text NOT NULL,
  extracted_text text NOT NULL DEFAULT '',
  parser_version text NOT NULL,
  parse_status text NOT NULL DEFAULT 'parsed'
    CHECK (parse_status IN ('parsed', 'failed', 'skipped')),
  error text,
  parsed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachment_parse_cache_type_idx
  ON attachment_parse_cache (file_type);

UPDATE sources SET auto_crawl = true
WHERE id IN ('njupt-main', 'njupt-jwc') AND list_url IS NOT NULL;
