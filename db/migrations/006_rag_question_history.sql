CREATE TABLE IF NOT EXISTS rag_question_history (
  id bigserial PRIMARY KEY,
  question text NOT NULL,
  answer text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'stopped', 'failed')),
  source_count integer NOT NULL DEFAULT 0,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS rag_question_history_created_idx
  ON rag_question_history (created_at DESC);

CREATE INDEX IF NOT EXISTS rag_question_history_status_idx
  ON rag_question_history (status, created_at DESC);
