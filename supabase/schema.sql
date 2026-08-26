-- ARK Internal CRM — database schema
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run).

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  category text,
  categories text[] not null default '{}',
  keywords text[] not null default '{}',
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- Safe to re-run: adds the columns to a clients table created before
-- categories/keywords existed, without touching existing rows.
alter table public.clients add column if not exists category text;
alter table public.clients add column if not exists categories text[] not null default '{}';
alter table public.clients add column if not exists keywords text[] not null default '{}';
alter table public.clients add column if not exists logo_url text;

-- One-time backfill: clients used to have a single `category` text field.
-- Copy it into the new `categories` array so nobody's existing category
-- assignment disappears when this upgrade runs. Guarded so it only ever
-- runs once (before any row has multi-category data) — safe to re-run.
do $$
begin
  if not exists (
    select 1 from public.clients where array_length(categories, 1) > 0
  ) then
    update public.clients
    set categories = array[category]
    where category is not null;
  end if;
end $$;

create index if not exists clients_name_idx on public.clients (lower(name));
create index if not exists clients_categories_idx on public.clients using gin (categories);

-- ---------------------------------------------------------------------
-- Categories (a managed, editable list — not a fixed enum. Renaming or
-- deleting a category here cascades to every client using it, from the
-- app layer: see the "Manage categories" actions in the dashboard.)
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  color_index integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- Seeds the original fixed category list once, for brand-new projects.
-- Safe to re-run: a unique constraint on name means this only inserts
-- rows that don't already exist (e.g. because they were renamed).
insert into public.categories (name, color_index)
values
  ('Retail & Hospitality', 0),
  ('Financial Services', 1),
  ('Government & Public Sector', 2),
  ('Healthcare', 3),
  ('Real Estate & Construction', 4),
  ('Technology & Telecom', 5),
  ('Oil & Gas / Energy', 6),
  ('Manufacturing & Industrial', 7),
  ('Other', 2)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------
-- Folders (flat — one level, used to organize a client's documents)
-- ---------------------------------------------------------------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists folders_client_id_idx on public.folders (client_id);

-- Prevents two folders with the same name (case-insensitive) from
-- existing under the same client.
create unique index if not exists folders_unique_name_per_client_idx
  on public.folders (client_id, lower(name));

-- Every new client automatically gets these three folders, so nobody has
-- to remember to create them by hand. Runs as the client row is inserted
-- (any insert path — the app, a future script, etc. — gets this for
-- free). security definer + a pinned search_path is the standard-safe
-- way to write a Postgres trigger function.
create or replace function public.create_default_client_folders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.folders (client_id, name, created_by)
  values
    (new.id, 'Learning & Development', new.created_by),
    (new.id, 'Collaterals', new.created_by),
    (new.id, 'Media (Pictures & Videos)', new.created_by);
  return new;
end;
$$;

drop trigger if exists clients_create_default_folders on public.clients;
create trigger clients_create_default_folders
  after insert on public.clients
  for each row
  execute function public.create_default_client_folders();

-- ---------------------------------------------------------------------
-- Documents (metadata only — the actual file bytes live in Storage)
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  file_name text not null,
  storage_path text not null unique,
  file_type text,
  file_size bigint,
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Safe to re-run: adds folder support to a documents table created
-- before folders existed, without touching existing rows.
alter table public.documents add column if not exists folder_id uuid references public.folders (id) on delete set null;

-- Safe to re-run: adds full-text search support to a documents table
-- created before it existed. content_text holds the plain text pulled out
-- of PDFs/Word/PowerPoint at upload time (see lib/documents); content_tsv
-- is a generated column combining file name + content so search matches
-- either. Legacy .doc/.ppt and images have no extractor, so content_text
-- stays null for them and they remain searchable by file name only.
alter table public.documents add column if not exists content_text text;
alter table public.documents add column if not exists content_indexed_at timestamptz;
alter table public.documents add column if not exists content_tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(file_name, '') || ' ' || coalesce(content_text, ''))
  ) stored;

create index if not exists documents_client_id_idx on public.documents (client_id);
create index if not exists documents_folder_id_idx on public.documents (folder_id);
create index if not exists documents_content_tsv_idx on public.documents using gin (content_tsv);

