-- =====================================================================
-- UPDATE 23 — Asisten Review Video (MODE UJI / internal): AI di laptop (review-worker) membantu tim Video Review
-- mengecek video clipper vs brief campaign + musik/materi campaign. AI hanya MENYARANKAN, reviewer yang memutuskan.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-22. Aman dijalankan ulang.
-- Belum dijalankan? Website tetap jalan seperti biasa (tab Asisten Review tertutup untuk semua kecuali admin).
--
-- Tab "Asisten Review (Uji)" (id tab: asisten_review) = tab KHUSUS: bawaannya TERTUTUP, dibuka admin per user
-- (Admin → Akses tab per user). Disimpan di kolom baru user_tab_blocks.granted (daftar BUKA), bukan di blocked
-- (daftar TUTUP), supaya tab baru ini tidak otomatis terbuka untuk semua user. Admin selalu boleh.
-- Data Konten.com (database replika) TIDAK pernah ditulis: laptop hanya membaca, hasil AI disimpan di sini.
-- Yang disimpan: id video & id campaign (teks), judul campaign/brand, hasil AI, keputusan manusia, reviewer sebagai
-- pseudonim (bukan nama), umpan balik tim. TIDAK ada nama / email / no HP / username / link video clipper.
-- Laptop (review-worker) memakai service role (melewati RLS). File (materi referensi, laporan HTML) di bucket
-- PRIVAT "asisten-review".
-- =====================================================================

-- ---------- 1. Akses tab khusus (daftar BUKA) ----------
alter table public.user_tab_blocks add column if not exists granted text[] not null default '{}';

-- isi hanya id tab khusus yang dikenal (lib/tabs.ts: tab dengan optIn: true)
alter table public.user_tab_blocks drop constraint if exists user_tab_blocks_granted_known;
alter table public.user_tab_blocks add constraint user_tab_blocks_granted_known
  check (granted <@ array['asisten_review']::text[]);

-- stempel migration-22 diperluas: perubahan granted juga dicatat (updated_at / updated_by) & admin tidak perlu didaftarkan.
-- (Kalau migration-22 dijalankan ulang, versi lama kembali: hanya stempel granted yang hilang, akses tetap aman.)
create or replace function public.user_tab_blocks_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.blocked is not distinct from old.blocked and new.granted is not distinct from old.granted then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'Admin selalu bisa membuka semua tab' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
revoke execute on function public.user_tab_blocks_stamp() from public, anon;

