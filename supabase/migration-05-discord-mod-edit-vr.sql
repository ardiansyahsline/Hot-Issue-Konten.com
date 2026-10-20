-- =====================================================================
-- UPDATE 05 — Discord Moderator boleh EDIT Video Review (tidak bisa input baru / import)
-- Jalankan SEKALI di Supabase SQL Editor SETELAH migration-04. Aman dijalankan ulang.
-- =====================================================================

create or replace function public.can_edit_reviews()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.my_role() in ('admin', 'cs', 'video_review', 'discord_mod'), false);
$$;
grant execute on function public.can_edit_reviews() to authenticated;

-- edit kasus
drop policy if exists "vr_update" on public.video_reviews;
create policy "vr_update" on public.video_reviews for update to authenticated
  using (public.can_edit_reviews()) with check (public.can_edit_reviews());

-- email/link ikut diganti saat edit
drop policy if exists "vrl_insert" on public.video_review_links;
create policy "vrl_insert" on public.video_review_links for insert to authenticated with check (public.can_edit_reviews());
drop policy if exists "vrl_update" on public.video_review_links;
create policy "vrl_update" on public.video_review_links for update to authenticated
  using (public.can_edit_reviews()) with check (public.can_edit_reviews());
drop policy if exists "vrl_delete" on public.video_review_links;
create policy "vrl_delete" on public.video_review_links for delete to authenticated using (public.can_edit_reviews());
