-- Fix 42P17 recursion between projects <-> project_members policies
-- Use SECURITY DEFINER helpers so policies never subquery each other under RLS.

CREATE OR REPLACE FUNCTION public.is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_creator(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = p_project_id AND p.created_by = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_project_creator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_creator(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Members and elevated roles can view projects" ON public.projects;
CREATE POLICY "Members and elevated roles can view projects"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_manager(auth.uid())
    OR created_by = auth.uid()
    OR public.is_project_member(id, auth.uid())
    OR (project_managers IS NOT NULL AND auth.uid() = ANY (project_managers))
  );

DROP POLICY IF EXISTS "Admins can manage all projects" ON public.projects;
CREATE POLICY "Admins can manage all projects"
  ON public.projects
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can manage their own projects" ON public.projects;
CREATE POLICY "Managers can manage their own projects"
  ON public.projects
  FOR ALL
  TO authenticated
  USING (public.is_manager(auth.uid()) AND created_by = auth.uid())
  WITH CHECK (public.is_manager(auth.uid()) AND created_by = auth.uid());

DROP POLICY IF EXISTS "Admins can manage all project members" ON public.project_members;
CREATE POLICY "Admins can manage all project members"
  ON public.project_members
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can manage members of their projects" ON public.project_members;
CREATE POLICY "Managers can manage members of their projects"
  ON public.project_members
  FOR ALL
  TO authenticated
  USING (
    public.is_manager(auth.uid())
    AND public.is_project_creator(project_id, auth.uid())
  )
  WITH CHECK (
    public.is_manager(auth.uid())
    AND public.is_project_creator(project_id, auth.uid())
  );

DROP POLICY IF EXISTS "Everyone can view project members" ON public.project_members;
DROP POLICY IF EXISTS "Authenticated can view project members" ON public.project_members;
CREATE POLICY "Authenticated can view project members"
  ON public.project_members
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_manager(auth.uid())
    OR user_id = auth.uid()
    OR public.is_project_member(project_id, auth.uid())
    OR public.is_project_creator(project_id, auth.uid())
  );

DROP POLICY IF EXISTS "Admins and managers can create tasks" ON public.tasks;
CREATE POLICY "Admins and managers can create tasks"
  ON public.tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_manager(auth.uid()));

DROP POLICY IF EXISTS "Admins and managers can update tasks" ON public.tasks;
CREATE POLICY "Admins and managers can update tasks"
  ON public.tasks
  FOR UPDATE
  TO authenticated
  USING (public.is_admin(auth.uid()) OR public.is_manager(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()) OR public.is_manager(auth.uid()));
