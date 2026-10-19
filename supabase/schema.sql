-- =====================================================================
-- HOT ISSUES CS — Konten.com
-- Jalankan SEKALI di Supabase: Dashboard > SQL Editor > New query > paste semua > Run
-- =====================================================================

-- ---------- 1. PROFILES (data agent, nyambung ke akun login) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'agent' check (role in ('admin', 'agent')),
  created_at  timestamptz not null default now()
);

-- Otomatis bikin profile tiap kali akun baru dibuat (dari dashboard / halaman admin)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin' else 'agent' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: cek apakah user yang login adalah admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- 2. ISSUES ----------
create table if not exists public.issues (
  id           bigint generated always as identity primary key,
  title        text not null,
  description  text,
  category     text not null default 'Lainnya',
  status       text not null default 'open' check (status in ('open', 'in_progress', 'resolved')),
  priority     text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  campaign     text,
  pic_id       uuid references public.profiles (id) on delete set null,
  is_hot       boolean not null default false,          -- ditandai HOT manual
  created_by   uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

create or replace function public.issues_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_at := now();
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists issues_before_write on public.issues;
create trigger issues_before_write
  before insert or update on public.issues
  for each row execute function public.issues_before_write();

create index if not exists issues_status_idx on public.issues (status);
create index if not exists issues_updated_idx on public.issues (updated_at desc);

-- ---------- 3. KONTAK CLIPPER (HP / IG / Discord / Email) ----------
-- Normalisasi supaya "0812-3456-789", "+62 812 3456 789", "62812..." dihitung sama
create or replace function public.normalize_contact(p_type text, p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v text := lower(btrim(coalesce(p_value, '')));
begin
  if p_type = 'phone' then
    v := regexp_replace(v, '[^0-9]', '', 'g');
    if v like '0%' then
      v := '62' || substr(v, 2);
    elsif v like '8%' then
      v := '62' || v;
    end if;
  elsif p_type = 'instagram' then
    v := regexp_replace(v, '^(https?://)?(www\.)?instagram\.com/', '');
    v := regexp_replace(v, '[/?#].*$', '');
    v := ltrim(v, '@');
  elsif p_type = 'discord' then
    v := ltrim(v, '@');
    v := regexp_replace(v, '#0$', '');
  end if;
  return v;
end;
$$;

create table if not exists public.issue_contacts (
  id                bigint generated always as identity primary key,
  issue_id          bigint not null references public.issues (id) on delete cascade,
  type              text not null check (type in ('phone', 'instagram', 'discord', 'email')),
  value             text not null,
  normalized_value  text not null default '',
  created_by        uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  unique (issue_id, type, normalized_value)
);

create or replace function public.issue_contacts_normalize()
returns trigger
language plpgsql
as $$
begin
  new.value := btrim(new.value);
  new.normalized_value := public.normalize_contact(new.type, new.value);
  if new.normalized_value = '' then
    raise exception 'Kontak tidak valid';
  end if;
  return new;
end;
$$;

drop trigger if exists issue_contacts_normalize on public.issue_contacts;
create trigger issue_contacts_normalize
  before insert or update on public.issue_contacts
  for each row execute function public.issue_contacts_normalize();

create index if not exists issue_contacts_lookup_idx on public.issue_contacts (type, normalized_value);
create index if not exists issue_contacts_issue_idx on public.issue_contacts (issue_id);

-- ---------- 4. CATATAN / UPDATE PER ISSUE (handover antar shift) ----------
create table if not exists public.issue_notes (
  id          bigint generated always as identity primary key,
  issue_id    bigint not null references public.issues (id) on delete cascade,
  body        text not null check (length(btrim(body)) > 0),
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists issue_notes_issue_idx on public.issue_notes (issue_id, created_at);

-- ---------- 5. VIEW: statistik kontak (dasar logika HOT otomatis) ----------
create or replace view public.contact_stats
with (security_invoker = on) as
select
  ic.type,
  ic.normalized_value,
  (array_agg(ic.value order by ic.created_at desc))[1]                                as display_value,
  count(distinct ic.issue_id)::int                                                    as issue_count,
  count(distinct ic.issue_id) filter (where ic.created_at >= now() - interval '30 days')::int as issue_count_30d,
  count(distinct ic.issue_id) filter (where i.status <> 'resolved')::int              as open_issue_count,
  max(ic.created_at)                                                                  as last_seen
from public.issue_contacts ic
join public.issues i on i.id = ic.issue_id
group by ic.type, ic.normalized_value;

-- ---------- 6. VIEW: list issue lengkap (nama PIC, kontak, jumlah laporan kontak) ----------
create or replace view public.issue_list
with (security_invoker = on) as
select
  i.*,
  pic.full_name  as pic_name,
  cr.full_name   as created_by_name,
  up.full_name   as updated_by_name,
  coalesce(c.contacts, '[]'::jsonb)   as contacts,
  coalesce(c.contacts_text, '')       as contacts_text,
  coalesce(c.max_reports_30d, 0)      as max_contact_reports_30d
from public.issues i
left join public.profiles pic on pic.id = i.pic_id
left join public.profiles cr  on cr.id  = i.created_by
left join public.profiles up  on up.id  = i.updated_by
left join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'id', ic.id,
        'type', ic.type,
        'value', ic.value,
        'normalized_value', ic.normalized_value,
        'issue_count', cs.issue_count,
        'issue_count_30d', cs.issue_count_30d
      ) order by ic.created_at
    )                                                as contacts,
    string_agg(ic.value || ' ' || ic.normalized_value, ' ') as contacts_text,
    max(cs.issue_count_30d)                          as max_reports_30d
  from public.issue_contacts ic
  join public.contact_stats cs
    on cs.type = ic.type and cs.normalized_value = ic.normalized_value
  where ic.issue_id = i.id
) c on true;

