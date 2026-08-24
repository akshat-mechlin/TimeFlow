-- Allow users to manage project_time_entries for their own time entries
DROP POLICY IF EXISTS "Users can manage own project time entries" ON public.project_time_entries;
CREATE POLICY "Users can manage own project time entries"
  ON public.project_time_entries
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.time_entries te
      WHERE te.id = project_time_entries.time_entry_id
        AND te.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.time_entries te
      WHERE te.id = project_time_entries.time_entry_id
        AND te.user_id = auth.uid()
    )
  );
