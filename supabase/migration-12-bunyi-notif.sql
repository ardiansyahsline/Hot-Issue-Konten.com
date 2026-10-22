-- =====================================================================
-- UPDATE 13 — Pilihan bunyi notifikasi per user
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-11. Aman dijalankan ulang.
-- =====================================================================

alter table public.notification_prefs add column if not exists sound_on boolean not null default true;
alter table public.notification_prefs add column if not exists sound_chat text not null default 'pop';
alter table public.notification_prefs add column if not exists sound_mention text not null default 'tritone';
alter table public.notification_prefs add column if not exists sound_issue text not null default 'alarm';
alter table public.notification_prefs add column if not exists sound_volume int not null default 70;

alter table public.notification_prefs drop constraint if exists notification_prefs_sound_check;
alter table public.notification_prefs add constraint notification_prefs_sound_check check (
  sound_chat in ('ding', 'pop', 'chime', 'bell', 'tritone', 'alarm', 'off')
  and sound_mention in ('ding', 'pop', 'chime', 'bell', 'tritone', 'alarm', 'off')
  and sound_issue in ('ding', 'pop', 'chime', 'bell', 'tritone', 'alarm', 'off')
  and sound_volume between 0 and 100
);

notify pgrst, 'reload schema';
