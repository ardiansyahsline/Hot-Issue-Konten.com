# Video jadi internal (TIDAK publik)

Folder ini disajikan lewat `GET /api/studio/video/<nama>` — wajib login + akses Studio (lihat `app/api/studio/video/[name]/route.ts`).
Jangan taruh video internal di `public/` (bisa dibuka siapa saja tanpa login).

Hanya 2 nama file ini yang dikenali (nama lain = 404):

| File | Isi | Cara bikin |
|---|---|---|
| `teaser-cs-tracker-tanpa-vo.mp4` | Teaser tanpa suara VO (musik + SFX + teks) | Render laptop: komposisi `TeaserCsTracker` dengan `--props='{"audio":"novo"}'` (lihat contoh di `remotion/Root.tsx`). Atau Studio Pro → Download → **Tanpa VO**. |
| `teaser-cs-tracker.mp4` | Teaser **dengan suara VO** (VO final suara Alif) | **Wajib dari Studio Pro**, lihat langkah di bawah. |

## Bikin versi dengan VO (langkah singkat)

1. Buka **Studio Pro** → klik **🎞️ Buka Teaser CS Tracker**.
2. Di panel **Suara (VO)** klik **🎙️ Bikin suara VO** (bank suara "Alif - Energik", laptop harus nyala). Tunggu sampai muncul **VO siap**.
3. Di panel **Download** pilih **Dengan VO** → **⬇️ Download MP4** (atau **Render di laptop**).
4. Pastikan namanya `teaser-cs-tracker.mp4` (nama bawaan dari Studio untuk proyek "Teaser CS Tracker"), lalu taruh di folder ini.

Penting:

- Render laptop komposisi `TeaserCsTracker` (biarpun `audio: "all"`) **tidak ada suara VO-nya** — hasilnya sama dengan versi tanpa VO.
  Suara VO hanya ada di proyek Studio Pro yang sudah "Bikin suara VO".
- Kalau laptop mati, Studio memakai suara cadangan (Edge) berlabel **VO sementara** dan file download-nya otomatis
  bernama `…-vo-sementara.mp4`. File itu **jangan** diganti nama jadi `teaser-cs-tracker.mp4` — tunggu laptop nyala,
  klik **Generate ulang VO** pakai bank suara, lalu download lagi.
- Ukuran: usahakan tiap file < 50 MB (GitHub menolak > 100 MB). Kalau kebesaran, kecilkan dulu, misalnya:
  `ffmpeg -i in.mp4 -c:v libx264 -crf 20 -preset slow -c:a aac -b:a 192k -movflags +faststart out.mp4`

Selama file belum ada, menu 🧩 Template lama otomatis menyembunyikan tombol download file itu (cek HEAD → 404).
User tetap bisa **Bikin file video** langsung di browser (versi tanpa VO, dengan musik + SFX).
