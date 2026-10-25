-- =====================================================================
-- UPDATE 20 — Studio Pro: akses Studio (diatur admin, maks 3 orang), proyek video + chat AI Sutradara,
-- bank suara, antrian suara & render untuk mesin di laptop (voice-worker), SFX tambahan.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-19. Aman dijalankan ulang.
-- File audio/video disimpan di bucket PRIVAT "studio" (hanya admin & user yang diberi akses Studio).
-- =====================================================================

-- ---------- 1. Akses Studio ----------
create table if not exists public.studio_access (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  granted_by  uuid references public.profiles (id) on delete set null,
  granted_at  timestamptz not null default now()
);

create table if not exists public.studio_access_log (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  user_name  text,
  action     text not null check (action in ('grant', 'revoke')),
  by_id      uuid,
  by_name    text,
  at         timestamptz not null default now()
);
create index if not exists studio_access_log_at_idx on public.studio_access_log (at desc);

-- admin selalu boleh; user lain hanya kalau ada di studio_access
create or replace function public.can_use_studio(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and (
    exists (select 1 from public.profiles where id = uid and role = 'admin')
    or exists (select 1 from public.studio_access where user_id = uid)
  );
$$;
grant execute on function public.can_use_studio(uuid) to authenticated;

-- maksimal 3 orang (admin tidak dihitung & tidak perlu didaftarkan)
create or replace function public.studio_access_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'Admin sudah otomatis punya akses Studio' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtext('studio_access_limit'));
  if (select count(*) from public.studio_access where user_id <> new.user_id) >= 3 then
    raise exception 'Akses Studio maksimal 3 orang (di luar admin)' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists studio_access_limit on public.studio_access;
create trigger studio_access_limit before insert on public.studio_access
  for each row execute function public.studio_access_limit();

alter table public.studio_access enable row level security;
alter table public.studio_access_log enable row level security;
grant select, insert, delete on public.studio_access to authenticated;
grant select, insert on public.studio_access_log to authenticated;

drop policy if exists "studio_access_read" on public.studio_access;
create policy "studio_access_read" on public.studio_access for select to authenticated
  using (public.is_admin() or user_id = auth.uid());
drop policy if exists "studio_access_admin_insert" on public.studio_access;
create policy "studio_access_admin_insert" on public.studio_access for insert to authenticated
  with check (public.is_admin());
drop policy if exists "studio_access_admin_delete" on public.studio_access;
create policy "studio_access_admin_delete" on public.studio_access for delete to authenticated
  using (public.is_admin());

drop policy if exists "studio_access_log_admin" on public.studio_access_log;
create policy "studio_access_log_admin" on public.studio_access_log for select to authenticated
  using (public.is_admin());
drop policy if exists "studio_access_log_admin_insert" on public.studio_access_log;
create policy "studio_access_log_admin_insert" on public.studio_access_log for insert to authenticated
  with check (public.is_admin() and by_id = auth.uid());

