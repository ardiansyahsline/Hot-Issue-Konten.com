-- =====================================================================
-- UPDATE 09 — Discord Moderator input Video Review, Bug pindah ke Hot Issue,
--             lampiran di Chat, status online / terakhir dilihat, foto profil
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-08. Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. Discord Moderator boleh INPUT + edit Video Review ----------
create or replace function public.can_write_reviews()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'cs', 'video_review', 'discord_mod'), false);
$$;

-- ---------- 2. Catatan & Saran kategori "Bug" dipindah ke Hot Issue (kategori "Bug platform") ----------
--  - judul, isi, pencatat, tanggal, lampiran, tanggapan (+ balasan) dan reaksi ikut pindah
--  - status: Baru -> Open, In Progress -> In Progress, Done/Rejected -> Resolved (alasan dicatat di update)
do $$
declare
  s record;
  c record;
  new_issue bigint;
  new_note bigint;
  note_map jsonb;
  st text;
begin
  for s in select * from public.suggestions where category = 'bug' order by id loop
    st := case s.status when 'baru' then 'open' when 'in_progress' then 'in_progress' else 'resolved' end;
    insert into public.issues (title, description, category, status, priority, created_by, created_at, updated_at)
    values (s.title, s.body, 'Bug platform', st, 'medium', s.created_by, s.created_at, now())
    returning id into new_issue;

    -- catatan asal (tanpa mengubah isi)
    insert into public.issue_notes (issue_id, body, created_by, created_at)
    values (
      new_issue,
      '↪ Dipindahkan dari Catatan & Saran (kategori Bug). Status lama: ' || s.status ||
        coalesce(E'\nAlasan: ' || nullif(btrim(s.status_reason), ''), ''),
      coalesce(s.status_changed_by, s.created_by),
      coalesce(s.status_changed_at, s.created_at)
    );

    -- tanggapan -> komentar issue (komentar utama dulu, baru balasannya)
    note_map := '{}'::jsonb;
    for c in
      select * from public.suggestion_comments where suggestion_id = s.id
      order by (parent_id is not null), created_at, id
    loop
      insert into public.issue_notes (issue_id, body, created_by, created_at, parent_id)
      values (new_issue, c.body, c.created_by, c.created_at, (note_map ->> c.parent_id::text)::bigint)
      returning id into new_note;
      note_map := note_map || jsonb_build_object(c.id::text, new_note);
      update public.attachments set issue_note_id = new_note, suggestion_comment_id = null where suggestion_comment_id = c.id;
      update public.reactions   set issue_note_id = new_note, suggestion_comment_id = null where suggestion_comment_id = c.id;
    end loop;

    update public.attachments set issue_id = new_issue, suggestion_id = null where suggestion_id = s.id;
    update public.reactions   set issue_id = new_issue, suggestion_id = null where suggestion_id = s.id;
    delete from public.suggestions where id = s.id;
  end loop;
end $$;

alter table public.suggestions drop constraint if exists suggestions_category_check;
alter table public.suggestions add constraint suggestions_category_check
  check (category in ('fitur', 'keluhan_clipper', 'brief_campaign'));

-- ---------- 3. Foto profil & status online ----------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.profiles drop constraint if exists profiles_avatar_url_check;
alter table public.profiles add constraint profiles_avatar_url_check
  check (avatar_url is null or avatar_url ~ '/storage/v1/object/public/avatar/[0-9a-f-]{36}/');
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- dipanggil aplikasi tiap ±1 menit selama tab terbuka -> "Online" / "Terakhir dilihat"
create or replace function public.touch_presence()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;
grant execute on function public.touch_presence() to authenticated;