-- ---------- 7. ROW LEVEL SECURITY ----------
alter table public.profiles       enable row level security;
alter table public.issues         enable row level security;
alter table public.issue_contacts enable row level security;
alter table public.issue_notes    enable row level security;

-- PROFILES: semua agent bisa lihat; ubah nama sendiri saja (role hanya lewat admin/service key)
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

revoke insert, update, delete on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- ISSUES: semua agent bisa lihat, buat, edit. Hapus hanya admin.
drop policy if exists "issues_select" on public.issues;
create policy "issues_select" on public.issues for select to authenticated using (true);
drop policy if exists "issues_insert" on public.issues;
create policy "issues_insert" on public.issues for insert to authenticated with check (true);
drop policy if exists "issues_update" on public.issues;
create policy "issues_update" on public.issues for update to authenticated using (true) with check (true);
drop policy if exists "issues_delete" on public.issues;
create policy "issues_delete" on public.issues for delete to authenticated using (public.is_admin());

-- KONTAK: semua agent bisa lihat, tambah, ubah, hapus
drop policy if exists "contacts_select" on public.issue_contacts;
create policy "contacts_select" on public.issue_contacts for select to authenticated using (true);
drop policy if exists "contacts_insert" on public.issue_contacts;
create policy "contacts_insert" on public.issue_contacts for insert to authenticated with check (true);
drop policy if exists "contacts_update" on public.issue_contacts;
create policy "contacts_update" on public.issue_contacts for update to authenticated using (true) with check (true);
drop policy if exists "contacts_delete" on public.issue_contacts;
create policy "contacts_delete" on public.issue_contacts for delete to authenticated using (true);

-- CATATAN: semua bisa lihat & tambah; hapus hanya penulis atau admin
drop policy if exists "notes_select" on public.issue_notes;
create policy "notes_select" on public.issue_notes for select to authenticated using (true);
drop policy if exists "notes_insert" on public.issue_notes;
create policy "notes_insert" on public.issue_notes for insert to authenticated with check (created_by = auth.uid());
drop policy if exists "notes_delete" on public.issue_notes;
create policy "notes_delete" on public.issue_notes for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

-- Hak akses eksplisit (aman walau project Supabase tidak auto-grant tabel baru)
grant usage on schema public to authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.issues, public.issue_contacts, public.issue_notes to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.contact_stats, public.issue_list to authenticated;
grant execute on function public.is_admin(), public.normalize_contact(text, text) to authenticated;

-- Pengunjung yang belum login tidak bisa apa-apa
revoke all on public.profiles, public.issues, public.issue_contacts, public.issue_notes from anon;
revoke all on public.contact_stats, public.issue_list from anon;
