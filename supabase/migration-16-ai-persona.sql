-- =====================================================================
-- UPDATE 30 — Tab AI: simpan karakter (hero) yang dipakai di tiap jawaban
-- Supaya kalau hero pilihan (mis. Alucard) dialihkan ke mesin lain, riwayat chat tetap tampil sebagai Alucard
-- dengan tanda "↪ dibantu …". Jalankan SEKALI di Supabase SQL Editor. Aman dijalankan ulang.
-- =====================================================================

alter table public.ai_messages add column if not exists persona text check (char_length(persona) <= 60);

notify pgrst, 'reload schema';
