-- Soft-delete users immediately; purge heavy related rows in short batches.
-- Avoids statement timeout / Auth 504 on admin delete for high-volume users.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.user_deletion_jobs (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  screenshots_deleted bigint NOT NULL DEFAULT 0,
  time_entries_deleted bigint NOT NULL DEFAULT 0
);

ALTER TABLE public.user_deletion_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.user_deletion_jobs FROM PUBLIC;
REVOKE ALL ON public.user_deletion_jobs FROM anon, authenticated;
GRANT ALL ON public.user_deletion_jobs TO service_role;

CREATE OR REPLACE FUNCTION public.admin_soft_delete_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  -- Minimal sync work: hide user + free email. FK cleanup runs in purge.
  UPDATE public.profiles
  SET
    deleted_at = coalesce(deleted_at, now()),
    full_name = 'Deleted User',
    email = 'deleted+' || id::text || '@deleted.local',
    updated_at = now()
  WHERE id = p_user_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
      RETURN jsonb_build_object('ok', true, 'user_id', p_user_id, 'already', true);
    END IF;
    RAISE EXCEPTION 'User profile not found';
  END IF;

  INSERT INTO public.user_deletion_jobs (user_id, status, requested_at)
  VALUES (p_user_id, 'pending', now())
  ON CONFLICT (user_id) DO UPDATE
    SET status = 'pending',
        requested_at = now(),
        error = NULL,
        finished_at = NULL;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_purge_user_data_batch(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch bigint := 0;
  v_time_entries bigint := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  PERFORM set_config('statement_timeout', '60s', true);

  UPDATE public.user_deletion_jobs
  SET status = 'running',
      started_at = coalesce(started_at, now()),
      error = NULL
  WHERE user_id = p_user_id;

  UPDATE public.profiles SET manager_id = NULL WHERE manager_id = p_user_id;
  UPDATE public.projects SET created_by = NULL WHERE created_by = p_user_id;

  DELETE FROM public.screenshots
  WHERE id IN (
    SELECT id FROM public.screenshots
    WHERE user_id = p_user_id
    LIMIT 1500
  );
  GET DIAGNOSTICS v_batch = ROW_COUNT;

  IF v_batch > 0 THEN
    UPDATE public.user_deletion_jobs
    SET screenshots_deleted = screenshots_deleted + v_batch
    WHERE user_id = p_user_id;

    RETURN jsonb_build_object(
      'ok', true,
      'done', false,
      'screenshots_batch', v_batch
    );
  END IF;

  DELETE FROM public.screenshot_activity WHERE user_id = p_user_id;

  DELETE FROM public.project_time_entries
  WHERE time_entry_id IN (SELECT id FROM public.time_entries WHERE user_id = p_user_id);

  DELETE FROM public.time_entries WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_time_entries = ROW_COUNT;

  DELETE FROM public.notifications WHERE user_id = p_user_id;
  DELETE FROM public.user_logs WHERE user_id = p_user_id;
  DELETE FROM public.attendance WHERE user_id = p_user_id;
  DELETE FROM public.user_version_tracking WHERE user_id = p_user_id;
  DELETE FROM public.employee_managers
  WHERE employee_id = p_user_id OR manager_id = p_user_id;
  DELETE FROM public.project_members WHERE user_id = p_user_id;
  DELETE FROM public.group_members WHERE user_id = p_user_id;
  DELETE FROM public.leave_approvers WHERE approver_id = p_user_id;
  DELETE FROM public.leave_requests WHERE user_id = p_user_id;
  DELETE FROM public.hub_department_members WHERE user_id = p_user_id;
  DELETE FROM public.hub_team_update_comments WHERE user_id = p_user_id;
  DELETE FROM public.hub_team_updates WHERE user_id = p_user_id;

  UPDATE public.user_deletion_jobs
  SET status = 'purged',
      time_entries_deleted = v_time_entries,
      finished_at = now()
  WHERE user_id = p_user_id;

  DELETE FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'done', true,
    'time_entries_deleted', v_time_entries
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_loops int := 0;
  v_screenshots bigint := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  PERFORM set_config('statement_timeout', '600s', true);

  LOOP
    v_loops := v_loops + 1;
    EXIT WHEN v_loops > 500;
    v_result := public.admin_purge_user_data_batch(p_user_id);
    v_screenshots := v_screenshots + coalesce((v_result->>'screenshots_batch')::bigint, 0);
    EXIT WHEN coalesce((v_result->>'done')::boolean, false);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'done', true,
    'screenshots_deleted', v_screenshots,
    'batches', v_loops
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_soft_delete_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_soft_delete_user(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_soft_delete_user(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_purge_user_data_batch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_user_data_batch(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data_batch(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO service_role;
