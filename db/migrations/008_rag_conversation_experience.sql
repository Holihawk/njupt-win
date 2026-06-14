ALTER TABLE rag_question_history
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS route_mode text
    CHECK (route_mode IN ('campus_rag', 'general_chat', 'mixed', 'unsafe')),
  ADD COLUMN IF NOT EXISTS mode_preference text NOT NULL DEFAULT 'auto'
    CHECK (mode_preference IN ('auto', 'campus_rag', 'general_chat')),
  ADD COLUMN IF NOT EXISTS feedback text
    CHECK (feedback IN ('helpful', 'unhelpful'));

CREATE INDEX IF NOT EXISTS rag_question_history_session_idx
  ON rag_question_history (session_id, created_at DESC);
