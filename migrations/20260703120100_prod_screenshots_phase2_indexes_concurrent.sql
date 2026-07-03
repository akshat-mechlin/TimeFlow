-- =============================================================================
-- PROD PHASE 2 — run in Supabase SQL Editor, ONE statement at a time
-- =============================================================================
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Run each statement below separately and wait for completion.
--
-- Order matters:
--   1) time_entry_id index speeds up backfill JOIN
--   2) user_id composite indexes speed up Screenshots page queries
-- =============================================================================

-- Helps backfill: UPDATE ... FROM time_entries WHERE s.time_entry_id = te.id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_time_entry_id
  ON public.screenshots (time_entry_id);

-- Primary query path after backfill: WHERE user_id = ? AND taken_at BETWEEN ...
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_user_id_taken_at
  ON public.screenshots (user_id, taken_at DESC);

-- Type filter on Screenshots page (screenshot / camera tabs)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_user_id_type_taken_at
  ON public.screenshots (user_id, type, taken_at DESC);

-- Optional: date-range scans without user filter (admin reports)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_screenshots_taken_at_desc
  ON public.screenshots (taken_at DESC);

-- Enrichment queries from the website (activity_logs batch fetch)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_screenshot_id
  ON public.activity_logs (screenshot_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_time_entries_time_entry_id
  ON public.project_time_entries (time_entry_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_time_entries_user_id_start_time
  ON public.time_entries (user_id, start_time DESC);

ANALYZE public.screenshots;
ANALYZE public.time_entries;
ANALYZE public.activity_logs;
