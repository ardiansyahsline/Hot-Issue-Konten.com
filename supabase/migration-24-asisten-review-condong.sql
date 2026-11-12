-- =====================================================================================================
-- migration-24 — Asisten Review Video: CONDONG AI (approve/reject + keyakinan) per hasil video
-- Jalankan SESUDAH migration-23-asisten-review.sql. Idempoten (aman dijalankan berulang).
--
-- Tiap video yang dinilai AI kini selalu punya pendapat AI sendiri:
--   ai_lean            'approve' | 'reject' | null   (null = AI gagal / menolak / video tidak bisa diakses / baris lama)
--   ai_lean_confidence 0..100 (worker menulis 50..100; 50 = setengah-setengah) — null bila ai_lean null
-- Terpisah dari suggestion (approve / reject / cek_manusia) yang tetap dipakai alur reviewer & metrik lama.
--
-- RLS: tidak ada policy baru — kolom ikut policy tabel review_results (baca = can_use_asisten_review(); tulis = laptop
-- service role). Realtime: tabel sudah ada di publikasi supabase_realtime (migration-23).
-- Laptop & website tetap jalan kalau file ini BELUM dijalankan (laptop menyimpan tanpa kolom ini, website tanpa condong).
-- =====================================================================================================

alter table public.review_results add column if not exists ai_lean text;
alter table public.review_results add column if not exists ai_lean_confidence smallint;

-- constraint dibuat ulang supaya definisinya selalu yang terbaru (idempoten)
alter table public.review_results drop constraint if exists review_results_ai_lean_check;
alter table public.review_results add constraint review_results_ai_lean_check
  check (ai_lean is null or ai_lean in ('approve', 'reject'));

alter table public.review_results drop constraint if exists review_results_ai_lean_confidence_check;
alter table public.review_results add constraint review_results_ai_lean_confidence_check
  check (ai_lean_confidence is null or ai_lean_confidence between 0 and 100);

-- condong & keyakinan selalu berpasangan (keduanya ada atau keduanya null)
alter table public.review_results drop constraint if exists review_results_ai_lean_pair_check;
alter table public.review_results add constraint review_results_ai_lean_pair_check
  check ((ai_lean is null) = (ai_lean_confidence is null));

comment on column public.review_results.ai_lean is
  'Condong AI sendiri: approve / reject (null = tidak ada condong: AI gagal / menolak / video tidak bisa diakses / baris lama)';
comment on column public.review_results.ai_lean_confidence is
  'Keyakinan condong AI 0..100 (worker menulis 50..100; 50 = setengah-setengah). Null bila ai_lean null';

-- filter halaman Hasil: per run + condong + rentang keyakinan
create index if not exists review_results_lean_idx
  on public.review_results (run_id, ai_lean, ai_lean_confidence)
  where ai_lean is not null;

-- PostgREST membaca ulang skema (kolom baru langsung bisa dipakai tanpa restart)
notify pgrst, 'reload schema';
