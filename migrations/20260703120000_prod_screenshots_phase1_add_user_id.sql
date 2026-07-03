-- =============================================================================
-- PROD PHASE 1 — safe to run on ~1.3M rows (no data loss, no bulk UPDATE)
-- =============================================================================
-- Current prod schema (verified):
--   columns: id, time_entry_id, storage_path, taken_at, type, created_at
--   indexes: screenshots_pkey ONLY
--   triggers: none
--   RLS: enabled (policies join time_entries on every row — slow at scale)
--
-- This phase ONLY adds user_id + sync trigger + batched backfill helper.
-- Do NOT run phase 3 until backfill completes (see PROD_DEPLOYMENT.md).
-- =============================================================================

ALTER TABLE public.screenshots
  ADD COLUMN IF NOT EXISTS user_id uuid;

COMMENT ON COLUMN public.screenshots.user_id IS
  'Denormalized owner (mirrors time_entries.user_id). Backfilled in phase 2, kept in sync by trg_sync_screenshot_user_id.';

-- Auto-populate user_id on INSERT / time_entry_id UPDATE (desktop app + manual uploads)
CREATE OR REPLACE FUNCTION public.sync_screenshot_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  SELECT te.user_id
  INTO NEW.user_id
  FROM public.time_entries AS te
  WHERE te.id = NEW.time_entry_id;

  IF NEW.user_id IS NULL THEN
    RAISE EXCEPTION 'Invalid time_entry_id % — no matching time_entries row', NEW.time_entry_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_screenshot_user_id ON public.screenshots;
CREATE TRIGGER trg_sync_screenshot_user_id
  BEFORE INSERT OR UPDATE OF time_entry_id
  ON public.screenshots
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_screenshot_user_id();

-- Batched backfill: call repeatedly in SQL Editor until it returns 0
--   SELECT public.backfill_screenshot_user_id_batch(10000);
CREATE OR REPLACE FUNCTION public.backfill_screenshot_user_id_batch(p_batch_size integer DEFAULT 10000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  updated_count integer;
BEGIN
  WITH batch AS (
    SELECT s.ctid
    FROM public.screenshots AS s
    WHERE s.user_id IS NULL
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.screenshots AS s
  SET user_id = te.user_id
  FROM public.time_entries AS te, batch
  WHERE s.ctid = batch.ctid
    AND te.id = s.time_entry_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_screenshot_user_id_batch(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_screenshot_user_id_batch(integer) TO service_role;

-- Progress check (run anytime):
--   SELECT count(*) AS null_user_id FROM public.screenshots WHERE user_id IS NULL;
