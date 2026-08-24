-- Fix login failure: 42P17 infinite recursion on profiles RLS
-- Cause: policies subquery public.profiles while FORCE RLS is on.
-- Fix: use SECURITY DEFINER helpers (is_admin / is_manager) instead.

CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = user_id AND role = 'manager'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_manager_of_employee(manager_uuid uuid, employee_uuid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employee_managers em
    WHERE em.manager_id = manager_uuid AND em.employee_id = employee_uuid
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = employee_uuid AND p.manager_id = manager_uuid
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_manager_of_employee(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_manager_of_employee(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Admin full access to profiles" ON public.profiles;
CREATE POLICY "Admin full access to profiles"
  ON public.profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "allow_manager_select" ON public.profiles;
DROP POLICY IF EXISTS "Managers can select profiles" ON public.profiles;
CREATE POLICY "Managers can select profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_manager(auth.uid()));

DROP POLICY IF EXISTS "Managers can view their team's profiles" ON public.profiles;
CREATE POLICY "Managers can view their team's profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_manager(auth.uid())
    AND (
      profiles.id = auth.uid()
      OR profiles.manager_id = auth.uid()
      OR public.is_manager_of_employee(auth.uid(), profiles.id)
    )
  );
