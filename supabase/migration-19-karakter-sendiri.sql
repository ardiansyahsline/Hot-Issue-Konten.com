-- Karakter AI buatan sendiri (pribadi: hanya pembuatnya yang bisa lihat & pakai) + "otak" karakter
create table if not exists public.ai_characters (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 40),
  mbti        text not null check (mbti ~ '^[EI][SN][TF][JP]$'),
  avatar      jsonb not null default '{}'::jsonb,   -- {kind:"chibi",hair,skin,hc,prop} atau {kind:"image",data:"data:image/jpeg;base64,..."}
  profile     jsonb not null default '{}'::jsonb,   -- jawaban 12 pertanyaan + label, gaya, ciri khas, larangan
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ai_characters_user_idx on public.ai_characters (user_id, created_at desc);

create table if not exists public.ai_character_memory (
  id            bigserial primary key,
  character_id  uuid not null references public.ai_characters (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind          text not null check (kind in ('knowledge', 'example', 'correction')),
  title         text check (char_length(title) <= 200),
  content       text not null check (char_length(content) between 1 and 60000),
  created_at    timestamptz not null default now()
);
create index if not exists ai_character_memory_char_idx on public.ai_character_memory (character_id, kind, created_at desc);

grant select, insert, update, delete on public.ai_characters, public.ai_character_memory to authenticated;
grant usage, select on sequence public.ai_character_memory_id_seq to authenticated;

alter table public.ai_characters enable row level security;
alter table public.ai_character_memory enable row level security;

drop policy if exists "ai_characters_own" on public.ai_characters;
create policy "ai_characters_own" on public.ai_characters for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "ai_character_memory_own" on public.ai_character_memory;
create policy "ai_character_memory_own" on public.ai_character_memory for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.ai_characters c where c.id = character_id and c.user_id = auth.uid()));

-- jawaban AI dari karakter buatan sendiri (untuk tombol 👍 / koreksi / ingat ini)
alter table public.ai_messages add column if not exists character_id uuid references public.ai_characters (id) on delete set null;

notify pgrst, 'reload schema';
