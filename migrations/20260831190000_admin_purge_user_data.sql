-- Admin user delete: purge related rows before auth.admin.deleteUser
-- (Auth API 504 when cascading large screenshot sets).

CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- service_role / no JWT: used by admin Edge Function cleanup
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only administrators can change roles';
    END IF;
    IF NEW.manager_id IS DISTINCT FROM OLD.manager_id THEN
      RAISE EXCEPTION 'Only administrators can change manager assignment';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_purge_user_data(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_screenshots bigint := 0;
  v_time_entries bigint := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required';
  END IF;

  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.profiles SET manager_id = NULL WHERE manager_id = p_user_id;
  UPDATE public.projects SET created_by = NULL WHERE created_by = p_user_id;

  DELETE FROM public.screenshots WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_screenshots = ROW_COUNT;

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

  DELETE FROM public.profiles WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'screenshots_deleted', v_screenshots,
    'time_entries_deleted', v_time_entries
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_purge_user_data(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_user_data(uuid) TO service_role;
