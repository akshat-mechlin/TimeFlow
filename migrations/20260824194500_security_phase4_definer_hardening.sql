-- Phase 4: DEFINER search_path hardening + revoke anon execute (M-07)
ALTER FUNCTION public.is_admin(uuid) SET search_path = public;
ALTER FUNCTION public.is_manager(uuid) SET search_path = public;
ALTER FUNCTION public.is_manager_of_employee(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.manages_employee(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.get_employee_managers(uuid) SET search_path = public;
ALTER FUNCTION public.format_seconds_for_log(integer) SET search_path = public;
ALTER FUNCTION public.hub_is_admin(uuid) SET search_path = public;
ALTER FUNCTION public.hub_user_department_ids(uuid) SET search_path = public;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.is_manager_of_employee(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.manages_employee(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_employee_managers(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_supabase_api_logs(integer, integer, text, text, uuid, text, timestamptz, timestamptz, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.get_tracker_crud_logs(integer, integer, text, text, uuid, text, timestamptz, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.hub_is_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.hub_user_department_ids(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.hub_ensure_department_membership() FROM anon;
REVOKE ALL ON FUNCTION public.log_tracker_resource_audit() FROM anon;
REVOKE ALL ON FUNCTION public.sync_screenshot_user_id() FROM anon;

GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of_employee(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.manages_employee(uuid, uuid) TO authenticated, service_role;
