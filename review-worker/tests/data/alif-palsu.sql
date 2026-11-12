-- DB replika PALSU (schema alif) untuk selftest_inti.py — data FIKTIF, bukan data Konten.com.
-- Nama kolom = skema ASLI Konten.com (`kenali-skema --nilai`, 12-11-2026; hanya kolom yang relevan) + kolom "pribadi"
-- (username / email / phone / name / notes / reason banding) yang TIDAK BOLEH pernah dibaca worker.
-- Tipe sengaja campur (id video bigint, id campaign uuid, audit_log.target_id & appeals.target_id teks) untuk menguji cast id.
drop schema if exists alif cascade;
create schema alif;

create table alif.campaigns (
  id uuid primary key,
  title text, brand text, status text, rules text[], hashtags text[], min_video_duration int,
  brief_detail jsonb, brief_instructions text, brief_dos text[], source_video_url text, brief_social_tags jsonb,
  owner_email text                                   -- pribadi: tidak dipetakan
);

create table alif.tracked_videos (
  id bigint primary key,
  campaign_id uuid references alif.campaigns (id),
  user_id uuid, platform text, video_url text, platform_video_id text, content_kind text, status text,
  submitted_at timestamptz, rejected_at timestamptz, reject_reason_code text, rejection_reason text, internal_notes text,
  current_views bigint, bot_score smallint, hashtag_present boolean, is_ads boolean, description text, updated_at timestamptz,
  username text, clipper_email text, clipper_phone text   -- pribadi: tidak dipetakan
);

create table alif.audit_log (
  id bigserial primary key, user_id uuid, user_role text, action text, target_type text, target_id text, details jsonb, created_at timestamptz
);
create table alif.staff (id uuid primary key, name text, role text, admin_role text);
-- banding: TIDAK ada kolom video_id — penghubungnya target_type + target_id
create table alif.appeals (
  id text primary key, user_id uuid, appeal_type text, target_type text, target_id text, reason text, status text,
  admin1_notes text, created_at timestamptz, resolved_at timestamptz, admin_decided_at timestamptz, resubmit_count int
);
create table alif.video_status_history (
  id uuid primary key default gen_random_uuid(), tracked_video_id text, from_status text, to_status text, reason text,
  changed_by uuid, changed_at timestamptz, reason_code text
);

insert into alif.campaigns values
 ('11111111-1111-4111-8111-111111111111', 'Film Contoh Satu', 'Studio Fiktif', 'active', '{"Wajib sebut judul"}', '{#filmsatu}', 15,
  '{"elemenWajib": ["Sebut judul film"], "cta": "Ajak nonton di bioskop", "hashtags": ["#filmsatu"], "durasiMin": 15, "durasiMax": "60",
    "durasiVideo": "15-60 detik", "tagSocialMedia": "@filmsatu.official", "jenisKampanye": "Film", "namaBrandArtist": "Studio Fiktif",
    "judulFile": "Film Contoh Satu - Trailer", "materi": "https://drive.google.com/drive/folders/xxxx"}', '', '{}', null, null,
  'brand@fiktif.test'),
 ('22222222-2222-4222-8222-222222222222', 'Film Contoh Dua', 'Studio Fiktif', 'completed', null, '{#filmdua}', 10,
  '{"elemenWajib": "Tampilkan poster", "dilarangDilakukan": ["Spoiler ending"], "durasiMin": "", "durasiMax": "", "durasiVideo": "min 10 detik",
    "tagSocialMedia": ""}', '', '{}', null, null, null),
 ('33333333-3333-4333-8333-333333333333', 'Film Tanpa Brief', 'Studio Fiktif', 'active', null, null, null, null, '', '{}', null, null, null);

-- 30 video: id 5001..5030, url berisi username fiktif (harus dibuang), caption (description) berisi no HP & @handle fiktif.
-- status asli: approved / approved_flag / rejected / pending_review
insert into alif.tracked_videos
select 5000 + g,
       case when g % 3 = 0 then '33333333-3333-4333-8333-333333333333'::uuid when g % 2 = 0 then '22222222-2222-4222-8222-222222222222'::uuid
            else '11111111-1111-4111-8111-111111111111'::uuid end,
       ('cccccccc-cccc-4ccc-8ccc-' || lpad(g::text, 12, '0'))::uuid,
       case when g % 5 = 0 then 'instagram' else 'tiktok' end,
       case when g % 5 = 0 then 'https://www.instagram.com/reel/CxFiktif' || g || '/'
            else 'https://www.tiktok.com/@clipper.fiktif' || g || '/video/' || (7300000000000000000 + g)::text end,
       case when g % 5 = 0 then 'CxFiktif' || g else (7300000000000000000 + g)::text end,
       'video',
       case when g % 4 = 0 then 'rejected' when g = 14 then 'approved_flag' when g % 7 = 0 then 'pending_review' else 'approved' end,
       now() - ((g * 3) || ' days')::interval, null, null, null, 'catatan admin @clipper.fiktif' || g,
       1000 * g, (g % 10)::smallint, true, g = 9,
       'Nonton yuk! #FilmSatu #seru hubungi 0812-0000-' || lpad(g::text, 4, '0') || ' @clipper.fiktif' || g, now(),
       'clipper.fiktif' || g, 'clipper' || g || '@fiktif.test', '0812' || lpad(g::text, 8, '0')
