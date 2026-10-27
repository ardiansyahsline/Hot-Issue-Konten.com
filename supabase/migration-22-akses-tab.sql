-- =====================================================================
-- UPDATE 22 — Akses tab per user: admin bisa menutup tab tertentu (Dashboard & Hot Issue, Video Review,
-- Catatan & Saran, Chat, AI, Musik AI) untuk user tertentu. Diatur di Admin → Akses tab per user.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-21. Aman dijalankan ulang.
-- Belum dijalankan? Website tetap jalan seperti biasa (semua tab terbuka untuk semua user).
--
-- Disimpan sebagai daftar TUTUP: tidak ada baris = semua tab boleh, jadi tab baru otomatis terbuka.
-- Admin selalu boleh semua tab. Studio tetap diatur lewat studio_access (migration-20).
-- Id tab harus sama dengan lib/tabs.ts (TAB_IDS).
-- Tab yang ditutup dikunci di website (menu, halaman, aksi) DAN di database (bagian 3: data tab itu tidak bisa
-- dibaca / diubah langsung lewat Supabase, termasuk realtime chat).
-- =====================================================================

-- ---------- 1. Daftar tab yang ditutup per user ----------
create table if not exists public.user_tab_blocks (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  blocked     text[] not null default '{}',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- isi hanya id tab yang dikenal (dibuat ulang tiap migration dijalankan supaya daftar id selalu terbaru)
alter table public.user_tab_blocks drop constraint if exists user_tab_blocks_known;
alter table public.user_tab_blocks add constraint user_tab_blocks_known
  check (blocked <@ array['dashboard', 'video_review', 'catatan', 'chat', 'ai', 'musik']::text[]);

-- updated_at + updated_by diisi database (tidak bisa dipalsukan dari browser); admin tidak bisa dibatasi.
-- Hanya dicek kalau daftar tab-nya berubah: hapus akun admin (updated_by -> null otomatis) tidak boleh ikut gagal.
create or replace function public.user_tab_blocks_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.blocked is not distinct from old.blocked then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'Admin selalu bisa membuka semua tab' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
revoke execute on function public.user_tab_blocks_stamp() from public, anon;
drop trigger if exists user_tab_blocks_stamp on public.user_tab_blocks;
create trigger user_tab_blocks_stamp before insert or update on public.user_tab_blocks
  for each row execute function public.user_tab_blocks_stamp();

alter table public.user_tab_blocks enable row level security;
grant select, insert, update, delete on public.user_tab_blocks to authenticated;
revoke all on public.user_tab_blocks from anon;

-- lihat: baris sendiri (supaya website tahu tab mana yang ditutup) atau admin
drop policy if exists "user_tab_blocks_read" on public.user_tab_blocks;
create policy "user_tab_blocks_read" on public.user_tab_blocks for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- ubah: hanya admin
drop policy if exists "user_tab_blocks_admin_insert" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_insert" on public.user_tab_blocks for insert to authenticated
  with check (public.is_admin());
drop policy if exists "user_tab_blocks_admin_update" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_update" on public.user_tab_blocks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "user_tab_blocks_admin_delete" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_delete" on public.user_tab_blocks for delete to authenticated
  using (public.is_admin());

-- ---------- 2. Boleh buka tab t? (admin selalu boleh; tidak ada baris = boleh). Dipakai aturan bagian 3 ----------
create or replace function public.tab_allowed(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or not exists (select 1 from public.user_tab_blocks where user_id = auth.uid() and t = any (blocked))
  );
$$;
revoke execute on function public.tab_allowed(text) from public, anon;
grant execute on function public.tab_allowed(text) to authenticated;

-- ---------- 3. Kunci data di database ----------
-- Tab ditutup -> data tab itu tidak bisa dibaca / ditulis user itu, walau dipanggil langsung ke Supabase
-- (bukan lewat website). Aturan RESTRICTIVE = syarat TAMBAHAN di atas aturan lama (tidak membuka akses baru).
-- Admin & server (service role) tidak terpengaruh. View issue_list / video_review_list / suggestion_list /
-- contact_stats ikut (security_invoker). ai_characters & ai_character_memory TIDAK dikunci (dipakai juga Studio).
-- `(select ...)` = cukup dihitung sekali per query (tidak per baris).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('issues', 'dashboard'), ('issue_notes', 'dashboard'), ('issue_reports', 'dashboard'), ('issue_contacts', 'dashboard'),
      ('video_reviews', 'video_review'), ('video_review_links', 'video_review'), ('video_review_category_notes', 'video_review'),
      ('suggestions', 'catatan'), ('suggestion_comments', 'catatan'),
      ('chat_rooms', 'chat'), ('chat_members', 'chat'), ('chat_messages', 'chat'),
      ('ai_conversations', 'ai'), ('ai_messages', 'ai')
    ) as t (tbl, tab)
  loop
    -- tabel belum ada (migration lama belum dijalankan) -> dilewati
    if to_regclass('public.' || r.tbl) is not null then
      execute format('drop policy if exists %I on public.%I', 'tab_' || r.tbl, r.tbl);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated using ((select public.tab_allowed(%L))) with check ((select public.tab_allowed(%L)))',
        'tab_' || r.tbl, r.tbl, r.tab, r.tab
      );
    end if;
  end loop;
