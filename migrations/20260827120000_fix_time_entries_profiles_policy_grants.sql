-- Harden time_entries RLS: replace raw profiles subqueries with SECURITY DEFINER helpers.
-- When JWT is missing/expired, PostgREST falls back to anon (grants revoked after security
-- phase 0). Policies that did `EXISTS (SELECT 1 FROM profiles ...)` then raised:
--   42501 permission denied for table profiles
-- even on time_entries requests — matching desktop midnight sync failures.
-- Also revoke leftover anon grants on screenshots (parity with profiles/time_entries).

CREATE OR REPLACE FUNCTION public.is_hr(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id AND role = 'hr'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_accountant(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id AND role = 'accountant'
  );
$$;

REVOKE ALL ON FUNCTION public.is_hr(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_accountant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_hr(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_accountant(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admin full access to time entries" ON public.time_entries;
CREATE POLICY "Admin full access to time entries"
  ON public.time_entries
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Hr full access to time entries" ON public.time_entries;
CREATE POLICY "Hr full access to time entries"
  ON public.time_entries
  FOR ALL
  TO authenticated
  USING (public.is_hr(auth.uid()))
  WITH CHECK (public.is_hr(auth.uid()));

DROP POLICY IF EXISTS "Accountant have full access of time entries" ON public.time_entries;
CREATE POLICY "Accountant have full access of time entries"
  ON public.time_entries
  FOR ALL
  TO authenticated
  USING (public.is_accountant(auth.uid()))
  WITH CHECK (public.is_accountant(auth.uid()));

DROP POLICY IF EXISTS "Managers can view their team's time entries" ON public.time_entries;
CREATE POLICY "Managers can view their team's time entries"
  ON public.time_entries
  FOR SELECT
  TO authenticated
  USING (
    public.is_manager(auth.uid())
    AND (
      time_entries.user_id = auth.uid()
      OR public.is_manager_of_employee(auth.uid(), time_entries.user_id)
      OR public.manages_employee(auth.uid(), time_entries.user_id)
    )
  );

-- Screenshots still had full anon grants; revoke for parity (RLS alone is not enough).
REVOKE ALL ON TABLE public.screenshots FROM anon;

-- Same for screenshot admin policy that raw-queried profiles
DROP POLICY IF EXISTS "Admin full access to screenshots table" ON public.screenshots;
CREATE POLICY "Admin full access to screenshots table"
  ON public.screenshots
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can view their team's screenshots" ON public.screenshots;
CREATE POLICY "Managers can view their team's screenshots"
  ON public.screenshots
  FOR SELECT
  TO authenticated
  USING (
    public.is_manager(auth.uid())
    AND (
      screenshots.user_id = auth.uid()
      OR public.is_manager_of_employee(auth.uid(), screenshots.user_id)
      OR public.manages_employee(auth.uid(), screenshots.user_id)
    )
  );
