-- =====================================================================
-- UPDATE 06 — kolom Catatan (Video Review), status dari Insight, Chat, percepatan Dashboard
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-05. Aman dijalankan ulang.
-- Tidak ada data yang dihapus (kolom Insight & Argumen clipper lama tetap disimpan).
-- =====================================================================

-- ---------- 1. VIDEO REVIEW: kolom Catatan = Insight + Argumen clipper ----------
alter table public.video_reviews add column if not exists notes text;

update public.video_reviews
set notes = nullif(concat_ws(
      E'\n',
      nullif(btrim(insight), ''),
      case when nullif(btrim(clipper_argument), '') is not null then 'Argumen clipper: ' || btrim(clipper_argument) end
    ), '')
where notes is null
  and (nullif(btrim(insight), '') is not null or nullif(btrim(clipper_argument), '') is not null);

-- ---------- 2. Status: kalau Penyelesaian "belum ada respons" tapi Insight ada isinya,
--                status dibaca dari Insight (aturan sama dengan lib/videoReview.ts) ----------
update public.video_reviews
set status = case
  when lower(btrim(insight)) ~ 'ditolak' then 'ditolak'
  when lower(btrim(insight)) ~ '(disetujui|\yacc\y|sudah rilis|sesuai)' then 'disetujui'
  when lower(btrim(insight)) ~ '(^belum|menunggu|perlu kirim)' then 'menunggu'
  when lower(btrim(insight)) ~ '(sudah diproses|selesai|dijelaskan|pembaruan|refresh)' then 'selesai'
  when lower(btrim(insight)) ~ '(diproses|masih)' then 'diproses'
  else 'selesai'
end
where status = 'menunggu'
  and nullif(btrim(insight), '') is not null;

-- view perlu dibuat ulang supaya kolom baru ikut
drop view if exists public.video_review_list;
create view public.video_review_list
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
grant select on public.video_review_list to authenticated;
revoke all on public.video_review_list from anon;

create index if not exists video_reviews_report_date_idx on public.video_reviews (report_date);

-- ---------- 3. DASHBOARD: semua angka kartu dalam 1 panggilan (lebih cepat) ----------
create or replace function public.dashboard_counts(p_hot_threshold int, p_today_start timestamptz)
returns json
language sql
stable
security invoker
set search_path = public
as $$
  select json_build_object(
    'open',           (select count(*) from public.issues where status = 'open'),
    'in_progress',    (select count(*) from public.issues where status = 'in_progress'),
    'urgent',         (select count(*) from public.issues where status <> 'resolved' and priority = 'urgent'),
    'hot',            (select count(*) from public.issue_list
                        where status <> 'resolved' and (is_hot or max_contact_reports_30d >= p_hot_threshold)),
    'resolved_today', (select count(*) from public.issues where status = 'resolved' and resolved_at >= p_today_start)
  );
$$;
grant execute on function public.dashboard_counts(int, timestamptz) to authenticated;

-- ---------- 4. CHAT: room bersama + pesan pribadi ----------
create table if not exists public.chat_rooms (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  kind             text not null default 'group' check (kind in ('public', 'group', 'direct')),
  dm_key           text unique,                          -- untuk pesan pribadi: "<uuid kecil>:<uuid besar>"
  created_by       uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now()
);

