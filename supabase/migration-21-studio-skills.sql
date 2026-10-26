-- =====================================================================
-- UPDATE 21 — Studio Pro: Library tim "Skill Studio" (kamus ejaan, suara, volume, sutradara, catatan gaya)
-- supaya referensi semua anggota Studio sama. Isi skill divalidasi server (lib/studio/skill.ts normSkill) sebelum disimpan.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-20. Aman dijalankan ulang.
-- Belum dijalankan? Unduh / impor skill lewat file .json tetap jalan; hanya Library tim yang belum aktif.
-- =====================================================================

create table if not exists public.studio_skills (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  description  text check (description is null or char_length(description) <= 300),
  data         jsonb not null check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 65536),   -- StudioSkill (maks 64 KB)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists studio_skills_created_idx on public.studio_skills (created_at desc);
create index if not exists studio_skills_owner_idx on public.studio_skills (owner);

alter table public.studio_skills enable row level security;
grant select, insert, update, delete on public.studio_skills to authenticated;

-- lihat: semua yang punya akses Studio (admin + user yang diberi akses) — sama dengan bank suara (studio_voices)
drop policy if exists "studio_skills_read" on public.studio_skills;
create policy "studio_skills_read" on public.studio_skills for select to authenticated
  using (public.can_use_studio());
-- tambah: hanya atas nama sendiri & punya akses Studio
drop policy if exists "studio_skills_insert" on public.studio_skills;
create policy "studio_skills_insert" on public.studio_skills for insert to authenticated
  with check (public.can_use_studio() and owner = auth.uid());
-- ubah / hapus: milik sendiri, atau admin
drop policy if exists "studio_skills_update" on public.studio_skills;
create policy "studio_skills_update" on public.studio_skills for update to authenticated
  using (public.can_use_studio() and (owner = auth.uid() or public.is_admin()))
  with check (public.can_use_studio() and (owner = auth.uid() or public.is_admin()));
drop policy if exists "studio_skills_delete" on public.studio_skills;
create policy "studio_skills_delete" on public.studio_skills for delete to authenticated
  using (public.can_use_studio() and (owner = auth.uid() or public.is_admin()));

-- updated_at otomatis (fungsi dari migration-20)
drop trigger if exists studio_skills_touch on public.studio_skills;
create trigger studio_skills_touch before update on public.studio_skills for each row execute function public.studio_touch();

notify pgrst, 'reload schema';
