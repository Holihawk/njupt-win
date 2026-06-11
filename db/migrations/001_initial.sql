CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  name text NOT NULL,
  base_url text NOT NULL,
  list_url text,
  source_type text NOT NULL DEFAULT 'notice'
    CHECK (source_type IN ('notice', 'content', 'service')),
  parser_type text NOT NULL DEFAULT 'webplus',
  official_weight numeric(4, 2) NOT NULL DEFAULT 1.00,
  auto_crawl boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id bigserial PRIMARY KEY,
  source_id text REFERENCES sources(id) ON DELETE SET NULL,
  source_name text NOT NULL,
  title text NOT NULL,
  url text NOT NULL UNIQUE,
  published_at date,
  author text,
  content text NOT NULL DEFAULT '',
  content_html text,
  document_type text NOT NULL DEFAULT 'notice'
    CHECK (document_type IN ('notice', 'guide', 'faq', 'news', 'manual')),
  ingestion_type text NOT NULL DEFAULT 'crawler'
    CHECK (ingestion_type IN ('crawler', 'manual', 'import')),
  item_type text NOT NULL DEFAULT 'page'
    CHECK (item_type IN ('page', 'attachment')),
  content_hash text NOT NULL,
  fetched_at timestamptz,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'failed')),
  error text,
  pinned boolean NOT NULL DEFAULT false,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_status_published_idx
  ON documents (status, published_at DESC);
CREATE INDEX IF NOT EXISTS documents_source_idx ON documents (source_id);
CREATE INDEX IF NOT EXISTS documents_title_trgm_idx
  ON documents USING gin (title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS attachments (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  file_type text,
  file_hash text,
  storage_path text,
  parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'failed', 'skipped')),
  parser_version text,
  extracted_text text,
  parsed_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, url)
);

CREATE TABLE IF NOT EXISTS document_summaries (
  document_id bigint PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  document_hash text NOT NULL,
  summary text NOT NULL,
  category text NOT NULL,
  audience text[] NOT NULL DEFAULT '{}',
  importance smallint NOT NULL DEFAULT 3 CHECK (importance BETWEEN 0 AND 5),
  deadline date,
  keywords text[] NOT NULL DEFAULT '{}',
  provider text NOT NULL CHECK (provider IN ('local', 'llm')),
  generated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  attachment_id bigint REFERENCES attachments(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector,
  embedding_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, attachment_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS crawl_runs (
  id bigserial PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  report jsonb,
  error text
);
