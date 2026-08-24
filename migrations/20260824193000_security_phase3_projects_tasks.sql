-- M-08: Restrict projects visibility; tasks remain authenticated catalog; revoke anon
DROP POLICY IF EXISTS "Everyone can view projects" ON public.projects;
CREATE POLICY "Members and elevated roles can view projects"
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_manager(auth.uid())
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = projects.id AND pm.user_id = auth.uid()
    )
    OR (project_managers IS NOT NULL AND auth.uid() = ANY (project_managers))
  );

DROP POLICY IF EXISTS "Everyone can read tasks" ON public.tasks;
CREATE POLICY "Authenticated users can read tasks"
  ON public.tasks
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.tasks FROM anon;
REVOKE ALL ON TABLE public.projects FROM anon;