-- boleh pakai Asisten Review? admin, atau dibuka admin (granted). Fungsi TERSENDIRI (bukan tab_allowed) supaya
-- menjalankan ulang migration-22 tidak membuka tab ini untuk semua orang.
create or replace function public.can_use_asisten_review(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select uid is not null and (
    exists (select 1 from public.profiles where id = uid and role = 'admin')
    or exists (select 1 from public.user_tab_blocks where user_id = uid and 'asisten_review' = any (granted))
  );
$$;
revoke execute on function public.can_use_asisten_review(uuid) from public, anon;
grant execute on function public.can_use_asisten_review(uuid) to authenticated;

-- ---------- 2. Campaign yang pernah diproses laptop (data BRAND, bukan data clipper) ----------
create table if not exists public.review_campaigns (
  campaign_id        text primary key check (campaign_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  title              text,
  brand              text,
  campaign_status    text,                                   -- status campaign di Konten.com (aktif / selesai / ...)
  brief_points       jsonb not null default '[]'::jsonb,     -- daftar poin brief hasil parser (review-worker/review_worker/brief.py)
  brief_hash         text,                                   -- sha256 brief_detail (berubah = brief diubah brand)
  duration_min       integer,                                -- detik (brief_detail.durasiMin)
  duration_max       integer,                                -- detik (brief_detail.durasiMax)
  materi_status      text not null default 'belum_dicek'
                     check (materi_status in ('belum_dicek', 'proses', 'ada', 'sebagian', 'belum_ada', 'gagal')),
  materi_message     text,                                   -- kalimat awam, mis. "Folder Google Drive private"
  materi_checked_at  timestamptz,
  last_seen_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------- 3. Daftar alasan reject resmi (unik dari audit_log.details.reason, disinkron laptop) ----------
create table if not exists public.review_reasons (
  label       text primary key,                              -- persis seperti di Konten.com
  code        text not null default 'lainnya'
              check (code in ('tidak_sesuai_brief', 'cta_tidak_ada', 'followers_kurang', 'engagement_bot',
                              'link_bio_tidak_ada', 'duplikat', 'tidak_bisa_diakses', 'lainnya')),
  uses        integer not null default 0,                    -- berapa kali dipakai reviewer (hasil sinkron)
  official    boolean not null default true,
  first_seen  timestamptz,
  last_seen   timestamptz,
  updated_at  timestamptz not null default now()
);
insert into public.review_reasons (label, code) values
  ('Konten tidak sesuai brief campaign', 'tidak_sesuai_brief'),
  ('CTA wajib tidak ada', 'cta_tidak_ada'),
  ('Followers belum memenuhi syarat', 'followers_kurang'),
  ('Engagement mencurigakan / bot', 'engagement_bot'),
  ('Link di bio belum ada', 'link_bio_tidak_ada'),
  ('Video duplikat / sudah disubmit', 'duplikat'),
  ('Video tidak bisa diakses', 'tidak_bisa_diakses')
on conflict (label) do nothing;

-- ---------- 4. Versi rubrik (diisi laptop; hasil per versi bisa dibandingkan) ----------
create table if not exists public.review_rubrics (
  version     text primary key,                              -- mis. "v1"
  hash        text not null,                                 -- 12 hex pertama sha256(rubrik + aturan kode + skema keluaran)
  notes       text,
  content     text,                                          -- isi rubrik (teks statis dari repo, tanpa data pribadi)
  created_at  timestamptz not null default now()
);

-- ---------- 5. Run uji akurasi ----------
create table if not exists public.review_runs (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid,                                       -- review_jobs.id (null = dijalankan dari CLI laptop)
  label          text,
  rubric_version text,
  rubric_hash    text,
  model          text,
  effort         text,
  sample_size    integer not null default 0,
  sample_params  jsonb not null default '{}'::jsonb,         -- {seed, dari, sampai, seimbang, maks_per_campaign, ...}
  sample         jsonb not null default '[]'::jsonb,         -- daftar id video Konten.com (teks) — id saja, tanpa link
  status         text not null default 'proses'
                 check (status in ('proses', 'selesai', 'gagal', 'batal', 'berhenti_biaya')),
  done           integer not null default 0,
  metrics        jsonb not null default '{}'::jsonb,         -- ringkasan akurasi + biaya (format: KONTRAK.md §6)
  cost_usd       numeric(12, 6) not null default 0,
  report_path    text,                                       -- bucket asisten-review: laporan/<id>.html
  worker         text,
  created_by     uuid references public.profiles (id) on delete set null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists review_runs_created_idx on public.review_runs (created_at desc);

-- ---------- 6. Antrian pekerjaan untuk laptop (satu pekerjaan sekaligus) ----------
create table if not exists public.review_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('uji', 'video', 'materi', 'sinkron')),
  -- uji: {jumlah: 50|500} | {lanjut_run: <uuid>} | {ulang_run: <uuid>}; video: {ref: {jenis: 'id'|'platform', platform?, nilai}}
  -- (TANPA link mentah / username); materi: {campaign_id, paksa?}; sinkron: {}
  params       jsonb not null default '{}'::jsonb,
  status       text not null default 'antri' check (status in ('antri', 'proses', 'selesai', 'gagal', 'batal')),
  progress     real not null default 0 check (progress between 0 and 1),
  message      text,                                         -- pesan awam; akhiran " · sisa ±N dtk|mnt" = perkiraan sisa
  done         integer not null default 0,
  total        integer not null default 0,
  run_id       uuid references public.review_runs (id) on delete set null,
  worker       text,
  created_by   uuid default auth.uid() references public.profiles (id) on delete set null,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists review_jobs_queue_idx on public.review_jobs (status, created_at);
-- klaim atomik (review_claim_job di bawah): paling banyak SATU uji akurasi 'proses' + SATU pekerjaan pendek 'proses'
-- (video / materi / sinkron). Laptop tetap mengerjakan satu per satu: pekerjaan pendek diselipkan di antara video uji,
-- jadi "cek 1 video" tidak menunggu uji 500 video selesai. Laptop kedua gagal klaim → menunggu.
drop index if exists public.review_jobs_one_running;
create unique index if not exists review_jobs_one_running_per_class on public.review_jobs ((kind = 'uji')) where status = 'proses';
-- satu uji akurasi menunggu sekaligus (tombol 50 / 500 diklik berkali-kali tidak menumpuk)
create unique index if not exists review_jobs_one_uji_waiting on public.review_jobs (kind) where status = 'antri' and kind = 'uji';

-- ambil 1 pekerjaan 'antri' secara atomik untuk laptop (service role saja). p_kinds = jenis yang mau diambil, urutan
-- prioritas: video → materi → sinkron → uji, lalu yang paling lama. Kosong = tidak ada / kelasnya sedang dikerjakan.
create or replace function public.review_claim_job(p_worker text, p_kinds text[] default array['video', 'materi', 'sinkron', 'uji'])
returns setof public.review_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.review_jobs;
begin
  select * into j from public.review_jobs
  where status = 'antri' and kind = any (p_kinds)
    and not exists (select 1 from public.review_jobs b where b.status = 'proses' and (b.kind = 'uji') = (review_jobs.kind = 'uji'))
  order by array_position(array['video', 'materi', 'sinkron', 'uji'], kind), created_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  begin
    update public.review_jobs
    set status = 'proses', worker = p_worker, started_at = now(), finished_at = null, progress = 0, message = 'Mulai diproses di laptop…'
    where id = j.id and status = 'antri'
    returning * into j;
  exception when unique_violation then
    return; -- laptop lain baru saja mengambil pekerjaan sekelas
  end;
  if j.id is not null then
    return next j;
  end if;
end;
$$;
revoke execute on function public.review_claim_job(text, text[]) from public, anon, authenticated;
grant execute on function public.review_claim_job(text, text[]) to service_role;

-- ---------- 7. Hasil per video ----------
create table if not exists public.review_results (
  id                 bigint generated always as identity primary key,
  scope              text not null,                          -- 'run:<run_id>' atau 'job:<job_id>' (kunci upsert laptop)
  run_id             uuid references public.review_runs (id) on delete cascade,
  job_id             uuid references public.review_jobs (id) on delete set null,
  video_id           text not null,                          -- id video di Konten.com (tracked_videos.id) sebagai teks
  platform           text,                                   -- tiktok / instagram / youtube / lainnya
  platform_video_id  text,                                   -- id video di platform (tanpa username) untuk membuka video
  campaign_id        text,
  campaign_title     text,
  brand              text,
  rubric_version     text,
  rubric_hash        text,
  model              text,
  pipeline_status    text not null default 'ok'
                     check (pipeline_status in ('ok', 'tidak_bisa_diakses', 'gagal', 'dilewati_biaya')),
  suggestion         text check (suggestion in ('approve', 'reject', 'cek_manusia')),
  confidence         smallint check (confidence between 0 and 100),
  official_reason    text,                                   -- label alasan resmi (review_reasons.label) kalau reject
  official_code      text,
  specific_reason    text,                                   -- 1 kalimat spesifik
  handoff_reasons    text[] not null default '{}',           -- kenapa diserahkan ke manusia (KONTRAK.md §5.4)
  checklist          jsonb not null default '[]'::jsonb,     -- per poin brief (KONTRAK.md §5.3)
  music              jsonb not null default '{}'::jsonb,     -- hasil cocok musik
  visual             jsonb not null default '{}'::jsonb,     -- kemiripan frame vs poster / trailer
  meta               jsonb not null default '{}'::jsonb,     -- durasi, jumlah hashtag, dsb. (tanpa data pribadi)
  human_decision     text check (human_decision in ('approve', 'reject')),
  human_reason       text,                                   -- label alasan resmi pilihan reviewer (tanpa catatan bebas)
  human_code         text,
  reviewer           text,                                   -- pseudonim "R-xxxxxx" (HMAC id staff di laptop), BUKAN nama
  decided_at         timestamptz,
  appeal             text check (appeal in ('dibatalkan', 'dikuatkan', 'menunggu')),
  final_truth        text check (final_truth in ('approve', 'reject')),
  match              boolean,                                -- saran AI = kebenaran akhir (null: cek_manusia / belum ada keputusan)
  cost_usd           numeric(10, 6) not null default 0,
  tokens             jsonb not null default '{}'::jsonb,     -- {input, output, cache_read, cache_write_1h, cache_write_5m}
  process_sec        real,
  stage_sec          jsonb not null default '{}'::jsonb,     -- {unduh, frame, asr, ocr, musik, visual, hakim}
  error              text,                                   -- pesan awam kalau pipeline gagal
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (scope, video_id)
);
create index if not exists review_results_run_idx on public.review_results (run_id, created_at desc);
create index if not exists review_results_job_idx on public.review_results (job_id);
create index if not exists review_results_campaign_idx on public.review_results (campaign_id);
create index if not exists review_results_created_idx on public.review_results (created_at desc);

-- ---------- 8. Umpan balik reviewer CS Tracker (Setuju / Tidak setuju + catatan) ----------
create table if not exists public.review_feedback (
  id          bigint generated always as identity primary key,
  result_id   bigint not null references public.review_results (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  agree       boolean not null,
  note        text check (note is null or char_length(note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (result_id, user_id)
);
create index if not exists review_feedback_result_idx on public.review_feedback (result_id);

-- ---------- 9. Materi referensi per campaign (lagu, poster, potongan trailer) ----------
create table if not exists public.review_materials (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   text not null check (campaign_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  kind          text not null check (kind in ('lagu', 'poster', 'trailer', 'lainnya')),
  source        text not null check (source in ('gdrive', 'manual')),
  status        text not null default 'antri_sidik' check (status in ('antri_sidik', 'proses', 'siap', 'gagal')),
  storage_path  text not null unique,                        -- bucket asisten-review: materi/<campaign>/(auto|manual)/<file>
  file_name     text,
  mime          text,
  size_bytes    bigint,
  duration_sec  real,
  sha256        text,
  fingerprint   jsonb not null default '{}'::jsonb,          -- {audio: {engine, ok}, image: {phash: [...], dhash: [...]}}
  message       text,
  created_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (campaign_id, sha256)
);
create index if not exists review_materials_campaign_idx on public.review_materials (campaign_id);
create index if not exists review_materials_status_idx on public.review_materials (status, created_at);

-- ---------- 10. Pemakaian biaya AI per hari (WIB) — batas REVIEW_DAILY_BUDGET_USD dicek laptop ----------
create table if not exists public.review_usage_daily (
  day                 date primary key,
  cost_usd            numeric(12, 6) not null default 0,
  calls               integer not null default 0,
  input_tokens        bigint not null default 0,
  output_tokens       bigint not null default 0,
  cache_read_tokens   bigint not null default 0,
  cache_write_tokens  bigint not null default 0,
  updated_at          timestamptz not null default now()
);

-- tambah pemakaian secara atomik, balikan total biaya hari itu (hanya laptop / service role)
create or replace function public.review_add_usage(
  p_day date, p_cost numeric, p_calls integer, p_input bigint, p_output bigint, p_cache_read bigint, p_cache_write bigint
)
returns numeric
language sql
security definer
set search_path = public
as $$
  insert into public.review_usage_daily as u (day, cost_usd, calls, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, updated_at)
  values (p_day, greatest(p_cost, 0), greatest(p_calls, 0), greatest(p_input, 0), greatest(p_output, 0),
          greatest(p_cache_read, 0), greatest(p_cache_write, 0), now())
  on conflict (day) do update set
    cost_usd = u.cost_usd + excluded.cost_usd,
    calls = u.calls + excluded.calls,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cache_read_tokens = u.cache_read_tokens + excluded.cache_read_tokens,
    cache_write_tokens = u.cache_write_tokens + excluded.cache_write_tokens,
    updated_at = now()
  returning cost_usd;
$$;
revoke execute on function public.review_add_usage(date, numeric, integer, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.review_add_usage(date, numeric, integer, bigint, bigint, bigint, bigint) to service_role;

-- ---------- 11. Status laptop (detak jantung tiap ±20 dtk; > 60 dtk = dianggap mati) ----------
create table if not exists public.review_workers (
  id         text primary key,
  last_seen  timestamptz not null default now(),
  info       jsonb not null default '{}'::jsonb              -- {status, job, versi, gpu, db, ai, musik, ocr, budget:{usd_hari_ini, batas}, rubric_version}
);
-- jam detak = jam database; penanda "mati" (tahun 2000) tetap apa adanya (pola studio_workers)
create or replace function public.review_workers_stamp()
returns trigger language plpgsql as $$
begin
  if new.last_seen > timestamptz '2001-01-01' then new.last_seen := now(); end if;
  return new;
end $$;
drop trigger if exists review_workers_stamp on public.review_workers;
create trigger review_workers_stamp before insert or update on public.review_workers for each row execute function public.review_workers_stamp();

-- ---------- 12. updated_at otomatis ----------
create or replace function public.review_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['review_campaigns', 'review_reasons', 'review_runs', 'review_jobs', 'review_results', 'review_feedback', 'review_materials'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.review_touch()', t || '_touch', t);
  end loop;
end;
$$;

-- ---------- 13. RLS: hanya admin & user yang dibuka tab Asisten Review; laptop memakai service role ----------
do $$
declare t text;
begin
  foreach t in array array['review_campaigns', 'review_reasons', 'review_rubrics', 'review_runs', 'review_jobs', 'review_results',
                           'review_feedback', 'review_materials', 'review_usage_daily', 'review_workers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.can_use_asisten_review()))', t || '_read', t);
  end loop;
end;
$$;

-- antrian: boleh membuat pekerjaan sendiri (uji 50 / 500, video tertentu, coba unduh materi lagi) & membatalkan
grant insert, update on public.review_jobs to authenticated;
drop policy if exists "review_jobs_insert" on public.review_jobs;
create policy "review_jobs_insert" on public.review_jobs for insert to authenticated
  with check (
    (select public.can_use_asisten_review()) and created_by = auth.uid() and status = 'antri'
    and progress = 0 and done = 0 and total = 0 and run_id is null and worker is null
    and kind in ('uji', 'video', 'materi')
    and char_length(params::text) <= 2000
    -- tanpa '@' sama sekali: link / username clipper tidak bisa ikut tersimpan
    and position('@' in params::text) = 0
    -- uji: 50 / 500 video, lanjutkan run yang terhenti, atau ulangi sampel run lama dengan rubrik terbaru
    and (kind <> 'uji' or params->>'jumlah' in ('50', '500') or params ? 'lanjut_run' or params ? 'ulang_run')
    and (kind <> 'video' or jsonb_typeof(params->'ref') = 'object')
    and (kind <> 'materi' or coalesce(params->>'campaign_id', '') ~ '^[A-Za-z0-9_-]{1,64}$')
  );
drop policy if exists "review_jobs_cancel" on public.review_jobs;
create policy "review_jobs_cancel" on public.review_jobs for update to authenticated
  using ((select public.can_use_asisten_review()) and status in ('antri', 'proses') and (created_by = auth.uid() or public.is_admin()))
  with check (status = 'batal');

-- run uji lama boleh dihapus admin (hasil per video ikut terhapus; laporan HTML di bucket dihapus website)
grant delete on public.review_runs to authenticated;
drop policy if exists "review_runs_admin_delete" on public.review_runs;
create policy "review_runs_admin_delete" on public.review_runs for delete to authenticated
  using (public.is_admin() and status <> 'proses');

-- umpan balik: milik sendiri
grant insert, update, delete on public.review_feedback to authenticated;
drop policy if exists "review_feedback_insert" on public.review_feedback;
create policy "review_feedback_insert" on public.review_feedback for insert to authenticated
  with check ((select public.can_use_asisten_review()) and user_id = auth.uid());
drop policy if exists "review_feedback_update" on public.review_feedback;
create policy "review_feedback_update" on public.review_feedback for update to authenticated
  using ((select public.can_use_asisten_review()) and user_id = auth.uid())
  with check ((select public.can_use_asisten_review()) and user_id = auth.uid());
drop policy if exists "review_feedback_delete" on public.review_feedback;
create policy "review_feedback_delete" on public.review_feedback for delete to authenticated
  using ((select public.can_use_asisten_review()) and user_id = auth.uid());

-- materi: upload manual dicatat website (sidik jari dibuat laptop); hapus hanya upload manual
grant insert, delete on public.review_materials to authenticated;
drop policy if exists "review_materials_insert" on public.review_materials;
create policy "review_materials_insert" on public.review_materials for insert to authenticated
  with check (
    (select public.can_use_asisten_review()) and created_by = auth.uid()
    and source = 'manual' and status = 'antri_sidik' and sha256 is null and fingerprint = '{}'::jsonb
    and storage_path like 'materi/' || campaign_id || '/manual/%'
  );
drop policy if exists "review_materials_delete" on public.review_materials;
create policy "review_materials_delete" on public.review_materials for delete to authenticated
  using ((select public.can_use_asisten_review()) and source = 'manual');

-- ---------- 14. Bucket penyimpanan PRIVAT "asisten-review" (maks 50 MB per file = batas Supabase gratis) ----------
-- materi/<campaign>/auto/...   = diunduh laptop dari Google Drive (hanya laptop yang menulis)
-- materi/<campaign>/manual/... = upload manual dari website
-- laporan/<run_id>.html        = laporan uji akurasi (ditulis laptop)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'asisten-review', 'asisten-review', false, 52428800,
  array[
    'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/flac', 'audio/webm',
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/webm', 'video/quicktime',
    'text/html', 'application/json'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "asisten_review_read" on storage.objects;
create policy "asisten_review_read" on storage.objects for select to authenticated
  using (bucket_id = 'asisten-review' and (select public.can_use_asisten_review()));
drop policy if exists "asisten_review_upload" on storage.objects;
create policy "asisten_review_upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'asisten-review' and (select public.can_use_asisten_review())
    and (storage.foldername(name))[1] = 'materi'
    and (storage.foldername(name))[2] ~ '^[A-Za-z0-9_-]{1,64}$'
    and (storage.foldername(name))[3] = 'manual'
    and array_length(storage.foldername(name), 1) = 3
  );
drop policy if exists "asisten_review_delete" on storage.objects;
create policy "asisten_review_delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'asisten-review' and (select public.can_use_asisten_review())
    and (storage.foldername(name))[1] = 'materi' and (storage.foldername(name))[3] = 'manual'
  );

-- ---------- 15. Realtime: progres uji, status laptop, hasil baru & status materi tampil langsung ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['review_jobs', 'review_workers', 'review_results', 'review_materials', 'review_runs'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

notify pgrst, 'reload schema';
