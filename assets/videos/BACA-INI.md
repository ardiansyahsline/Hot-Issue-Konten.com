# Video jadi internal (TIDAK publik)

Folder ini disajikan lewat `GET /api/studio/video/<nama>` — wajib login + akses Studio (lihat `app/api/studio/video/[name]/route.ts`).
Jangan taruh video internal di `public/` (siapa saja bisa buka tanpa login).

Hanya 2 nama file ini yang dikenali (nama lain = 404):

| File | Isi | Asalnya |
|---|---|---|
| `teaser-cs-tracker-tanpa-vo.mp4` | Teaser **tanpa suara VO** (SFX + teks, tanpa musik latar) | Render laptop/CLI komposisi `TeaserCsTracker` dengan `--props='{"audio":"novo"}'` (contoh lengkap di `remotion/Root.tsx`). Bisa juga dari Studio Pro → Download → **Tanpa VO**. |
| `teaser-cs-tracker.mp4` | Teaser **dengan suara VO** (suara Alif) | **Harus dari Studio Pro** (langkah di bawah), lalu taruh di folder ini. |

## Cara bikin versi dengan VO

1. Buka **Studio Pro** → klik **🎞️ Buka Teaser CS Tracker**.
2. Di kotak **Suara (VO)** klik **🎙️ Bikin suara VO** (bank suara "Alif - Energik", laptop mesin suara harus nyala).
   Tunggu sampai muncul label hijau **VO siap**.
3. Di kotak **Download** pilih **Dengan VO** → **⬇️ Download MP4** (atau **🖥️ Render di laptop**).
4. File otomatis bernama `teaser-cs-tracker.mp4`. Taruh di folder ini.

## Perlu diingat

- Render CLI komposisi `TeaserCsTracker` **tidak berisi suara VO**, biarpun pakai `audio: "all"` (isinya sama dengan versi
  tanpa VO). Suara VO hanya ada di proyek Studio Pro yang sudah "Bikin suara VO".
- Durasi adegan teaser dikunci di ketukan musik, jadi kalimat VO yang sedikit kepanjangan **otomatis dipercepat maksimal 30%**
  (nada suara tetap) supaya pas sebelum VO adegan berikutnya. Kotak biru ⏩ di panel suara menyebut berapa kalimat yang
  dipercepat; kalau di 30% masih belum muat, muncul peringatan merah/kuning (untuk VO Outro: "ujung VO terpotong di akhir
  video" kalau kalimatnya belum selesai saat video habis — pendekkan teks VO Outro).
- Label kuning **VO sementara** = suara cadangan (Edge) karena laptop mati. File-nya otomatis bernama
  `teaser-cs-tracker-vo-sementara.mp4` — **jangan** diganti nama jadi `teaser-cs-tracker.mp4`. Tunggu laptop nyala,
  klik **Generate ulang VO**, lalu download lagi.
- Ukuran: usahakan tiap file < 50 MB (GitHub menolak > 100 MB). Kalau kebesaran, kecilkan dulu, misalnya:
  `ffmpeg -i in.mp4 -c:v libx264 -crf 20 -preset slow -c:a aac -b:a 192k -movflags +faststart out.mp4`
- Selama file belum ada, menu 🧩 Template menyembunyikan tombol download file itu. Tombol **Bikin file video** di menu itu
  tetap jalan (versi tanpa VO, dengan musik + SFX).
