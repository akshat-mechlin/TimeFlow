-- Team Communication Hub (applied remotely as 20260323180708_team_communication_hub).
-- Departments, templates, updates, comments, integration stubs, RLS.

create extension if not exists "pgcrypto";

do $$ begin
  create type public.hub_template_type as enum ('daily', 'weekly', 'sprint', 'custom');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.hub_update_status as enum ('draft', 'published', 'archived');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.hub_departments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  created_at timestamptz default now()
);

create table if not exists public.hub_department_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.hub_departments (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'manager')),
  created_at timestamptz default now(),
  unique (user_id, department_id)
);

create index if not exists hub_department_members_user_id_idx on public.hub_department_members (user_id);
create index if not exists hub_department_members_dept_id_idx on public.hub_department_members (department_id);

create table if not exists public.hub_update_templates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.hub_departments (id) on delete cascade,
  name text not null,
  template_type public.hub_template_type not null default 'daily',
  body text not null,
  is_system boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists hub_update_templates_dept_idx on public.hub_update_templates (department_id);

create table if not exists public.hub_team_updates (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.hub_departments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  template_id uuid references public.hub_update_templates (id) on delete set null,
  project_id uuid references public.projects (id) on delete set null,
  title text,
  body text not null,
  tags text[] not null default '{}',
  status public.hub_update_status not null default 'published',
  external_source text,
  external_thread_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists hub_team_updates_dept_created_idx on public.hub_team_updates (department_id, created_at desc);
create index if not exists hub_team_updates_user_idx on public.hub_team_updates (user_id);

create table if not exists public.hub_team_update_comments (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.hub_team_updates (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists hub_team_update_comments_update_idx on public.hub_team_update_comments (update_id);

create table if not exists public.hub_integration_connections (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.hub_departments (id) on delete cascade,
  provider text not null check (provider in ('teams', 'slack', 'email', 'jira', 'trello')),
  display_name text,
  status text not null default 'disconnected',
  config jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.hub_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

insert into public.hub_departments (name, code)
values ('General', 'general')
on conflict (code) do nothing;

insert into public.hub_update_templates (department_id, name, template_type, body, is_system)
select d.id,
  'Daily EOD Update',
  'daily',
  E'Daily EOD Update — {Day}, {Date}\n\nPlease post your daily updates under the comment section of this post:\n\nToday, I...\n• \n• \n\nTomorrow, I plan on...\n• \n• \n\nI need help with...\n• \n• ',
  true
from public.hub_departments d
where d.code = 'general'
  and not exists (
    select 1 from public.hub_update_templates t
    where t.is_system = true and t.template_type = 'daily' and t.department_id = d.id
  );

create or replace function public.hub_ensure_department_membership()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  gid uuid;
begin
  if exists (select 1 from public.hub_department_members where user_id = auth.uid()) then
    return;
  end if;
  select id into gid from public.hub_departments where code = 'general' limit 1;
  if gid is null then
    select id into gid from public.hub_departments order by created_at limit 1;
  end if;
  if gid is not null then
    insert into public.hub_department_members (user_id, department_id, role)
    values (auth.uid(), gid, 'member')
    on conflict (user_id, department_id) do nothing;
  end if;
end;
$$;

grant execute on function public.hub_ensure_department_membership() to authenticated;

alter table public.hub_departments enable row level security;
alter table public.hub_department_members enable row level security;
alter table public.hub_update_templates enable row level security;
alter table public.hub_team_updates enable row level security;
alter table public.hub_team_update_comments enable row level security;
alter table public.hub_integration_connections enable row level security;
alter table public.hub_audit_events enable row level security;

create or replace function public.hub_is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = uid and p.role = 'admin');
$$;

create or replace function public.hub_user_department_ids(uid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(department_id), '{}')
  from public.hub_department_members
  where user_id = uid;
$$;

create policy hub_departments_select on public.hub_departments
  for select using (
    public.hub_is_admin(auth.uid())
    or id = any (public.hub_user_department_ids(auth.uid()))
  );

create policy hub_departments_insert on public.hub_departments
  for insert with check (public.hub_is_admin(auth.uid()));

create policy hub_departments_update on public.hub_departments
  for update using (public.hub_is_admin(auth.uid()));

create policy hub_department_members_select on public.hub_department_members
  for select using (
    public.hub_is_admin(auth.uid())
    or user_id = auth.uid()
    or department_id = any (public.hub_user_department_ids(auth.uid()))
  );

create policy hub_department_members_insert on public.hub_department_members
  for insert with check (public.hub_is_admin(auth.uid()));

create policy hub_department_members_update on public.hub_department_members
  for update using (public.hub_is_admin(auth.uid()));

create policy hub_department_members_delete on public.hub_department_members
  for delete using (public.hub_is_admin(auth.uid()));

create policy hub_templates_select on public.hub_update_templates
  for select using (
    public.hub_is_admin(auth.uid())
    or department_id is null
    or department_id = any (public.hub_user_department_ids(auth.uid()))
  );

create policy hub_templates_insert on public.hub_update_templates
  for insert with check (
    public.hub_is_admin(auth.uid())
    or (
      department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (
        select 1 from public.hub_department_members m
        where m.user_id = auth.uid() and m.department_id = department_id and m.role = 'manager'
      )
    )
  );

create policy hub_templates_update on public.hub_update_templates
  for update using (
    public.hub_is_admin(auth.uid())
    or (
      department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (
        select 1 from public.hub_department_members m
        where m.user_id = auth.uid() and m.department_id = department_id and m.role = 'manager'
      )
    )
  );

create policy hub_templates_delete on public.hub_update_templates
  for delete using (
    public.hub_is_admin(auth.uid())
    or (
      not is_system
      and department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (
        select 1 from public.hub_department_members m
        where m.user_id = auth.uid() and m.department_id = department_id and m.role = 'manager'
      )
    )
  );

create policy hub_updates_select on public.hub_team_updates
  for select using (
    public.hub_is_admin(auth.uid())
    or department_id = any (public.hub_user_department_ids(auth.uid()))
  );

create policy hub_updates_insert on public.hub_team_updates
  for insert with check (
    user_id = auth.uid()
    and department_id = any (public.hub_user_department_ids(auth.uid()))
  );

create policy hub_updates_update on public.hub_team_updates
  for update using (
    public.hub_is_admin(auth.uid())
    or (
      user_id = auth.uid()
      and department_id = any (public.hub_user_department_ids(auth.uid()))
    )
    or (
      department_id = any (public.hub_user_department_ids(auth.uid()))
      and exists (
        select 1 from public.hub_department_members m
        where m.user_id = auth.uid() and m.department_id = hub_team_updates.department_id and m.role = 'manager'
      )
    )
  );

create policy hub_updates_delete on public.hub_team_updates
  for delete using (
    public.hub_is_admin(auth.uid())
    or user_id = auth.uid()
  );

create policy hub_comments_select on public.hub_team_update_comments
  for select using (
    exists (
      select 1 from public.hub_team_updates u
      where u.id = update_id
        and (
          public.hub_is_admin(auth.uid())
          or u.department_id = any (public.hub_user_department_ids(auth.uid()))
        )
    )
  );

create policy hub_comments_insert on public.hub_team_update_comments
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.hub_team_updates u
      where u.id = update_id
        and u.department_id = any (public.hub_user_department_ids(auth.uid()))
    )
  );

create policy hub_comments_update on public.hub_team_update_comments
  for update using (user_id = auth.uid() or public.hub_is_admin(auth.uid()));

create policy hub_comments_delete on public.hub_team_update_comments
  for delete using (user_id = auth.uid() or public.hub_is_admin(auth.uid()));

create policy hub_integrations_select on public.hub_integration_connections
  for select using (
    public.hub_is_admin(auth.uid())
    or (
      department_id is not null
      and department_id = any (public.hub_user_department_ids(auth.uid()))
    )
  );

create policy hub_integrations_all on public.hub_integration_connections
  for all using (public.hub_is_admin(auth.uid()))
  with check (public.hub_is_admin(auth.uid()));

create policy hub_audit_select on public.hub_audit_events
  for select using (public.hub_is_admin(auth.uid()));

create policy hub_audit_insert on public.hub_audit_events
  for insert with check (public.hub_is_admin(auth.uid()));
