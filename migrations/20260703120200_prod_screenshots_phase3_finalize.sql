-- =============================================================================
-- PROD PHASE 3 — run ONLY after backfill is 100% complete
-- =============================================================================
-- Prerequisites (all must pass):
--   SELECT count(*) FROM public.screenshots WHERE user_id IS NULL;  → 0
--
-- Orphan check (time_entry missing):
--   SELECT count(*) FROM public.screenshots s
--   LEFT JOIN public.time_entries te ON te.id = s.time_entry_id
--   WHERE te.id IS NULL;
--   → must be 0, or fix orphans before SET NOT NULL
-- =============================================================================

-- Lock in user_id
ALTER TABLE public.screenshots
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE public.screenshots
  DROP CONSTRAINT IF EXISTS screenshots_user_id_fkey;

ALTER TABLE public.screenshots
  ADD CONSTRAINT screenshots_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- -----------------------------------------------------------------------------
-- Replace RLS policies: use user_id directly (avoids time_entries subquery per row)
-- Existing prod policies all do: EXISTS (SELECT 1 FROM time_entries te WHERE ...)
-- which is extremely slow on 1.3M rows.
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS "Users can view their own screenshots" ON public.screenshots;
CREATE POLICY "Users can view their own screenshots" ON public.screenshots
  FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all screenshots" ON public.screenshots;
CREATE POLICY "Admins can view all screenshots" ON public.screenshots
  FOR SELECT
  USING (is_admin(auth.uid()) OR user_id = auth.uid());

DROP POLICY IF EXISTS "Managers can view team screenshots" ON public.screenshots;
CREATE POLICY "Managers can view team screenshots" ON public.screenshots
  FOR SELECT
  USING (
    is_manager(auth.uid())
    AND (user_id = auth.uid() OR manages_employee(auth.uid(), user_id))
  );

DROP POLICY IF EXISTS "Managers can view their team's screenshots" ON public.screenshots;
CREATE POLICY "Managers can view their team's screenshots" ON public.screenshots
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles AS p
      WHERE p.id = screenshots.user_id
        AND (is_manager_of_employee(auth.uid(), p.id) OR p.manager_id = auth.uid())
    )
  );

-- "Admin full access to screenshots table" (command *) — left unchanged

-- -----------------------------------------------------------------------------
-- Fast RPC for Screenshots page (index scan → ~500 rows → small joins)
-- Prod type values: screenshot(796k), camera(402k), desktop(72k), webcam(25k), automatic(118)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_screenshots_for_user_day(
  p_user_id uuid,
  p_day_start timestamptz,
  p_day_end timestamptz,
  p_type_filter text DEFAULT 'all',
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id uuid,
  storage_path text,
  taken_at timestamptz,
  time_entry_id uuid,
  type text,
  created_at timestamptz,
  user_id uuid,
  time_entry_description text,
  profile_id uuid,
  profile_full_name text
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $$
  SELECT
    s.id,
    s.storage_path,
    s.taken_at,
    s.time_entry_id,
    s.type,
    s.created_at,
    s.user_id,
    te.description AS time_entry_description,
    p.id AS profile_id,
    p.full_name AS profile_full_name
  FROM public.screenshots AS s
  INNER JOIN public.time_entries AS te ON te.id = s.time_entry_id
  INNER JOIN public.profiles AS p ON p.id = s.user_id
  WHERE s.user_id = p_user_id
    AND s.taken_at >= p_day_start
    AND s.taken_at <= p_day_end
    AND (
      p_type_filter IS NULL
      OR p_type_filter = 'all'
      OR (p_type_filter = 'camera' AND s.type IN ('camera', 'webcam'))
      OR (p_type_filter = 'screenshot' AND s.type IN ('screen', 'screenshot', 'desktop', 'automatic'))
      OR s.type = p_type_filter
    )
  ORDER BY s.taken_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 500);
$$;

GRANT EXECUTE ON FUNCTION public.get_screenshots_for_user_day(uuid, timestamptz, timestamptz, text, integer)
  TO authenticated, anon, service_role;

ANALYZE public.screenshots;
ANALYZE public.time_entries;
ANALYZE public.profiles;
