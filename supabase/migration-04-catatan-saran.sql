-- =====================================================================
-- UPDATE 04 — menu Catatan & Saran + nama pencatat otomatis
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-03.
-- Aman dijalankan ulang. Tidak ada data yang dihapus.
-- =====================================================================

-- ---------- 1. Nama pencatat / PIC otomatis (selain admin tidak bisa pilih orang lain) ----------
create or replace function public.issues_before_write()
returns trigger
language plpgsql
as $$
declare
  admin boolean := coalesce(public.is_admin(), false);
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);

  if auth.uid() is not null and not admin then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.pic_id := auth.uid();                       -- yang input otomatis jadi PIC
    elsif new.pic_id is distinct from old.pic_id and new.pic_id is distinct from auth.uid() then
      new.pic_id := old.pic_id;                       -- hanya boleh ambil alih untuk diri sendiri
    end if;
    if tg_op = 'UPDATE' then
      new.created_by := old.created_by;
    end if;
  end if;

  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.video_reviews_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if auth.uid() is not null and not coalesce(public.is_admin(), false) then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.issue_notes_before_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists issue_notes_before_insert on public.issue_notes;
create trigger issue_notes_before_insert
  before insert on public.issue_notes
  for each row execute function public.issue_notes_before_insert();

-- ---------- 2. CATATAN & SARAN (journal) ----------
create table if not exists public.suggestions (
  id          bigint generated always as identity primary key,
  category    text not null check (category in ('fitur', 'keluhan_clipper', 'brief_campaign', 'bug')),
  title       text not null check (length(btrim(title)) > 0),
  body        text,
  status      text not null default 'baru'
              check (status in ('baru', 'in_progress', 'done', 'rejected')),
  status_reason      text,                        -- alasan / keterangan progress (wajib kalau rejected)
  status_changed_by  uuid references public.profiles (id) on delete set null,
  status_changed_at  timestamptz,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.suggestions add column if not exists status_reason text;
alter table public.suggestions add column if not exists status_changed_by uuid references public.profiles (id) on delete set null;
alter table public.suggestions add column if not exists status_changed_at timestamptz;

create index if not exists suggestions_created_idx on public.suggestions (created_at desc);
create index if not exists suggestions_category_idx on public.suggestions (category);

create table if not exists public.suggestion_comments (
  id             bigint generated always as identity primary key,
  suggestion_id  bigint not null references public.suggestions (id) on delete cascade,
  body           text not null check (length(btrim(body)) > 0),
  created_by     uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now()
);
create index if not exists suggestion_comments_idx on public.suggestion_comments (suggestion_id, created_at);

-- Pencatat otomatis = user login (admin boleh mencatatkan atas nama orang lain).
-- Progress (status + alasan) hanya bisa diubah admin.
create or replace function public.suggestions_before_write()
returns trigger
language plpgsql
as $$
declare
  admin boolean := coalesce(public.is_admin(), false);
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if auth.uid() is not null and not admin then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
      new.status := 'baru';
      new.status_reason := null;
    else
      new.created_by := old.created_by;
      new.status := old.status;
      new.status_reason := old.status_reason;
    end if;
  end if;
  if tg_op = 'UPDATE' and (new.status is distinct from old.status or new.status_reason is distinct from old.status_reason) then
    new.status_changed_at := now();
    new.status_changed_by := coalesce(auth.uid(), new.status_changed_by);
  elsif tg_op = 'UPDATE' then
    new.status_changed_at := old.status_changed_at;
    new.status_changed_by := old.status_changed_by;
  end if;
  return new;
end;
$$;
drop trigger if exists suggestions_before_write on public.suggestions;
create trigger suggestions_before_write
  before insert or update on public.suggestions
  for each row execute function public.suggestions_before_write();

create or replace function public.suggestion_comments_before_insert()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists suggestion_comments_before_insert on public.suggestion_comments;
create trigger suggestion_comments_before_insert
  before insert on public.suggestion_comments
  for each row execute function public.suggestion_comments_before_insert();

create or replace view public.suggestion_list
with (security_invoker = on) as
select
  s.*,
  p.full_name  as created_by_name,
  u.full_name  as updated_by_name,
  sc.full_name as status_changed_by_name,
  coalesce(c.n, 0)  as comment_count,
  c.last_at         as last_comment_at
from public.suggestions s
left join public.profiles p on p.id = s.created_by
left join public.profiles u on u.id = s.updated_by
left join public.profiles sc on sc.id = s.status_changed_by
left join lateral (
  select count(*)::int as n, max(x.created_at) as last_at
  from public.suggestion_comments x
  where x.suggestion_id = s.id
) c on true;

alter table public.suggestions         enable row level security;
alter table public.suggestion_comments enable row level security;

-- Semua yang login bisa baca & kirim catatan/saran; edit/hapus milik sendiri; admin bebas.
drop policy if exists "sg_select" on public.suggestions;
create policy "sg_select" on public.suggestions for select to authenticated using (true);
drop policy if exists "sg_insert" on public.suggestions;
create policy "sg_insert" on public.suggestions for insert to authenticated with check (true);
drop policy if exists "sg_update" on public.suggestions;
create policy "sg_update" on public.suggestions for update to authenticated
  using (created_by = auth.uid() or public.is_admin())
  with check (true);
drop policy if exists "sg_delete" on public.suggestions;
create policy "sg_delete" on public.suggestions for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

drop policy if exists "sgc_select" on public.suggestion_comments;
create policy "sgc_select" on public.suggestion_comments for select to authenticated using (true);
drop policy if exists "sgc_insert" on public.suggestion_comments;
create policy "sgc_insert" on public.suggestion_comments for insert to authenticated with check (true);
drop policy if exists "sgc_delete" on public.suggestion_comments;
create policy "sgc_delete" on public.suggestion_comments for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

grant select, insert, update, delete on public.suggestions, public.suggestion_comments to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.suggestion_list to authenticated;
revoke all on public.suggestions, public.suggestion_comments, public.suggestion_list from anon;