from generate_series(1, 30) g;

-- keputusan reviewer: approve / reject bergantian; video 5004 diputuskan dua kali (yang terakhir menang = approve)
insert into alif.audit_log (action, details, user_id, created_at, target_id, target_type)
select case when g % 4 = 0 then 'video_reject' else 'video_approve' end,
       case when g % 4 = 0 then jsonb_build_object('reason', (array['Konten tidak sesuai brief campaign', 'CTA wajib tidak ada',
                                                                    'Followers belum memenuhi syarat'])[1 + (g / 4) % 3],
                                                 'notes', 'catatan bebas berisi @clipper.fiktif dan 0812-1111-2222')
            else '{"notes": "oke"}'::jsonb end,
       case when g % 2 = 0 then 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid else 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid end,
       now() - ((g * 3) || ' days')::interval + interval '2 hours', (5000 + g)::text, 'tracked_video'
from generate_series(1, 30) g where g % 7 <> 0;
insert into alif.audit_log (action, details, user_id, created_at, target_id, target_type)
values ('video_approve', '{"reason": null}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now() - interval '11 days', '5004', 'tracked_video'),
       ('appeal_denied', '{"reason": "bukan keputusan video"}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now() - interval '29 days', 'ap-3', 'appeal'),
       ('campaign_update', '{"reason": "bukan video"}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now() - interval '3 days', 'x-1', 'campaign');

insert into alif.staff values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Nama Reviewer Fiktif', 'admin', 'reviewer');
-- banding (status asli: granted / denied / under_review / resubmit_allowed), penghubung target_type + target_id:
-- 5008 under_review lalu granted (dibatalkan), 5012 denied (dikuatkan), 5016 under_review (menunggu),
-- 5020 resubmit_allowed (dikuatkan: penolakan tetap), 5024 = banding PAYOUT (bukan video; ikut terbaca kalau banding_target kosong),
-- 5012 juga punya banding PAYOUT yang lebih baru (ap-7) — tanpa banding_target, banding video tetap didahulukan.
-- resolved_at / admin_decided_at = waktu banding diputuskan (ap-2 hanya admin_decided_at → cadangan COALESCE)
insert into alif.appeals (id, user_id, appeal_type, target_type, target_id, reason, status, admin1_notes, created_at, resolved_at, admin_decided_at) values
 ('ap-1', 'cccccccc-cccc-4ccc-8ccc-000000000008', 'video_reject', 'tracked_video', '5008', 'banding lama @clipper.fiktif8', 'under_review', null, now() - interval '20 days', null, null),
 ('ap-2', 'cccccccc-cccc-4ccc-8ccc-000000000008', 'video_reject', 'tracked_video', '5008', 'hubungi 0812-8888-0008', 'granted', 'ok', now() - interval '19 days', null, '2026-10-20T03:00:00+00'),
 ('ap-3', 'cccccccc-cccc-4ccc-8ccc-000000000012', 'video_reject', 'tracked_video', '5012', null, 'denied', 'catatan admin', now() - interval '30 days', '2026-10-01T03:00:00+00', '2026-09-30T03:00:00+00'),
 ('ap-4', 'cccccccc-cccc-4ccc-8ccc-000000000016', 'video_reject', 'tracked_video', '5016', null, 'under_review', null, now() - interval '40 days', null, null),
 ('ap-5', 'cccccccc-cccc-4ccc-8ccc-000000000020', 'video_reject', 'tracked_video', '5020', null, 'resubmit_allowed', null, now() - interval '50 days', null, null),
 ('ap-6', 'cccccccc-cccc-4ccc-8ccc-000000000024', 'payout', 'payout', '5024', null, 'granted', null, now() - interval '5 days', null, null),
 ('ap-7', 'cccccccc-cccc-4ccc-8ccc-000000000012', 'payout', 'payout', '5012', null, 'granted', null, now() - interval '2 days', null, null);
insert into alif.video_status_history (tracked_video_id, from_status, to_status, changed_at)
select id::text, 'pending_review', status, submitted_at from alif.tracked_videos;
