-- Allow HR to manage hub templates and updates (same as manager), aligned with Team Members visibility.
drop policy if exists hub_templates_insert on public.hub_update_templates;
create policy hub_templates_insert on public.hub_update_templates
  for insert with check (
    public.hub_is_admin(auth.uid())
    or (
      department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager', 'hr'))
    )
  );

drop policy if exists hub_templates_update on public.hub_update_templates;
create policy hub_templates_update on public.hub_update_templates
  for update using (
    public.hub_is_admin(auth.uid())
    or (
      department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager', 'hr'))
    )
  );

drop policy if exists hub_templates_delete on public.hub_update_templates;
create policy hub_templates_delete on public.hub_update_templates
  for delete using (
    public.hub_is_admin(auth.uid())
    or (
      not is_system
      and department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager', 'hr'))
    )
  );

drop policy if exists hub_updates_update on public.hub_team_updates;
create policy hub_updates_update on public.hub_team_updates
  for update using (
    public.hub_is_admin(auth.uid())
    or (
      user_id = auth.uid()
      and department_id = any (public.hub_user_department_ids(auth.uid()))
    )
    or (
      department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('manager', 'hr'))
    )
  );
