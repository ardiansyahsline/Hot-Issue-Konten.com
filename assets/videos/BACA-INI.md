# Video jadi internal (TIDAK publik)

Folder ini disajikan lewat `GET /api/studio/video/<nama>` — wajib login + akses Studio (lihat `app/api/studio/video/[name]/route.ts`).
Jangan taruh video internal di `public/` (bisa dibuka siapa saja tanpa login).

Nama file yang dikenali route (lainnya 404):

| File | Isi |
|---|---|
| `teaser-cs-tracker.mp4` | Teaser CS Tracker premium, dengan VO (render laptop: komposisi `TeaserCsTracker`, `audio: "all"`) |
| `teaser-cs-tracker-tanpa-vo.mp4` | Versi musik + SFX + teks (`audio: "novo"`) |

Selama file belum ada, menu 🧩 Template lama otomatis menyembunyikan tombol "Download MP4 sekarang" (cek HEAD → 404)
dan user tetap bisa "Bikin file video" langsung di browser.
