-- Hub access uses profiles.team + profiles.role (no hub_department_members required).

create or replace function public.hub_team_slug(t text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    lower(regexp_replace(btrim(coalesce(t, '')), '[^a-zA-Z0-9]+', '-', 'g')),
    ''
  );
$$;

-- Departments visible to user: admin = all; else match profiles.team to hub_departments.name (case-insensitive) or code = slug(team); empty team -> general
create or replace function public.hub_user_department_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.hub_is_admin(uid) then
      (select coalesce(array_agg(id), '{}'::uuid[]) from public.hub_departments)
    else
      coalesce(
        (
          select array_agg(d.id)
          from public.hub_departments d
          cross join public.profiles p
          where p.id = uid
            and (
              (
                p.team is not null
                and btrim(p.team) <> ''
                and (
                  lower(btrim(d.name)) = lower(btrim(p.team))
                  or d.code = public.hub_team_slug(p.team)
                )
              )
              or (
                (p.team is null or btrim(p.team) = '')
                and d.code = 'general'
              )
            )
        ),
        '{}'::uuid[]
      )
  end;
$$;

-- Ensure hub row for current user's team (no hub_department_members)
create or replace function public.hub_ensure_department_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  slug text;
  gid uuid;
  tmpl_body text;
begin
  select btrim(team) into t from public.profiles where id = auth.uid();
  if t is null or t = '' then
    select id into gid from public.hub_departments where code = 'general' limit 1;
    return;
  end if;
  slug := public.hub_team_slug(t);
  if slug is null then
    slug := 'general';
  end if;
  select id into gid
  from public.hub_departments
  where lower(btrim(name)) = lower(t) or code = slug
  limit 1;
  if gid is null then
    insert into public.hub_departments (name, code)
    values (t, slug)
    returning id into gid;
    tmpl_body := E'Daily EOD Update — {Day}, {Date}\n\nPlease post your daily updates under the comment section of this post:\n\nToday, I...\n• \n• \n\nTomorrow, I plan on...\n• \n• \n\nI need help with...\n• \n• ';
    insert into public.hub_update_templates (department_id, name, template_type, body, is_system)
    values (gid, 'Daily EOD Update', 'daily', tmpl_body, true);
  end if;
end;
$$;

-- Template policies: manager = profiles.role, not hub_department_members
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