-- bucket foto profil (publik supaya cepat tampil; maks 2 MB, gambar saja)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatar', 'avatar', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatar_read" on storage.objects;
create policy "avatar_read" on storage.objects for select to authenticated using (bucket_id = 'avatar');
drop policy if exists "avatar_upload" on storage.objects;
create policy "avatar_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatar' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar_update" on storage.objects;
create policy "avatar_update" on storage.objects for update to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatar_delete" on storage.objects;
create policy "avatar_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatar' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- 4. Lampiran di Chat (room & pesan pribadi) ----------
alter table public.attachments add column if not exists chat_message_id bigint references public.chat_messages (id) on delete cascade;
create index if not exists attachments_msg_idx on public.attachments (chat_message_id);
alter table public.attachments drop constraint if exists attachments_one_parent;
alter table public.attachments add constraint attachments_one_parent
  check (num_nonnulls(issue_id, issue_note_id, suggestion_id, suggestion_comment_id, chat_message_id) = 1);

create or replace function public.can_attach(p_issue bigint, p_note bigint, p_sg bigint, p_comment bigint, p_msg bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_msg is not null then exists (
      select 1 from public.chat_messages m where m.id = p_msg and m.sender_id = auth.uid())
    else public.can_attach(p_issue, p_note, p_sg, p_comment)
  end;
$$;
grant execute on function public.can_attach(bigint, bigint, bigint, bigint, bigint) to authenticated;

drop policy if exists "attachments_insert" on public.attachments;
create policy "attachments_insert" on public.attachments
  for insert to authenticated
  with check (
    split_part(path, '/', 1) = auth.uid()::text
    and public.can_attach(issue_id, issue_note_id, suggestion_id, suggestion_comment_id, chat_message_id)
  );

-- lampiran chat hanya terlihat oleh yang bisa membuka room-nya (pesan pribadi tetap pribadi)
drop policy if exists "attachments_select" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated using (public.can_react_message(chat_message_id));

-- file di bucket lampiran: bisa dibuka kalau file milik sendiri / lampirannya boleh dilihat
drop policy if exists "lampiran_read" on storage.objects;
create policy "lampiran_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'lampiran'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (select 1 from public.attachments a where a.path = storage.objects.name)
    )
  );

-- pesan boleh berisi lampiran saja (tanpa teks)
alter table public.chat_messages drop constraint if exists chat_messages_body_check;
alter table public.chat_messages add constraint chat_messages_body_check check (char_length(body) <= 4000);

-- kirim pesan + lampiran sekaligus (satu transaksi, jadi penerima tidak melihat pesan "kosong")
create or replace function public.chat_send(p_room uuid, p_body text, p_files jsonb default '[]'::jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  mid bigint;
  f jsonb;
  n int := 0;
  files jsonb := coalesce(p_files, '[]'::jsonb);
begin
  if coalesce(btrim(p_body), '') = '' and jsonb_array_length(files) = 0 then
    raise exception 'Pesan kosong';
  end if;
  insert into public.chat_messages (room_id, body) values (p_room, coalesce(btrim(p_body), '')) returning id into mid;
  for f in select * from jsonb_array_elements(files) loop
    n := n + 1;
    exit when n > 10;
    insert into public.attachments (path, name, size, mime, chat_message_id)
    values (f ->> 'path', left(coalesce(nullif(f ->> 'name', ''), 'lampiran'), 200), coalesce((f ->> 'size')::bigint, 0), f ->> 'mime', mid);
  end loop;
  return mid;
end;
$$;
grant execute on function public.chat_send(uuid, text, jsonb) to authenticated;

-- ---------- 5. Notifikasi (push browser + email) ----------
create table if not exists public.push_subscriptions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_own" on public.push_subscriptions;
create policy "push_own" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- pengaturan per orang (default: semua nyala)
create table if not exists public.notification_prefs (
  user_id      uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  push_issue   boolean not null default true,
  push_dm      boolean not null default true,
  push_room    boolean not null default true,
  email_issue  boolean not null default true,
  email_dm     boolean not null default true,
  updated_at   timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
drop policy if exists "prefs_own" on public.notification_prefs;
create policy "prefs_own" on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.notification_prefs to authenticated;
revoke all on public.push_subscriptions, public.notification_prefs from anon;

-- supaya email chat pribadi tidak dikirim berkali-kali (maks 1 email / 15 menit per percakapan)
alter table public.chat_members add column if not exists last_emailed_at timestamptz;

-- muat ulang cache API supaya kolom & fungsi baru langsung terbaca
notify pgrst, 'reload schema';
