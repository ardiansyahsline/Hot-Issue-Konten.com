-- Bubble angka "Menunggu" di tab Video Review: angka langsung berubah (realtime) saat review baru masuk / status diubah
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'video_reviews'
     ) then
    alter publication supabase_realtime add table public.video_reviews;
  end if;
end $$;

-- hitung status "menunggu" cepat
create index if not exists video_reviews_status_idx on public.video_reviews (status);

notify pgrst, 'reload schema';
