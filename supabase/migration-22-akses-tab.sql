-- =====================================================================
-- UPDATE 22 — Akses tab per user: admin bisa menutup tab tertentu (Dashboard & Hot Issue, Video Review,
-- Catatan & Saran, Chat, AI, Musik AI) untuk user tertentu. Diatur di Admin → Akses tab per user.
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-21. Aman dijalankan ulang.
-- Belum dijalankan? Website tetap jalan seperti biasa (semua tab terbuka untuk semua user).
--
-- Disimpan sebagai daftar TUTUP: tidak ada baris = semua tab boleh, jadi tab baru otomatis terbuka.
-- Admin selalu boleh semua tab. Studio tetap diatur lewat studio_access (migration-20).
-- Id tab harus sama dengan lib/tabs.ts (TAB_IDS).
-- =====================================================================

create table if not exists public.user_tab_blocks (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  blocked     text[] not null default '{}',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- isi hanya id tab yang dikenal (dibuat ulang tiap migration dijalankan supaya daftar id selalu terbaru)
alter table public.user_tab_blocks drop constraint if exists user_tab_blocks_known;
alter table public.user_tab_blocks add constraint user_tab_blocks_known
  check (blocked <@ array['dashboard', 'video_review', 'catatan', 'chat', 'ai', 'musik']::text[]);

-- updated_at + updated_by diisi database (tidak bisa dipalsukan dari browser); admin tidak bisa dibatasi
create or replace function public.user_tab_blocks_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.profiles where id = new.user_id and role = 'admin') then
    raise exception 'Admin selalu bisa membuka semua tab' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
drop trigger if exists user_tab_blocks_stamp on public.user_tab_blocks;
create trigger user_tab_blocks_stamp before insert or update on public.user_tab_blocks
  for each row execute function public.user_tab_blocks_stamp();

alter table public.user_tab_blocks enable row level security;
grant select, insert, update, delete on public.user_tab_blocks to authenticated;

-- lihat: baris sendiri (supaya website tahu tab mana yang ditutup) atau admin
drop policy if exists "user_tab_blocks_read" on public.user_tab_blocks;
create policy "user_tab_blocks_read" on public.user_tab_blocks for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
-- ubah: hanya admin
drop policy if exists "user_tab_blocks_admin_insert" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_insert" on public.user_tab_blocks for insert to authenticated
  with check (public.is_admin());
drop policy if exists "user_tab_blocks_admin_update" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_update" on public.user_tab_blocks for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "user_tab_blocks_admin_delete" on public.user_tab_blocks;
create policy "user_tab_blocks_admin_delete" on public.user_tab_blocks for delete to authenticated
  using (public.is_admin());

-- boleh buka tab t? (admin selalu boleh; tidak ada baris = boleh). Untuk dipakai aturan RLS tabel lain nanti,
-- mis. using (public.tab_allowed('video_review') and ...)
create or replace function public.tab_allowed(t text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
    or not exists (select 1 from public.user_tab_blocks where user_id = auth.uid() and t = any (blocked))
  );
$$;
revoke execute on function public.tab_allowed(text) from public, anon;
grant execute on function public.tab_allowed(text) to authenticated;

notify pgrst, 'reload schema';
