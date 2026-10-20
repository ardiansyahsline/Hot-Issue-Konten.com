-- =====================================================================
-- UPDATE 02 — 5 role (Admin, CS, Video Review, Discord Moderator, User)
--             + menu Video Review
-- Jalankan SEKALI di Supabase SQL Editor SETELAH schema.sql.
-- Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. ROLE ----------
alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'cs' where role = 'agent';
alter table public.profiles alter column role set default 'user';
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'cs', 'video_review', 'discord_mod', 'user'));

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := new.raw_app_meta_data ->> 'role';
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case when r in ('admin', 'cs', 'video_review', 'discord_mod', 'user') then r else 'user' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- Siapa yang boleh input/edit Hot Issues
create or replace function public.can_write_issues()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'cs', 'video_review', 'discord_mod'), false);
$$;

-- Siapa yang boleh input/edit Video Review
create or replace function public.can_write_reviews()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'cs', 'video_review'), false);
$$;

grant execute on function public.my_role(), public.can_write_issues(), public.can_write_reviews() to authenticated;

-- ---------- 2. HAK AKSES HOT ISSUES (role User jadi read-only) ----------
drop policy if exists "issues_insert" on public.issues;
create policy "issues_insert" on public.issues for insert to authenticated
  with check (public.can_write_issues());
drop policy if exists "issues_update" on public.issues;
create policy "issues_update" on public.issues for update to authenticated
  using (public.can_write_issues()) with check (public.can_write_issues());

drop policy if exists "contacts_insert" on public.issue_contacts;
create policy "contacts_insert" on public.issue_contacts for insert to authenticated
  with check (public.can_write_issues());
drop policy if exists "contacts_update" on public.issue_contacts;
create policy "contacts_update" on public.issue_contacts for update to authenticated
  using (public.can_write_issues()) with check (public.can_write_issues());
drop policy if exists "contacts_delete" on public.issue_contacts;
create policy "contacts_delete" on public.issue_contacts for delete to authenticated
  using (public.can_write_issues());

drop policy if exists "notes_insert" on public.issue_notes;
create policy "notes_insert" on public.issue_notes for insert to authenticated
  with check (created_by = auth.uid() and public.can_write_issues());

-- ---------- 3. VIDEO REVIEW ----------
create table if not exists public.video_reviews (
  id                bigint generated always as identity primary key,
  report_date       date not null default (now() at time zone 'Asia/Jakarta')::date,
  explanation       text not null,                 -- Penjelasan
  category          text,                          -- null = belum dikategorikan
  status            text not null default 'menunggu'
                    check (status in ('menunggu', 'diproses', 'disetujui', 'ditolak', 'selesai')),
  resolution        text,                          -- Penyelesaian
  insight           text,                          -- Insight
  clipper_argument  text,                          -- Argumen clipper
  source_key        text unique,                   -- penanda baris hasil import (anti dobel)
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists video_reviews_date_idx on public.video_reviews (report_date desc, id desc);
create index if not exists video_reviews_category_idx on public.video_reviews (category);

create table if not exists public.video_review_links (
  id          bigint generated always as identity primary key,
  review_id   bigint not null references public.video_reviews (id) on delete cascade,
  kind        text not null default 'url' check (kind in ('email', 'url', 'other')),
  value       text not null,
  normalized  text not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists video_review_links_review_idx on public.video_review_links (review_id);
create index if not exists video_review_links_norm_idx on public.video_review_links (normalized);

create or replace function public.video_reviews_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists video_reviews_before_write on public.video_reviews;
create trigger video_reviews_before_write
  before insert or update on public.video_reviews
  for each row execute function public.video_reviews_before_write();

create or replace function public.video_review_links_normalize()
returns trigger
language plpgsql
as $$
begin
  new.value := btrim(new.value);
  new.normalized := lower(new.value);
  return new;
end;
$$;
drop trigger if exists video_review_links_normalize on public.video_review_links;
create trigger video_review_links_normalize
  before insert or update on public.video_review_links
  for each row execute function public.video_review_links_normalize();

create or replace view public.video_review_list
with (security_invoker = on) as
select
  v.*,
  cr.full_name as created_by_name,
  up.full_name as updated_by_name,
  coalesce(l.links, '[]'::jsonb) as links,
  coalesce(l.links_text, '')     as links_text
from public.video_reviews v
left join public.profiles cr on cr.id = v.created_by
left join public.profiles up on up.id = v.updated_by
left join lateral (
  select
    jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'value', x.value) order by x.id) as links,
    string_agg(x.normalized, ' ') as links_text
  from public.video_review_links x
  where x.review_id = v.id
) l on true;

alter table public.video_reviews      enable row level security;
alter table public.video_review_links enable row level security;

drop policy if exists "vr_select" on public.video_reviews;
create policy "vr_select" on public.video_reviews for select to authenticated using (true);
drop policy if exists "vr_insert" on public.video_reviews;
create policy "vr_insert" on public.video_reviews for insert to authenticated with check (public.can_write_reviews());
drop policy if exists "vr_update" on public.video_reviews;
create policy "vr_update" on public.video_reviews for update to authenticated
  using (public.can_write_reviews()) with check (public.can_write_reviews());
drop policy if exists "vr_delete" on public.video_reviews;
create policy "vr_delete" on public.video_reviews for delete to authenticated using (public.is_admin());

drop policy if exists "vrl_select" on public.video_review_links;
create policy "vrl_select" on public.video_review_links for select to authenticated using (true);
drop policy if exists "vrl_insert" on public.video_review_links;
create policy "vrl_insert" on public.video_review_links for insert to authenticated with check (public.can_write_reviews());
drop policy if exists "vrl_update" on public.video_review_links;
create policy "vrl_update" on public.video_review_links for update to authenticated
  using (public.can_write_reviews()) with check (public.can_write_reviews());
drop policy if exists "vrl_delete" on public.video_review_links;
create policy "vrl_delete" on public.video_review_links for delete to authenticated using (public.can_write_reviews());

grant select, insert, update, delete on public.video_reviews, public.video_review_links to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.video_review_list to authenticated;
revoke all on public.video_reviews, public.video_review_links, public.video_review_list from anon;

-- ---------- 4. REKAP PER KATEGORI (dipakai halaman Video Review) ----------
create or replace function public.video_review_summary(p_from date default null, p_to date default null)
returns table (category text, status text, total int)
language sql
stable
security invoker
set search_path = public
as $$
  select v.category, v.status, count(*)::int
  from public.video_reviews v
  where (p_from is null or v.report_date >= p_from)
    and (p_to is null or v.report_date <= p_to)
  group by v.category, v.status;
$$;
grant execute on function public.video_review_summary(date, date) to authenticated;
