-- =====================================================================
-- UPDATE 15 — Tab AI: kirim gambar (analisa chart/screenshot) + tanda "pakai data CS Tracker"
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-13. Aman dijalankan ulang.
-- Gambar disimpan di bucket privat `lampiran` folder <user>/ai/ (hanya pemiliknya yang bisa buka).
-- =====================================================================

alter table public.ai_messages add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.ai_messages add column if not exists used_data boolean not null default false;

notify pgrst, 'reload schema';
