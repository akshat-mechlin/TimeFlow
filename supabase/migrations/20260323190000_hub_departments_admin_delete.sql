-- Allow admins to delete hub departments (cascades to members, templates, updates per FKs).
create policy hub_departments_delete on public.hub_departments
  for delete using (public.hub_is_admin(auth.uid()));
