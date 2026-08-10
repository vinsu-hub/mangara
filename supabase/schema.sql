-- Mangara — Milestone 1 schema: projects + collaborators
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Users are handled by Supabase Auth (auth.users) — no custom users table needed.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references auth.users(id) not null,
  created_at timestamptz default now()
);

create table if not exists collaborators (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references auth.users(id),
  role text check (role in ('owner', 'editor', 'reviewer')) default 'editor',
  primary key (project_id, user_id)
);

alter table projects enable row level security;
alter table collaborators enable row level security;

-- A policy on `collaborators` can't subquery `collaborators` itself — Postgres
-- evaluates that subquery under the same RLS policy, which recurses forever
-- and errors at runtime ("infinite recursion detected in policy"). Routing
-- the membership check through a SECURITY DEFINER function breaks the loop:
-- the function runs with the privileges of its owner, bypassing RLS just for
-- this one lookup, which is the standard Supabase pattern for membership
-- tables like this.
create or replace function is_project_collaborator(pid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from collaborators
    where project_id = pid and user_id = auth.uid()
  );
$$;

create policy "select own projects" on projects
  for select using (is_project_collaborator(id));

create policy "insert own project" on projects
  for insert with check (owner_id = auth.uid());

create policy "select own collaborator rows" on collaborators
  for select using (is_project_collaborator(project_id));

create policy "owner manages collaborators" on collaborators
  for all using (
    project_id in (select id from projects where owner_id = auth.uid())
  );

create policy "insert self as collaborator" on collaborators
  for insert with check (user_id = auth.uid());
