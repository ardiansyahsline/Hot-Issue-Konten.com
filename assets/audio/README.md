# Aset Audio CS Tracker

Semua bahan audio untuk Studio (Remotion) dan teaser CS Tracker.

| Folder | Isi |
|---|---|
| `sfx/` | 41 sound effect pilihan (mp3 48 kHz, 192 kbps) + `sfx.json` (kategori, tag, durasi, LUFS, true peak, saran pemakaian, sumber). `trailer-groove-perkusi` = turunan `trailer-pulse-sedang` (hanya pukulan sub/bass < 150 Hz, tanpa nada sirene) untuk groove musik cadangan |
| `music/` | Musik latar teaser. Lihat `music/BACA-INI.md` |
| `teaser/` | `naskah-vo.md` (naskah voice over + ejaan untuk mesin suara) dan `cue-sheet.md` (urutan adegan, SFX, musik, VO) |

Referensi suara untuk voice cloning ada di `voice-worker/bank-suara/` (sengaja tidak di `public/`).

## Aturan pakai
- **Jangan pindahkan ke `public/`.** File di `public/` bisa diunduh siapa saja yang tahu alamatnya.
  Sajikan ke Studio lewat route yang wajib login, atau upload ke Supabase Storage bucket privat (signed URL).
- **Pilih SFX dari `sfx.json`**, bukan dari nama file saja. Kolom `dipakai_untuk` berisi saran adegan.
- **Gain staging:** pakai kolom `lufs` & `true_peak_db` untuk menyamakan level. Target mix akhir sekitar -14 LUFS,
  true peak maksimal -1 dBTP. VO selalu paling jelas, musik di-ducking saat VO bicara.
- **Ketukan musik:** deteksi BPM/beat dari file musik yang dipakai (mis. librosa/aubio) lalu tempel transisi & impact ke ketukan.

## Lisensi
- SFX dari **Sonniss GDC 2026 Game Audio Bundle**: royalty-free, tanpa atribusi, boleh dipakai di proyek tanpa batas.
  Jangan didistribusikan ulang sebagai file mentah (alasan lain kenapa tidak di `public/`).
- Musik: ikuti lisensi sumbernya (lihat `music/BACA-INI.md`).
- Suara di `voice-worker/bank-suara/`: suara Alif sendiri, dipakai atas izin pemiliknya, khusus CS Tracker.
