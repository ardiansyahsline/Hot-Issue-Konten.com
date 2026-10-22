-- =====================================================================
-- UPDATE 18 — Tab AI: catatan hero/model mana yang benar-benar jalan
-- Daftar model OmniRoute berisi SEMUA model di katalog, termasuk provider yang belum disambungkan.
-- Tabel ini mencatat model yang berhasil / gagal supaya Layla memilih yang terbukti jalan dulu.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-14. Aman dijalankan ulang.
-- =====================================================================

create table if not exists public.ai_model_health (
  model       text primary key,
  ok_at       timestamptz,
  fail_at     timestamptz,
  fail_count  int not null default 0,
  last_error  text check (char_length(last_error) <= 300),
  updated_at  timestamptz not null default now()
);

grant select, insert, update on public.ai_model_health to authenticated;
alter table public.ai_model_health enable row level security;
drop policy if exists "aimh_read" on public.ai_model_health;
create policy "aimh_read" on public.ai_model_health for select to authenticated using (true);
drop policy if exists "aimh_write" on public.ai_model_health;
create policy "aimh_write" on public.ai_model_health for insert to authenticated with check (true);
drop policy if exists "aimh_update" on public.ai_model_health;
create policy "aimh_update" on public.ai_model_health for update to authenticated using (true) with check (true);

notify pgrst, 'reload schema';
