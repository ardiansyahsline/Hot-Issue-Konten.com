-- Halaman Usage AI (khusus pemilik): jumlah token per jawaban untuk menghitung pemakaian & perkiraan biaya
alter table public.ai_messages add column if not exists tokens_in integer;
alter table public.ai_messages add column if not exists tokens_out integer;
create index if not exists ai_messages_created_idx on public.ai_messages (created_at desc);

notify pgrst, 'reload schema';