end;
$$;

-- lampiran & reaksi: ikut tab tempatnya menempel (Hot Issue -> Dashboard, Catatan, Chat)
drop policy if exists "tab_attachments" on public.attachments;
create policy "tab_attachments" on public.attachments as restrictive for all to authenticated
  using (
    ((issue_id is null and issue_note_id is null and issue_report_id is null) or (select public.tab_allowed('dashboard')))
    and ((suggestion_id is null and suggestion_comment_id is null) or (select public.tab_allowed('catatan')))
    and (chat_message_id is null or (select public.tab_allowed('chat')))
  )
  with check (
    ((issue_id is null and issue_note_id is null and issue_report_id is null) or (select public.tab_allowed('dashboard')))
    and ((suggestion_id is null and suggestion_comment_id is null) or (select public.tab_allowed('catatan')))
    and (chat_message_id is null or (select public.tab_allowed('chat')))
  );
drop policy if exists "tab_reactions" on public.reactions;
create policy "tab_reactions" on public.reactions as restrictive for all to authenticated
  using (
    ((issue_id is null and issue_note_id is null) or (select public.tab_allowed('dashboard')))
    and ((suggestion_id is null and suggestion_comment_id is null) or (select public.tab_allowed('catatan')))
    and (chat_message_id is null or (select public.tab_allowed('chat')))
  )
  with check (
    ((issue_id is null and issue_note_id is null) or (select public.tab_allowed('dashboard')))
    and ((suggestion_id is null and suggestion_comment_id is null) or (select public.tab_allowed('catatan')))
    and (chat_message_id is null or (select public.tab_allowed('chat')))
  );

-- fungsi chat yang berjalan dengan hak pemilik (melewati aturan tabel) ikut dicek tab Chat.
-- Isinya sama dengan migration-06 / migration-10, hanya ditambah cek tab_allowed('chat').
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
  if not public.tab_allowed('chat') then raise exception 'Tab Chat ditutup admin untuk akunmu.' using errcode = '42501'; end if;
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
  if not public.tab_allowed('chat') then raise exception 'Tab Chat ditutup admin untuk akunmu.' using errcode = '42501'; end if;
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

create or replace function public.chat_mark_read(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.tab_allowed('chat') or not public.can_access_room(p_room) then return; end if;
  insert into public.chat_members (room_id, user_id, last_read_at) values (p_room, auth.uid(), now())
  on conflict (room_id, user_id) do update set last_read_at = now();
end;
$$;

-- daftar room (isi pesan terakhir + jumlah belum dibaca): tab Chat ditutup -> kosong
create or replace function public.chat_overview()
returns table (
  room_id uuid, kind text, name text, other_id uuid, other_name text,
  last_body text, last_at timestamptz, last_sender text, unread int, member_count int, mentioned int
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select r.*
    from public.chat_rooms r
    where (select public.tab_allowed('chat'))
      and (r.kind = 'public'
       or exists (select 1 from public.chat_members m where m.room_id = r.id and m.user_id = auth.uid()))
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
    (select count(*)::int from public.chat_members c where c.room_id = r.id) as member_count,
    (select count(*)::int from public.chat_messages x
      where x.room_id = r.id
        and x.sender_id is distinct from auth.uid()
        and x.created_at > coalesce(me.last_read_at, now() - interval '3 days')
        and (x.mention_all or auth.uid() = any (x.mentions)
             or exists (select 1 from public.chat_messages q where q.id = x.reply_to and q.sender_id = auth.uid()))) as mentioned
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

notify pgrst, 'reload schema';
