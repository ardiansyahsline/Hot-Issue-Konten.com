-- =====================================================================
-- UPDATE 08 — Komentar untuk semua role, balas komentar, dan reaksi emoji
--             (Hot Issue, Catatan & Saran, dan Chat)
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-07. Aman dijalankan ulang.
-- =====================================================================

-- ---------- 1. Semua role (termasuk User) boleh komentar di Hot Issue ----------
drop policy if exists "notes_insert" on public.issue_notes;
create policy "notes_insert" on public.issue_notes for insert to authenticated
  with check (created_by = auth.uid());

-- ---------- 2. Balas komentar (satu tingkat, tampil menjorok di bawah komentar asal) ----------
alter table public.issue_notes add column if not exists parent_id bigint references public.issue_notes (id) on delete cascade;
alter table public.suggestion_comments add column if not exists parent_id bigint references public.suggestion_comments (id) on delete cascade;
create index if not exists issue_notes_parent_idx on public.issue_notes (parent_id);
create index if not exists suggestion_comments_parent_idx on public.suggestion_comments (parent_id);

-- ---------- 3. Reaksi emoji ----------
create table if not exists public.reactions (
  id                     bigint generated always as identity primary key,
  emoji                  text not null check (char_length(emoji) between 1 and 16),
  user_id                uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  issue_id               bigint references public.issues (id) on delete cascade,
  issue_note_id          bigint references public.issue_notes (id) on delete cascade,
  suggestion_id          bigint references public.suggestions (id) on delete cascade,
  suggestion_comment_id  bigint references public.suggestion_comments (id) on delete cascade,
  chat_message_id        bigint references public.chat_messages (id) on delete cascade,
  created_at             timestamptz not null default now(),
  constraint reactions_one_target
    check (num_nonnulls(issue_id, issue_note_id, suggestion_id, suggestion_comment_id, chat_message_id) = 1)
);
-- satu orang hanya bisa kasih emoji yang sama sekali per tempat
create unique index if not exists reactions_unique on public.reactions (
  user_id, emoji,
  coalesce(issue_id, 0), coalesce(issue_note_id, 0), coalesce(suggestion_id, 0),
  coalesce(suggestion_comment_id, 0), coalesce(chat_message_id, 0)
);
create index if not exists reactions_issue_idx   on public.reactions (issue_id);
create index if not exists reactions_note_idx    on public.reactions (issue_note_id);
create index if not exists reactions_sg_idx      on public.reactions (suggestion_id);
create index if not exists reactions_comment_idx on public.reactions (suggestion_comment_id);
create index if not exists reactions_msg_idx     on public.reactions (chat_message_id);

-- reaksi di chat hanya boleh dilihat/diberi oleh yang bisa membuka room-nya
create or replace function public.can_react_message(p_msg bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_msg is null
      or exists (select 1 from public.chat_messages m where m.id = p_msg and public.can_access_room(m.room_id));
$$;
grant execute on function public.can_react_message(bigint) to authenticated;

create or replace function public.reactions_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists reactions_before_insert on public.reactions;
create trigger reactions_before_insert
  before insert on public.reactions
  for each row execute function public.reactions_before_insert();

alter table public.reactions enable row level security;

drop policy if exists "reactions_select" on public.reactions;
create policy "reactions_select" on public.reactions for select to authenticated
  using (public.can_react_message(chat_message_id));

drop policy if exists "reactions_insert" on public.reactions;
create policy "reactions_insert" on public.reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_react_message(chat_message_id));

drop policy if exists "reactions_delete" on public.reactions;
create policy "reactions_delete" on public.reactions for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, delete on public.reactions to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.reactions from anon;

-- Realtime: reaksi chat langsung muncul di layar orang lain
alter table public.reactions replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reactions'
     ) then
    alter publication supabase_realtime add table public.reactions;
  end if;
end $$;

-- muat ulang cache API supaya tabel & kolom baru langsung terbaca
notify pgrst, 'reload schema';