-- Prevents two documents with the same name (case-insensitive) from
-- existing in the same folder for the same client. coalesce()'s the
-- folder into a fixed sentinel UUID because Postgres treats NULL as
-- "distinct from every other NULL" — without it, multiple same-named
-- files at the root (no folder) wouldn't collide.
create unique index if not exists documents_unique_name_per_folder_idx
  on public.documents (
    client_id,
    coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(file_name)
  );

-- ---------------------------------------------------------------------
-- Row Level Security
-- This is an internal tool: every signed-in team member (there is no
-- public sign-up — you create accounts for teammates in the Supabase
-- dashboard) can see and manage every client and document.
-- ---------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.documents enable row level security;
alter table public.folders enable row level security;
alter table public.categories enable row level security;

drop policy if exists "clients: authenticated read" on public.clients;
create policy "clients: authenticated read"
  on public.clients for select
  to authenticated
  using (true);

drop policy if exists "clients: authenticated insert" on public.clients;
create policy "clients: authenticated insert"
  on public.clients for insert
  to authenticated
  with check (true);

drop policy if exists "clients: authenticated update" on public.clients;
create policy "clients: authenticated update"
  on public.clients for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "clients: authenticated delete" on public.clients;
create policy "clients: authenticated delete"
  on public.clients for delete
  to authenticated
  using (true);

drop policy if exists "documents: authenticated read" on public.documents;
create policy "documents: authenticated read"
  on public.documents for select
  to authenticated
  using (true);

drop policy if exists "documents: authenticated insert" on public.documents;
create policy "documents: authenticated insert"
  on public.documents for insert
  to authenticated
  with check (true);

drop policy if exists "documents: authenticated update" on public.documents;
create policy "documents: authenticated update"
  on public.documents for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "documents: authenticated delete" on public.documents;
create policy "documents: authenticated delete"
  on public.documents for delete
  to authenticated
  using (true);

drop policy if exists "folders: authenticated read" on public.folders;
create policy "folders: authenticated read"
  on public.folders for select
  to authenticated
  using (true);

drop policy if exists "folders: authenticated insert" on public.folders;
create policy "folders: authenticated insert"
  on public.folders for insert
  to authenticated
  with check (true);

drop policy if exists "folders: authenticated update" on public.folders;
create policy "folders: authenticated update"
  on public.folders for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "folders: authenticated delete" on public.folders;
create policy "folders: authenticated delete"
  on public.folders for delete
  to authenticated
  using (true);

drop policy if exists "categories: authenticated read" on public.categories;
create policy "categories: authenticated read"
  on public.categories for select
  to authenticated
  using (true);

drop policy if exists "categories: authenticated insert" on public.categories;
create policy "categories: authenticated insert"
  on public.categories for insert
  to authenticated
  with check (true);

drop policy if exists "categories: authenticated update" on public.categories;
create policy "categories: authenticated update"
  on public.categories for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "categories: authenticated delete" on public.categories;
create policy "categories: authenticated delete"
  on public.categories for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- Storage bucket for uploaded files (private — accessed only via
-- signed URLs generated server/client-side for authenticated users)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-documents', 'client-documents', false)
on conflict (id) do nothing;

drop policy if exists "client-documents: authenticated read" on storage.objects;
create policy "client-documents: authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'client-documents');

drop policy if exists "client-documents: authenticated insert" on storage.objects;
create policy "client-documents: authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'client-documents');

drop policy if exists "client-documents: authenticated delete" on storage.objects;
create policy "client-documents: authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'client-documents');

-- ---------------------------------------------------------------------
-- Storage bucket for client logos (public — these are just company
-- logos shown in the UI, so they're served directly via public URL
-- rather than signed URLs).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('client-logos', 'client-logos', true)
on conflict (id) do nothing;

drop policy if exists "client-logos: public read" on storage.objects;
create policy "client-logos: public read"
  on storage.objects for select
  using (bucket_id = 'client-logos');

drop policy if exists "client-logos: authenticated insert" on storage.objects;
create policy "client-logos: authenticated insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'client-logos');

drop policy if exists "client-logos: authenticated update" on storage.objects;
create policy "client-logos: authenticated update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'client-logos');

drop policy if exists "client-logos: authenticated delete" on storage.objects;
create policy "client-logos: authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'client-logos');
