-- DB replika PALSU (schema alif) untuk selftest_inti.py — data FIKTIF, bukan data Konten.com.
-- Nama kolom = tebakan kolom.toml + kolom "pribadi" (username / email / phone) yang TIDAK BOLEH pernah dibaca worker.
-- Tipe sengaja campur (id video bigint, id campaign uuid, audit_log.target_id teks) untuk menguji cast id.
drop schema if exists alif cascade;
create schema alif;

create table alif.campaigns (
  id uuid primary key,
  title text, brand text, status text, rules text, hashtags text[], min_video_duration int,
  brief_detail jsonb, brief_instructions text, brief_dos text, source_video_url text,
  owner_email text                                   -- pribadi: tidak dipetakan
);

create table alif.tracked_videos (
  id bigint primary key,
  campaign_id uuid references alif.campaigns (id),
  video_url text, platform text, status text, caption text, hashtags jsonb, hashtag_present boolean,
  bot_score real, current_views bigint, duration real, created_at timestamptz,
  reject_reason_code text, rejection_reason text,
  username text, clipper_email text, clipper_phone text   -- pribadi: tidak dipetakan
);

create table alif.audit_log (
  id bigserial primary key, action text, details jsonb, user_id uuid, created_at timestamptz, target_id text, target_type text
);
create table alif.staff (id uuid primary key, user_id uuid, full_name text, email text);
create table alif.appeals (id bigserial primary key, video_id bigint, status text, created_at timestamptz, resolved_at timestamptz,
                           note text);
create table alif.video_status_history (video_id bigint, status text, created_at timestamptz);

insert into alif.campaigns values
 ('11111111-1111-4111-8111-111111111111', 'Film Contoh Satu', 'Studio Fiktif', 'active', 'Wajib sebut judul', '{#filmsatu}', 15,
  '{"elemenWajib": ["Sebut judul film"], "cta": "Ajak nonton di bioskop", "hashtags": ["#filmsatu"], "durasiMin": 15, "durasiMax": "60",
    "materi": "https://drive.google.com/drive/folders/xxxx"}', '', '', null, 'brand@fiktif.test'),
 ('22222222-2222-4222-8222-222222222222', 'Film Contoh Dua', 'Studio Fiktif', 'completed', null, '{#filmdua}', 10,
  '{"elemenWajib": "Tampilkan poster", "dilarangDilakukan": ["Spoiler ending"], "durasiMin": 10}', '', '', null, null),
 ('33333333-3333-4333-8333-333333333333', 'Film Tanpa Brief', 'Studio Fiktif', 'active', null, null, null, null, '', '', null, null);

-- 30 video: id 5001..5030, url berisi username fiktif (harus dibuang), caption berisi no HP & @handle fiktif
insert into alif.tracked_videos
select 5000 + g,
       case when g % 3 = 0 then '33333333-3333-4333-8333-333333333333'::uuid when g % 2 = 0 then '22222222-2222-4222-8222-222222222222'::uuid
            else '11111111-1111-4111-8111-111111111111'::uuid end,
       case when g % 5 = 0 then 'https://www.instagram.com/reel/CxFiktif' || g || '/'
            else 'https://www.tiktok.com/@clipper.fiktif' || g || '/video/' || (7300000000000000000 + g)::text end,
       case when g % 5 = 0 then 'instagram' else 'tiktok' end,
       case when g % 4 = 0 then 'rejected' when g % 7 = 0 then 'pending' else 'approved' end,
       'Nonton yuk! #FilmSatu hubungi 0812-0000-' || lpad(g::text, 4, '0') || ' @clipper.fiktif' || g,
       '["#FilmSatu", "#seru"]'::jsonb, true, 0.05 * (g % 10), 1000 * g, 12 + g,
       now() - ((g * 3) || ' days')::interval, null, null,
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
       now() - ((g * 3) || ' days')::interval + interval '2 hours', (5000 + g)::text, 'video'
from generate_series(1, 30) g where g % 7 <> 0;
insert into alif.audit_log (action, details, user_id, created_at, target_id, target_type)
values ('video_approve', '{"reason": null}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now() - interval '11 days', '5004', 'video'),
       ('campaign_update', '{"reason": "bukan video"}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', now() - interval '3 days', 'x-1', 'campaign');

insert into alif.staff values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'Nama Reviewer Fiktif', 'rev@fiktif.test');
-- banding: 5008 diterima (keputusan reject dibatalkan), 5012 ditolak (dikuatkan), 5016 menunggu
insert into alif.appeals (video_id, status, created_at, note) values
 (5008, 'pending', now() - interval '20 days', 'banding lama'),
 (5008, 'accepted', now() - interval '19 days', 'oleh @clipper.fiktif8'),
 (5012, 'rejected', now() - interval '30 days', null),
 (5016, 'pending', now() - interval '40 days', null);
insert into alif.video_status_history select id, status, created_at from alif.tracked_videos;
