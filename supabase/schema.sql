-- Mangara — complete schema (Milestones 1–3)
-- Run in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
-- Fully idempotent: safe to run as many times as you like.
--
-- NOTE: this script never uses `drop function`. Dropping a function that a
-- policy depends on fails with "cannot drop function ... because other objects
-- depend on it", so every function here uses `create or replace` instead.

-- ---------------------------------------------------------------- tables ----

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

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  order_index int not null,
  created_at timestamptz default now()
);

create table if not exists pages (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid references chapters(id) on delete cascade,
  order_index int not null,
  width int default 2048,
  height int default 2896,
  created_at timestamptz default now()
);

-- A "panel" is any layer on the page: an art panel, a text box, a speech
-- bubble, an SFX letter, or a plain shape. `kind` discriminates them and
-- `z_index` orders them for the Layers panel.
create table if not exists panels (
  id uuid primary key default gen_random_uuid(),
  page_id uuid references pages(id) on delete cascade,
  kind text check (kind in ('panel','text','bubble','sfx','shape')) default 'panel',
  geometry jsonb not null,              -- {x, y, w, h, rotation, shape}
  style jsonb default '{}'::jsonb,      -- {fill, stroke, strokeWidth, rx, fontSize, ...}
  content text,                         -- text body for text/bubble/sfx layers
  z_index int default 0,
  image_url text,
  mask_id uuid,
  prompt text,
  generation_status text check (generation_status in ('idle','queued','generating','complete','failed')) default 'idle',
  review_status text check (review_status in ('pending','approved','needs_changes','send_back')) default 'pending',
  last_provider text,                   -- surfaced as a badge when a fallback provider was used
  version int default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid references panels(id) on delete cascade,
  spec jsonb not null,
  status text check (status in ('queued','generating','complete','failed')) default 'queued',
  provider text,
  model text,
  image_url text,
  generation_time_ms int,
  error text,
  created_at timestamptz default now()
);

create table if not exists generation_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  created_at timestamptz default now()
);

create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid references panels(id) on delete cascade,
  author_id uuid references auth.users(id),
  position jsonb,
  body text not null,
  status text check (status in ('open','resolved')) default 'open',
  created_at timestamptz default now()
);

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  role text,
  notes text,
  consistency_lock jsonb default '{}'::jsonb
);

create table if not exists character_references (
  id uuid primary key default gen_random_uuid(),
  character_id uuid references characters(id) on delete cascade,
  image_url text not null,
  kind text
);

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  type text check (type in ('image','sketch','3d','video','audio')) not null,
  url text not null,
  tags text[],
  category text,
  created_at timestamptz default now()
);

create index if not exists panels_page_id_idx on panels(page_id);
create index if not exists pages_chapter_id_idx on pages(chapter_id);
create index if not exists chapters_project_id_idx on chapters(project_id);
create index if not exists generations_panel_id_idx on generations(panel_id);

-- ------------------------------------------------------------- functions ----

-- Membership check. A policy on `collaborators` cannot subquery
-- `collaborators` directly: Postgres would evaluate that subquery under the
-- same policy and recurse forever. SECURITY DEFINER runs it as the owner,
-- bypassing RLS for this one lookup, which breaks the loop.
create or replace function is_project_collaborator(pid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from collaborators
    where project_id = pid and user_id = auth.uid()
  );
$$;

-- Ownership chain helpers, so child tables can authorize off their parent.
create or replace function can_access_project(pid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from projects p
    where p.id = pid
      and (p.owner_id = auth.uid()
           or exists (select 1 from collaborators c
                      where c.project_id = p.id and c.user_id = auth.uid()))
  );
$$;

create or replace function can_access_chapter(cid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from chapters c where c.id = cid and can_access_project(c.project_id)
  );
$$;

create or replace function can_access_page(pgid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from pages pg where pg.id = pgid and can_access_chapter(pg.chapter_id)
  );
$$;

create or replace function can_access_panel(pnid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from panels pn where pn.id = pnid and can_access_page(pn.page_id)
  );
$$;

