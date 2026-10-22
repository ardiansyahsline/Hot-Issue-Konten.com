-- =====================================================================
-- UPDATE 10 — Chat: balas pesan (kutipan) & mention @orang / @semua + notifikasinya
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-09. Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. Kolom baru di pesan ----------
alter table public.chat_messages add column if not exists reply_to bigint references public.chat_messages (id) on delete set null;
alter table public.chat_messages add column if not exists mentions uuid[] not null default '{}';
alter table public.chat_messages add column if not exists mention_all boolean not null default false;
create index if not exists chat_messages_mentions_idx on public.chat_messages using gin (mentions);

-- ---------- 2. Pengaturan notifikasi mention ----------
alter table public.notification_prefs add column if not exists push_mention boolean not null default true;
alter table public.notification_prefs add column if not exists email_mention boolean not null default true;

-- ---------- 3. Kirim pesan + lampiran + balasan + mention (satu transaksi) ----------
drop function if exists public.chat_send(uuid, text, jsonb);
create or replace function public.chat_send(
  p_room uuid,
  p_body text,
  p_files jsonb default '[]'::jsonb,
  p_reply_to bigint default null,
  p_mentions uuid[] default '{}',
  p_mention_all boolean default false
)
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
  reply bigint;
  ments uuid[];
begin
  if coalesce(btrim(p_body), '') = '' and jsonb_array_length(files) = 0 then
    raise exception 'Pesan kosong';
  end if;
  -- balasan hanya boleh ke pesan di room yang sama
  select m.id into reply from public.chat_messages m where m.id = p_reply_to and m.room_id = p_room;
  -- mention hanya ke akun yang ada (maks 20)
  select coalesce(array_agg(p.id), '{}') into ments
  from (select distinct unnest(coalesce(p_mentions, '{}')) as id limit 20) x
  join public.profiles p on p.id = x.id;

  insert into public.chat_messages (room_id, body, reply_to, mentions, mention_all)
  values (p_room, coalesce(btrim(p_body), ''), reply, ments, coalesce(p_mention_all, false))
  returning id into mid;

  for f in select * from jsonb_array_elements(files) loop
    n := n + 1;
    exit when n > 10;
    insert into public.attachments (path, name, size, mime, chat_message_id)
    values (f ->> 'path', left(coalesce(nullif(f ->> 'name', ''), 'lampiran'), 200), coalesce((f ->> 'size')::bigint, 0), f ->> 'mime', mid);
  end loop;
  return mid;
end;
$$;
grant execute on function public.chat_send(uuid, text, jsonb, bigint, uuid[], boolean) to authenticated;

-- ---------- 4. Daftar room: tambah jumlah mention yang belum dibaca (badge @) ----------
drop function if exists public.chat_overview();
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
grant execute on function public.chat_overview() to authenticated;

notify pgrst, 'reload schema';
