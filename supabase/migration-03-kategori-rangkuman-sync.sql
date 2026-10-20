-- =====================================================================
-- UPDATE 03 — kategori otomatis, catatan rangkuman, sync dari Google Sheet
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-02.
-- Aman dijalankan ulang. Tidak ada data yang dihapus.
-- =====================================================================

-- ---------- 1. Isi kategori otomatis untuk kasus yang masih kosong ----------
-- (aturan yang sama ada di lib/videoReview.ts -> VR_CATEGORY_RULES)
update public.video_reviews v
set category = case
  when explanation ~* '(saldo|dibekukan|freeze|frozen)' then 'Saldo dibekukan (cek/menanyakan)'
  when explanation ~* 'refresh' then 'Refresh views top clipper'
  when explanation ~* 'mis+kom' then 'Misskom info brief'
  when explanation ~* '(komplain|complain|berbeda platform|beda platform)' then 'Komplain'
  when explanation ~* '(melewati\s+(batas|estimasi)|lewat\s+(batas|estimasi)|tertunda|pending|belum\s+(di)?rilis|estimasi waktu)'
    then 'Review/rilis melewati estimasi waktu'
  when explanation ~* '(banding|appeal)' then 'Pengajuan banding'
  when explanation ~* '(kesesuaian|sesuai brief|ketentuan brief|alasan (penolakan|reject|ditolak)|alasan.*tolak|\ycta\y|reject|ditolak|perubahan brief)'
    then 'Kesesuaian video dengan brief'
  when explanation ~* '(review|tinjau)' then 'Permintaan review video'
  else 'Lainnya'
end
where category is null;

-- ---------- 2. Kunci baru untuk data hasil import (supaya sync bisa UPDATE, bukan dobel) ----------
-- Kunci = tanggal + penjelasan + link pertama (+ urutan kalau kembar). Sama dengan lib/videoReview.ts -> sheetBaseKey
with base as (
  select
    v.id,
    v.report_date::text || '|' || lower(btrim(v.explanation)) || '|' ||
      coalesce((select lower(btrim(l.value)) from public.video_review_links l where l.review_id = v.id order by l.id limit 1), '') as k
  from public.video_reviews v
  where v.source_key like 'sheet:%'
),
numbered as (
  select id, k, row_number() over (partition by k order by id) as rn from base
)
update public.video_reviews v
set source_key = 's2:' || md5(n.k) || case when n.rn > 1 then ':' || n.rn else '' end
from numbered n
where v.id = n.id
  and not exists (
    select 1 from public.video_reviews x
    where x.source_key = 's2:' || md5(n.k) || case when n.rn > 1 then ':' || n.rn else '' end
  );

-- ---------- 3. Catatan rangkuman manual per kategori (opsional, di samping rangkuman otomatis) ----------
create table if not exists public.video_review_category_notes (
  category    text primary key,
  note        text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_at  timestamptz not null default now()
);

create or replace function public.vr_notes_before_write()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists vr_notes_before_write on public.video_review_category_notes;
create trigger vr_notes_before_write
  before insert or update on public.video_review_category_notes
  for each row execute function public.vr_notes_before_write();

alter table public.video_review_category_notes enable row level security;
drop policy if exists "vrn_select" on public.video_review_category_notes;
create policy "vrn_select" on public.video_review_category_notes for select to authenticated using (true);
drop policy if exists "vrn_insert" on public.video_review_category_notes;
create policy "vrn_insert" on public.video_review_category_notes for insert to authenticated with check (public.can_write_reviews());
drop policy if exists "vrn_update" on public.video_review_category_notes;
create policy "vrn_update" on public.video_review_category_notes for update to authenticated
  using (public.can_write_reviews()) with check (public.can_write_reviews());

grant select, insert, update on public.video_review_category_notes to authenticated;
revoke all on public.video_review_category_notes from anon;
