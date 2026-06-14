-- 旧版本曾直接保存匿名 sessionId。升级后清空非 SHA-256 摘要值，避免数据库泄露时被复用。
UPDATE rag_question_history
SET session_id = NULL
WHERE session_id IS NOT NULL
  AND session_id !~ '^[0-9a-f]{64}$';