-- Bootstrap in ONE transaction. Doing this as two client-side inserts is
-- broken twice over: PostgREST's INSERT..RETURNING is checked against the
-- SELECT policy (which fails before the collaborator row exists), and a
-- failure between the two inserts would orphan a project the user can
-- neither see nor recreate. A SECURITY DEFINER function avoids both.
create or replace function get_or_create_default_project()
returns projects
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  proj projects;
  ch chapters;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select * into proj from projects
    where owner_id = uid order by created_at limit 1;
  if found then
    return proj;
  end if;

  insert into projects (name, owner_id) values ('My Manga', uid)
    returning * into proj;
  insert into collaborators (project_id, user_id, role)
    values (proj.id, uid, 'owner');
  insert into chapters (project_id, title, order_index)
    values (proj.id, 'Chapter 1', 1) returning * into ch;
  insert into pages (chapter_id, order_index) values (ch.id, 1);

  return proj;
end;
$$;

-- ------------------------------------------------------------------ RLS ----

alter table projects              enable row level security;
alter table collaborators         enable row level security;
alter table chapters              enable row level security;
alter table pages                 enable row level security;
alter table panels                enable row level security;
alter table generations           enable row level security;
alter table generation_log        enable row level security;
alter table notes                 enable row level security;
alter table characters            enable row level security;
alter table character_references  enable row level security;
alter table assets                enable row level security;

grant select, insert, update, delete on projects, collaborators, chapters,
  pages, panels, generations, generation_log, notes, characters,
  character_references, assets to authenticated;
grant execute on function get_or_create_default_project() to authenticated;

drop policy if exists "projects: select" on projects;
create policy "projects: select" on projects for select
  using (owner_id = auth.uid() or is_project_collaborator(id));

drop policy if exists "projects: insert" on projects;
create policy "projects: insert" on projects for insert
  with check (owner_id = auth.uid());

drop policy if exists "projects: update" on projects;
create policy "projects: update" on projects for update
  using (owner_id = auth.uid());

drop policy if exists "collaborators: select" on collaborators;
create policy "collaborators: select" on collaborators for select
  using (user_id = auth.uid() or is_project_collaborator(project_id));

drop policy if exists "collaborators: insert self" on collaborators;
create policy "collaborators: insert self" on collaborators for insert
  with check (user_id = auth.uid());

drop policy if exists "chapters: all" on chapters;
create policy "chapters: all" on chapters for all
  using (can_access_project(project_id))
  with check (can_access_project(project_id));

drop policy if exists "pages: all" on pages;
create policy "pages: all" on pages for all
  using (can_access_chapter(chapter_id))
  with check (can_access_chapter(chapter_id));

drop policy if exists "panels: all" on panels;
create policy "panels: all" on panels for all
  using (can_access_page(page_id))
  with check (can_access_page(page_id));

drop policy if exists "generations: all" on generations;
create policy "generations: all" on generations for all
  using (can_access_panel(panel_id))
  with check (can_access_panel(panel_id));

drop policy if exists "generation_log: select" on generation_log;
create policy "generation_log: select" on generation_log for select
  using (auth.uid() is not null);

drop policy if exists "notes: all" on notes;
create policy "notes: all" on notes for all
  using (can_access_panel(panel_id))
  with check (can_access_panel(panel_id));

drop policy if exists "characters: all" on characters;
create policy "characters: all" on characters for all
  using (can_access_project(project_id))
  with check (can_access_project(project_id));

drop policy if exists "character_references: all" on character_references;
create policy "character_references: all" on character_references for all
  using (exists (select 1 from characters c
                 where c.id = character_id and can_access_project(c.project_id)))
  with check (exists (select 1 from characters c
                      where c.id = character_id and can_access_project(c.project_id)));

drop policy if exists "assets: all" on assets;
create policy "assets: all" on assets for all
  using (can_access_project(project_id))
  with check (can_access_project(project_id));

-- -------------------------------------------------------------- storage ----

insert into storage.buckets (id, name, public)
values ('panels', 'panels', true)
on conflict (id) do nothing;

drop policy if exists "panels bucket: read" on storage.objects;
create policy "panels bucket: read" on storage.objects for select
  using (bucket_id = 'panels');

drop policy if exists "panels bucket: write" on storage.objects;
create policy "panels bucket: write" on storage.objects for insert
  with check (bucket_id = 'panels' and auth.uid() is not null);