-- ---------- 2. Proyek video + percakapan dengan AI Sutradara ----------
create table if not exists public.studio_projects (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title       text not null default 'Video baru' check (char_length(title) <= 120),
  timeline    jsonb,                                    -- TIMELINE JSON terakhir (lib/studio/timeline.ts)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists studio_projects_owner_idx on public.studio_projects (owner, updated_at desc);

create table if not exists public.studio_messages (
  id           bigint generated always as identity primary key,
  project_id   uuid not null references public.studio_projects (id) on delete cascade,
  role         text not null check (role in ('user', 'assistant')),
  content      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,      -- [{path, kind, name}]
  persona      text,
  model        text,
  error        boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists studio_messages_project_idx on public.studio_messages (project_id, id);

alter table public.studio_projects enable row level security;
alter table public.studio_messages enable row level security;
grant select, insert, update, delete on public.studio_projects, public.studio_messages to authenticated;

drop policy if exists "studio_projects_own" on public.studio_projects;
create policy "studio_projects_own" on public.studio_projects for all to authenticated
  using (public.can_use_studio() and (owner = auth.uid() or public.is_admin()))
  with check (public.can_use_studio() and owner = auth.uid());

drop policy if exists "studio_messages_own" on public.studio_messages;
create policy "studio_messages_own" on public.studio_messages for all to authenticated
  using (exists (select 1 from public.studio_projects p where p.id = project_id and public.can_use_studio() and (p.owner = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.studio_projects p where p.id = project_id and public.can_use_studio() and p.owner = auth.uid()));

-- ---------- 3. Bank suara (hanya suara milik sendiri / yang sudah memberi izin) ----------
create table if not exists public.studio_voices (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid default auth.uid() references public.profiles (id) on delete set null,
  name        text not null check (char_length(name) between 1 and 60),
  style       text check (char_length(style) <= 80),
  transcript  text check (char_length(transcript) <= 2000),
  consent     boolean not null check (consent),          -- wajib centang "saya pemilik suara / sudah dapat izin"
  consent_at  timestamptz not null default now(),
  raw_path    text not null,                             -- studio/voices/<id>/raw.<ext>
  clean_path  text,                                      -- hasil pembersih: klip 8–10 dtk terbaik, -20 LUFS
  quality     jsonb,                                     -- {noise:"rendah|sedang|tinggi", snr_db, lufs, dur, saran}
  status      text not null default 'baru' check (status in ('baru', 'diproses', 'siap', 'gagal')),
  seed_key    text unique,                               -- bank bawaan dari voice-worker/bank-suara (alif-energik, alif-tenang)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.studio_voices enable row level security;
grant select, insert, update, delete on public.studio_voices to authenticated;
drop policy if exists "studio_voices_read" on public.studio_voices;
create policy "studio_voices_read" on public.studio_voices for select to authenticated using (public.can_use_studio());
drop policy if exists "studio_voices_insert" on public.studio_voices;
create policy "studio_voices_insert" on public.studio_voices for insert to authenticated
  with check (public.can_use_studio() and consent and owner = auth.uid());
drop policy if exists "studio_voices_update" on public.studio_voices;
create policy "studio_voices_update" on public.studio_voices for update to authenticated
  using (public.can_use_studio() and (owner = auth.uid() or public.is_admin()))
  with check (public.can_use_studio() and consent);
drop policy if exists "studio_voices_delete" on public.studio_voices;
create policy "studio_voices_delete" on public.studio_voices for delete to authenticated
  using (public.can_use_studio() and (owner = auth.uid() or public.is_admin()));

-- ---------- 4. Antrian suara (dikerjakan voice-worker di laptop, satu per satu) ----------
create table if not exists public.studio_voice_jobs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.studio_projects (id) on delete cascade,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  kind         text not null default 'tts' check (kind in ('tts', 'clean', 'beats')),   -- clean = bersihkan referensi bank suara, beats = deteksi BPM/ketukan musik
  voice_id     uuid references public.studio_voices (id) on delete set null,
  engine       text not null default 'auto' check (engine in ('auto', 'chatterbox', 'pocket')),
  lines        jsonb not null default '[]'::jsonb,       -- [{id, scene_id, text, spell, start}]  start = detik di video (untuk VO lengkap .mp3)
  settings     jsonb not null default '{}'::jsonb,       -- tts: {exaggeration, cfg_weight, takes}; beats: {src: path storage / "asset:music/<file>"}
  status       text not null default 'antri' check (status in ('antri', 'proses', 'selesai', 'gagal', 'batal')),
  progress     real not null default 0 check (progress between 0 and 1),
  message      text,
  engine_used  text,
  result       jsonb,                                    -- tts: {lines:[{id, scene_id, path, dur, words:[{w,s,e}]}], full_path, srt_path}; beats: {bpm, beats:[detik], lufs, dur}
  cache_key    text,
  worker       text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists studio_voice_jobs_queue_idx on public.studio_voice_jobs (status, created_at);
create index if not exists studio_voice_jobs_cache_idx on public.studio_voice_jobs (cache_key) where status = 'selesai';

-- ---------- 5. Antrian render MP4 di laptop (alternatif gratis selain render di browser) ----------
create table if not exists public.studio_render_jobs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.studio_projects (id) on delete cascade,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  timeline     jsonb not null,
  variant      text not null default 'vo' check (variant in ('vo', 'tanpa-vo')),
  status       text not null default 'antri' check (status in ('antri', 'proses', 'selesai', 'gagal', 'batal')),
  progress     real not null default 0 check (progress between 0 and 1),
  message      text,
  result_path  text,                                     -- studio/renders/<id>.mp4
  worker       text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists studio_render_jobs_queue_idx on public.studio_render_jobs (status, created_at);

alter table public.studio_voice_jobs enable row level security;
alter table public.studio_render_jobs enable row level security;
grant select, insert, update on public.studio_voice_jobs, public.studio_render_jobs to authenticated;

-- user Studio boleh membuat & melihat antriannya sendiri, dan membatalkan (status 'batal'); worker memakai service role
drop policy if exists "studio_voice_jobs_read" on public.studio_voice_jobs;
create policy "studio_voice_jobs_read" on public.studio_voice_jobs for select to authenticated
  -- job 'clean' (bank suara) dipakai bersama; job 'beats' berisi path upload pribadi -> hanya pemilik & admin
  using (public.can_use_studio() and (created_by = auth.uid() or public.is_admin() or kind = 'clean'));
drop policy if exists "studio_voice_jobs_insert" on public.studio_voice_jobs;
create policy "studio_voice_jobs_insert" on public.studio_voice_jobs for insert to authenticated
  with check (public.can_use_studio() and created_by = auth.uid() and status = 'antri');
drop policy if exists "studio_voice_jobs_cancel" on public.studio_voice_jobs;
create policy "studio_voice_jobs_cancel" on public.studio_voice_jobs for update to authenticated
  using (public.can_use_studio() and (created_by = auth.uid() or public.is_admin()))
  with check (status = 'batal');

drop policy if exists "studio_render_jobs_read" on public.studio_render_jobs;
create policy "studio_render_jobs_read" on public.studio_render_jobs for select to authenticated
  using (public.can_use_studio() and (created_by = auth.uid() or public.is_admin()));
drop policy if exists "studio_render_jobs_insert" on public.studio_render_jobs;
create policy "studio_render_jobs_insert" on public.studio_render_jobs for insert to authenticated
  with check (public.can_use_studio() and created_by = auth.uid() and status = 'antri');
drop policy if exists "studio_render_jobs_cancel" on public.studio_render_jobs;
create policy "studio_render_jobs_cancel" on public.studio_render_jobs for update to authenticated
  using (public.can_use_studio() and (created_by = auth.uid() or public.is_admin()))
  with check (status = 'batal');

-- ---------- 6. Status worker laptop (detak jantung tiap ±20 dtk) ----------
create table if not exists public.studio_workers (
  id         text primary key,
  last_seen  timestamptz not null default now(),
  info       jsonb not null default '{}'::jsonb          -- {gpu, vram_gb, engine, versi, antrian}
);
alter table public.studio_workers enable row level security;
grant select on public.studio_workers to authenticated;
drop policy if exists "studio_workers_read" on public.studio_workers;
create policy "studio_workers_read" on public.studio_workers for select to authenticated using (public.can_use_studio());
-- jam detak jantung diisi jam database (bukan jam laptop yang bisa meleset); penanda "mati" (tahun 2000) tetap dipakai apa adanya
create or replace function public.studio_workers_stamp()
returns trigger language plpgsql as $$
begin
  if new.last_seen > timestamptz '2001-01-01' then new.last_seen := now(); end if;
  return new;
end $$;
drop trigger if exists studio_workers_stamp on public.studio_workers;
create trigger studio_workers_stamp before insert or update on public.studio_workers for each row execute function public.studio_workers_stamp();

-- ---------- 7. SFX tambahan (dari script Sonniss lokal / Freesound CC0) ----------
create table if not exists public.studio_sfx (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  path        text not null,                             -- studio/sfx/<id>.mp3
  cat         text not null default 'ui',
  tags        text[] not null default '{}',
  dur         real not null default 1,
  lufs        real not null default -20,
  tp          real not null default -3,
  hit         real not null default 0,
  peak        real not null default 0,
  use_for     text,
  source      text,                                      -- 'sonniss' | 'freesound'
  license     text,
  credit      text,
  created_by  uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.studio_sfx enable row level security;
-- tambah SFX hanya lewat server (route freesound / script worker, service role) supaya cek lisensi CC0 tidak bisa dilewati
grant select, delete on public.studio_sfx to authenticated;
revoke insert on public.studio_sfx from authenticated;
drop policy if exists "studio_sfx_read" on public.studio_sfx;
create policy "studio_sfx_read" on public.studio_sfx for select to authenticated using (public.can_use_studio());
drop policy if exists "studio_sfx_insert" on public.studio_sfx;
drop policy if exists "studio_sfx_delete" on public.studio_sfx;
create policy "studio_sfx_delete" on public.studio_sfx for delete to authenticated using (public.is_admin());

-- ---------- 8. updated_at otomatis ----------
create or replace function public.studio_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_projects_touch on public.studio_projects;
create trigger studio_projects_touch before update on public.studio_projects for each row execute function public.studio_touch();
drop trigger if exists studio_voices_touch on public.studio_voices;
create trigger studio_voices_touch before update on public.studio_voices for each row execute function public.studio_touch();
drop trigger if exists studio_voice_jobs_touch on public.studio_voice_jobs;
create trigger studio_voice_jobs_touch before update on public.studio_voice_jobs for each row execute function public.studio_touch();
drop trigger if exists studio_render_jobs_touch on public.studio_render_jobs;
create trigger studio_render_jobs_touch before update on public.studio_render_jobs for each row execute function public.studio_touch();

-- ---------- 9. Bucket penyimpanan privat "studio" (maks 200 MB per file) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'studio', 'studio', false, 209715200,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/flac',
    'video/mp4', 'video/webm', 'video/quicktime',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
    'application/json', 'text/plain', 'application/x-subrip', 'text/html'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- hanya admin & user yang diberi akses Studio. Upload user ke folder uploads/<id-nya>/ atau voices/; sisanya ditulis worker (service role)
-- baca: admin semua; voices/ sfx/ tts/ vo/ dipakai bersama (cache TTS worker membagi hasil vo/ antar user);
-- uploads/ hanya folder milik sendiri; renders/ hanya kalau baris studio_render_jobs-nya milik sendiri.
-- Route /api/studio/file menerapkan aturan yang sama sebelum menandatangani URL dengan service role.
drop policy if exists "studio_read" on storage.objects;
create policy "studio_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'studio' and public.can_use_studio()
    and (
      public.is_admin()
      or (storage.foldername(name))[1] in ('voices', 'sfx', 'tts', 'vo')
      or (storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text
      -- objects.name ditulis lengkap supaya tidak tertukar dengan kolom tabel di dalam subquery
      or (storage.foldername(name))[1] = 'renders' and exists (
        select 1 from public.studio_render_jobs j where j.result_path = objects.name and j.created_by = auth.uid()
      )
    )
  );
drop policy if exists "studio_upload" on storage.objects;
create policy "studio_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'studio' and public.can_use_studio()
    and ((storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text
         or (storage.foldername(name))[1] = 'voices')
  );
drop policy if exists "studio_delete" on storage.objects;
create policy "studio_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'studio' and public.can_use_studio()
    and (
      (storage.foldername(name))[1] = 'uploads' and (storage.foldername(name))[2] = auth.uid()::text
      -- rekaman bank suara: boleh dihapus kalau bukan milik orang lain (pemilik menghapus suaranya).
      -- objects.name ditulis lengkap: studio_voices juga punya kolom "name"
      or (storage.foldername(objects.name))[1] = 'voices' and not exists (
        select 1 from public.studio_voices v where v.id::text = (storage.foldername(objects.name))[2] and v.owner is distinct from auth.uid()
      )
      or public.is_admin()
    )
  );

-- ---------- 10. Realtime: progres antrian tampil langsung di website ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['studio_voice_jobs', 'studio_render_jobs', 'studio_workers', 'studio_voices'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