create table if not exists public.chat_members (
  room_id       uuid not null references public.chat_rooms (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  last_read_at  timestamptz not null default now(),
  joined_at     timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists chat_members_user_idx on public.chat_members (user_id);

create table if not exists public.chat_messages (
  id          bigint generated always as identity primary key,
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  sender_id   uuid references public.profiles (id) on delete set null default auth.uid(),
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_room_idx on public.chat_messages (room_id, created_at desc);

-- siapa boleh buka room: room publik = semua yang login; selain itu hanya anggota
create or replace function public.can_access_room(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.chat_rooms r where r.id = p_room and r.kind = 'public')
      or exists (select 1 from public.chat_members m where m.room_id = p_room and m.user_id = auth.uid());
$$;
grant execute on function public.can_access_room(uuid) to authenticated;

-- pengirim selalu user yang login + update waktu pesan terakhir di room
create or replace function public.chat_messages_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.sender_id := auth.uid();
  end if;
  update public.chat_rooms set last_message_at = now() where id = new.room_id;
  if auth.uid() is not null then
    insert into public.chat_members (room_id, user_id, last_read_at)
    values (new.room_id, auth.uid(), now())
    on conflict (room_id, user_id) do update set last_read_at = now();
  end if;
  return new;
end;
$$;
drop trigger if exists chat_messages_before_insert on public.chat_messages;
create trigger chat_messages_before_insert
  before insert on public.chat_messages
  for each row execute function public.chat_messages_before_insert();

alter table public.chat_rooms    enable row level security;
alter table public.chat_members  enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "chat_rooms_select" on public.chat_rooms;
create policy "chat_rooms_select" on public.chat_rooms for select to authenticated using (public.can_access_room(id));
drop policy if exists "chat_rooms_update" on public.chat_rooms;
create policy "chat_rooms_update" on public.chat_rooms for update to authenticated
  using (created_by = auth.uid() or public.is_admin()) with check (created_by = auth.uid() or public.is_admin());
drop policy if exists "chat_rooms_delete" on public.chat_rooms;
create policy "chat_rooms_delete" on public.chat_rooms for delete to authenticated
  using ((created_by = auth.uid() and kind <> 'direct') or public.is_admin());

drop policy if exists "chat_members_select" on public.chat_members;
create policy "chat_members_select" on public.chat_members for select to authenticated using (public.can_access_room(room_id));
drop policy if exists "chat_members_update_self" on public.chat_members;
create policy "chat_members_update_self" on public.chat_members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "chat_members_delete_self" on public.chat_members;
create policy "chat_members_delete_self" on public.chat_members for delete to authenticated using (user_id = auth.uid());

drop policy if exists "chat_messages_select" on public.chat_messages;
create policy "chat_messages_select" on public.chat_messages for select to authenticated using (public.can_access_room(room_id));
drop policy if exists "chat_messages_insert" on public.chat_messages;
create policy "chat_messages_insert" on public.chat_messages for insert to authenticated
  with check (public.can_access_room(room_id));
drop policy if exists "chat_messages_delete_own" on public.chat_messages;
create policy "chat_messages_delete_own" on public.chat_messages for delete to authenticated
  using (sender_id = auth.uid() or public.is_admin());

grant select, update, delete on public.chat_rooms to authenticated;
grant select, update, delete on public.chat_members to authenticated;
grant select, insert, delete on public.chat_messages to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.chat_rooms, public.chat_members, public.chat_messages from anon;

-- Buat room (publik / grup) + anggotanya sekaligus
create or replace function public.chat_create_room(p_name text, p_kind text, p_members uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_kind not in ('public', 'group') then raise exception 'kind tidak valid'; end if;
  if nullif(btrim(p_name), '') is null then raise exception 'Nama room wajib diisi'; end if;
  insert into public.chat_rooms (name, kind, created_by) values (btrim(p_name), p_kind, auth.uid()) returning id into rid;
  insert into public.chat_members (room_id, user_id)
  select rid, u from unnest(array_append(coalesce(p_members, '{}'), auth.uid())) as u
  where exists (select 1 from public.profiles p where p.id = u)
  on conflict do nothing;
  return rid;
end;
$$;

-- Buka (atau buat) pesan pribadi dengan orang lain
create or replace function public.chat_open_dm(p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  rid uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_other = me then raise exception 'Tidak bisa chat dengan diri sendiri'; end if;
  if not exists (select 1 from public.profiles where id = p_other) then raise exception 'User tidak ditemukan'; end if;
  k := least(me::text, p_other::text) || ':' || greatest(me::text, p_other::text);
  select id into rid from public.chat_rooms where dm_key = k;
  if rid is null then
    insert into public.chat_rooms (kind, dm_key, created_by) values ('direct', k, me) returning id into rid;
    insert into public.chat_members (room_id, user_id) values (rid, me), (rid, p_other) on conflict do nothing;
  end if;
  return rid;
end;
$$;

-- Tandai room sudah dibaca (sekalian gabung kalau room publik)
create or replace function public.chat_mark_read(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_access_room(p_room) then return; end if;
  insert into public.chat_members (room_id, user_id, last_read_at) values (p_room, auth.uid(), now())
  on conflict (room_id, user_id) do update set last_read_at = now();
end;
$$;

-- Daftar room untuk sidebar: nama, pesan terakhir, jumlah belum dibaca
create or replace function public.chat_overview()
returns table (
  room_id uuid, kind text, name text, other_id uuid, other_name text,
  last_body text, last_at timestamptz, last_sender text, unread int, member_count int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select r.*
    from public.chat_rooms r
    where r.kind = 'public'
       or exists (select 1 from public.chat_members m where m.room_id = r.id and m.user_id = auth.uid())
  )
  select
    r.id, r.kind,
    coalesce(r.name, '') as name,
    o.user_id as other_id,
    op.full_name as other_name,
    lm.body as last_body, lm.created_at as last_at, sp.full_name as last_sender,
    (select count(*)::int from public.chat_messages x
      where x.room_id = r.id
        and x.sender_id is distinct from auth.uid()
        and x.created_at > coalesce(me.last_read_at, now() - interval '3 days')) as unread,
    (select count(*)::int from public.chat_members c where c.room_id = r.id) as member_count
  from mine r
  left join public.chat_members me on me.room_id = r.id and me.user_id = auth.uid()
  left join lateral (
    select m2.user_id from public.chat_members m2
    where r.kind = 'direct' and m2.room_id = r.id and m2.user_id <> auth.uid() limit 1
  ) o on true
  left join public.profiles op on op.id = o.user_id
  left join lateral (
    select x.body, x.created_at, x.sender_id from public.chat_messages x
    where x.room_id = r.id order by x.created_at desc limit 1
  ) lm on true
  left join public.profiles sp on sp.id = lm.sender_id
  order by (r.kind = 'public') desc, r.last_message_at desc;
$$;

grant execute on function public.chat_create_room(text, text, uuid[]) to authenticated;
grant execute on function public.chat_open_dm(uuid) to authenticated;
grant execute on function public.chat_mark_read(uuid) to authenticated;
grant execute on function public.chat_overview() to authenticated;

-- Room bersama default
insert into public.chat_rooms (name, kind)
select 'semua-cs', 'public'
where not exists (select 1 from public.chat_rooms where kind = 'public' and name = 'semua-cs');

-- Realtime: pesan baru langsung muncul tanpa refresh
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
     ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- muat ulang cache API supaya fungsi/kolom baru langsung terbaca
notify pgrst, 'reload schema';
