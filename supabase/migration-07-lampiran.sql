-- =====================================================================
-- UPDATE 07 — Lampiran bukti (gambar & dokumen) untuk Hot Issue dan Catatan & Saran
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-06. Aman dijalankan ulang.
-- File disimpan di Supabase Storage, bucket PRIVAT "lampiran" (hanya user yang login bisa lihat).
-- =====================================================================

-- ---------- 1. Bucket penyimpanan: privat, maks 10 MB per file ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lampiran', 'lampiran', false, 10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain'
  ]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Siapa boleh apa di bucket: lihat = semua yang login; upload = ke folder miliknya sendiri; hapus = pemilik / admin
drop policy if exists "lampiran_read" on storage.objects;
create policy "lampiran_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'lampiran');

drop policy if exists "lampiran_upload" on storage.objects;
create policy "lampiran_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'lampiran' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "lampiran_delete" on storage.objects;
create policy "lampiran_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'lampiran' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------- 2. Tabel lampiran: satu file menempel ke SATU tempat ----------
create table if not exists public.attachments (
  id                     bigint generated always as identity primary key,
  path                   text not null unique,            -- lokasi file di bucket: <user id>/<acak>.<ext>
  name                   text not null,                   -- nama file asli
  size                   bigint not null default 0,
  mime                   text,
  issue_id               bigint references public.issues (id) on delete cascade,
  issue_note_id          bigint references public.issue_notes (id) on delete cascade,
  suggestion_id          bigint references public.suggestions (id) on delete cascade,
  suggestion_comment_id  bigint references public.suggestion_comments (id) on delete cascade,
  created_by             uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at             timestamptz not null default now(),
  constraint attachments_one_parent
    check (num_nonnulls(issue_id, issue_note_id, suggestion_id, suggestion_comment_id) = 1)
);
create index if not exists attachments_issue_idx      on public.attachments (issue_id);
create index if not exists attachments_note_idx       on public.attachments (issue_note_id);
create index if not exists attachments_sg_idx         on public.attachments (suggestion_id);
create index if not exists attachments_comment_idx    on public.attachments (suggestion_comment_id);

-- yang upload selalu user yang login
create or replace function public.attachments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists attachments_before_insert on public.attachments;
create trigger attachments_before_insert
  before insert on public.attachments
  for each row execute function public.attachments_before_insert();

-- boleh menempelkan lampiran ke mana?
--   issue            -> role yang boleh input Hot Issue (admin, cs, video review, discord mod)
--   update issue     -> penulis update itu / admin
--   catatan & saran  -> penulis catatan / admin
--   tanggapan        -> penulis tanggapan / admin
create or replace function public.can_attach(p_issue bigint, p_note bigint, p_sg bigint, p_comment bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_issue is not null then public.can_write_issues()
    when p_note is not null then exists (
      select 1 from public.issue_notes n where n.id = p_note and (n.created_by = auth.uid() or public.is_admin()))
    when p_sg is not null then exists (
      select 1 from public.suggestions s where s.id = p_sg and (s.created_by = auth.uid() or public.is_admin()))
    when p_comment is not null then exists (
      select 1 from public.suggestion_comments c where c.id = p_comment and (c.created_by = auth.uid() or public.is_admin()))
    else false
  end;
$$;
grant execute on function public.can_attach(bigint, bigint, bigint, bigint) to authenticated;

alter table public.attachments enable row level security;

drop policy if exists "attachments_select" on public.attachments;
create policy "attachments_select" on public.attachments
  for select to authenticated using (true);

drop policy if exists "attachments_insert" on public.attachments;
create policy "attachments_insert" on public.attachments
  for insert to authenticated
  with check (
    split_part(path, '/', 1) = auth.uid()::text
    and public.can_attach(issue_id, issue_note_id, suggestion_id, suggestion_comment_id)
  );

drop policy if exists "attachments_delete" on public.attachments;
create policy "attachments_delete" on public.attachments
  for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());

grant select, insert, delete on public.attachments to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on public.attachments from anon;

-- muat ulang cache API supaya tabel baru langsung terbaca
notify pgrst, 'reload schema';
