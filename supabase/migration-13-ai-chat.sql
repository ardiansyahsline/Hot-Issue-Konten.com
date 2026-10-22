-- =====================================================================
-- UPDATE 14 — Tab AI (chat dengan AI lewat OmniRoute)
-- Percakapan tiap orang PRIVAT: hanya pemiliknya yang bisa melihat (admin pun tidak).
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-12. Aman dijalankan ulang.
-- =====================================================================

create table if not exists public.ai_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  title       text not null default 'Chat baru' check (char_length(title) <= 120),
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_conversations_user_idx on public.ai_conversations (user_id, updated_at desc);

create table if not exists public.ai_messages (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.ai_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null default '' check (char_length(content) <= 100000),
  model            text,
  error            boolean not null default false,
  created_at       timestamptz not null default now()
);
create index if not exists ai_messages_conv_idx on public.ai_messages (conversation_id, id);

grant select, insert, update, delete on public.ai_conversations, public.ai_messages to authenticated;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists "aic_own" on public.ai_conversations;
create policy "aic_own" on public.ai_conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "aim_own" on public.ai_messages;
create policy "aim_own" on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid()));

notify pgrst, 'reload schema';
