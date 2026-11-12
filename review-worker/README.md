# Asisten Review Video (MODE UJI) — mesin di laptop

Mesin ini membantu tim Video Review: ia mengecek apakah video clipper sesuai brief campaign dan memakai musik campaign.
**AI hanya memberi saran. Keputusan tetap di tangan reviewer.** Tujuan tahap uji: mengukur seberapa sering saran AI
sama dengan keputusan reviewer (dan hasil banding), lalu menyusun laporan untuk diajukan ke official Konten.com.

Cara kerjanya singkat:

1. Laptop membaca data video dan brief dari **database replika Konten.com**. Aksesnya hanya-baca, lewat VPN.
2. Video diunduh sebentar ke folder sementara, lalu diolah: frame gambar, suara jadi teks, teks di layar, dan cocok musik.
   Folder sementara langsung dihapus sesudahnya.
3. **Claude Haiku 5.5** (lewat Anthropic API) menilai setiap poin brief, lalu menyarankan **Approve / Reject / Butuh cek
   manusia**, lengkap dengan bukti.
4. Hasilnya dikirim ke website CS Tracker, tab **"Asisten Review (Uji)"**. Yang dikirim hanya id video, id campaign, hasil AI,
   dan keputusan reviewer (sudah disamarkan). Data akun clipper (nama, email, nomor HP, username) tidak diambil dari database.
   Batasnya: nama yang ditulis atau diucapkan sendiri oleh clipper di video/caption bisa ikut terbaca (lihat bagian 9).

> Website tetap jalan normal walau laptop mati atau kunci belum diisi. Tab Asisten Review hanya menampilkan "laptop mati".

---

## 1. Yang dibutuhkan

| Perlu | Keterangan |
|---|---|
| Laptop Windows + GPU NVIDIA | Sama dengan mesin suara (RTX 5050 8 GB sudah cukup). Tanpa GPU tetap bisa, tapi lambat. |
| VPN Konten.com | Wajib menyala saat uji. Database replika hanya bisa dibuka lewat VPN. |
| Akun DB replika | Env Windows `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGSSLMODE`, ditambah file `%APPDATA%\postgresql\pgpass.conf`. Password **hanya** disimpan di file pgpass.conf itu. |
| Kunci Anthropic API | `ANTHROPIC_API_KEY` untuk Claude Haiku 5.5. Biayanya kira-kira Rp 23 per video (lihat bagian 7). |
| Supabase CS Tracker | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (sama dengan mesin suara). |
| Ruang disk ±8–10 GB | Paket Python sendiri (torch + EasyOCR), Java portable, model OCR, dan model suara-ke-teks `large-v3-turbo` (±1,6 GB, diunduh sekali saat video pertama). |

Admin website cukup sekali: jalankan `supabase/migration-23-asisten-review.sql` di Supabase → SQL Editor. Lalu buka akses tab
untuk reviewer di **Admin → Akses tab per user** (admin selalu bisa membuka tab ini).

---

## 2. Pasang (sekali saja)

**Cara termudah:** klik dua kali **`NYALAKAN-ASISTEN-REVIEW.bat`** di folder utama repo. Isinya:

1. `git pull` (ambil update).
2. Memasang paket kalau belum ada atau berubah (`review-worker\install.ps1`).
3. Mengecek semua pengaturan.
4. Menyalakan mesin.

Pemasangan pertama butuh 10–20 menit. Yang dipasang `install.ps1` (semua gratis):

| Langkah | Yang dipasang | Kegunaan |
|---|---|---|
| 1 | **uv** | Pengelola Python. Sudah ada kalau mesin suara terpasang. |
| 2 | **ffmpeg** (winget `Gyan.FFmpeg`) | Memotong video dan audio. |
| 3 | **Python 3.11** di `review-worker\.venv` | Folder sendiri, terpisah dari mesin suara, jadi keduanya tidak saling merusak. |
| 4 | **PyTorch 2.8 CUDA 12.8** | Wajib untuk RTX 50xx. |
| 5 | Paket dasar: **anthropic**, **psycopg** (DB), **yt-dlp** (unduh video), **PySceneDetect** (pilih frame), **faster-whisper** (suara → teks), **gdown** (materi Google Drive), **librosa** | Lihat `requirements.txt`. |
| 6 | **EasyOCR** | Membaca teks di layar video. |
| 7 | **Java Temurin 21** portable di `review-worker\tools\jdk` (±190 MB, tanpa hak admin) | Dibutuhkan Panako. Tidak mau Java? Pakai `-TanpaJava`. |
| 8 | **Panako** (dibangun di laptop) | Mencocokkan musik campaign, tetap bisa walau tempo atau nada diubah. |
| 9 | Membuat `.env` lalu menjalankan `review cek` | |

Pasang manual (PowerShell di folder `review-worker`):

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1            # biasa
powershell -ExecutionPolicy Bypass -File .\install.ps1 -TanpaJava # tanpa Java/Panako (musik pakai cara cadangan)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -CpuSaja   # laptop tanpa GPU NVIDIA
```

Catatan Panako: pembuatnya **tidak resmi mendukung Windows**. Kalau Panako gagal, musik otomatis dicek dengan cara cadangan
(**Olaf** di dalam Panako, lalu **chroma**). Video tetap diproses. Mesin yang dipakai tercatat di setiap hasil.

---

## 3. Isi `.env`

Buka dengan `notepad .env` di folder `review-worker`. **Jangan pernah** menulis password database di file ini.

| Nama | Isi |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Sama dengan `.env` mesin suara. Kunci ini hanya ada di laptop. |
| `ANTHROPIC_API_KEY` | Kunci dari console.anthropic.com. Kalau kosong, AI mati dan semua hasil jadi "butuh cek manusia". |
| `REVIEW_DAILY_BUDGET_USD` | Batas biaya AI per hari (bawaan **2** dolar). Kalau tercapai, uji berhenti otomatis dan bisa dilanjutkan besok. |
| `REVIEW_MIN_CONFIDENCE` | Ambang keyakinan (bawaan 70). Saran di bawah angka ini otomatis jadi "butuh cek manusia". |
| `PGHOST` … `PGSSLMODE` | Kosongkan kalau sudah di-set di Windows (biasanya sudah). |
| `GOOGLE_DRIVE_API_KEY` | Opsional, untuk folder Google Drive besar. Kosong = cukup gdown + upload manual. |
| Lainnya | Biarkan nilai bawaan (lihat komentar di `.env.example`). |

Format `pgpass.conf`, satu baris: `host:port:database:user:password`. File ini sudah ada di laptop dan dibaca langsung oleh
driver database. Mesin ini tidak pernah membaca atau menyimpan password.

---

## 4. Langkah pertama (sekali, sesudah terpasang)

Sambungkan **VPN**, buka PowerShell di folder `review-worker`, lalu jalankan:

```powershell
.venv\Scripts\python review.py cek               # semua baris harus OK (tanpa biaya AI)
.venv\Scripts\python review.py kenali-skema      # daftar kolom DB replika → data\skema.json
.venv\Scripts\python review.py sinkron-alasan    # daftar alasan reject resmi → website
```

`kenali-skema` mencocokkan **nama kolom** DB replika dengan `kolom.toml`. Ia hanya membaca nama kolom, tidak membaca isi
baris. Kalau ada tulisan "Kolom … tidak ada. Mungkin maksudnya: …", buka `kolom.toml` lalu ganti nilai di kanan tanda `=`.
Nilai status juga perlu dicek (mis. apa arti "approved" dan apa tanda banding diterima). Untuk itu jalankan
`review.py kenali-skema --nilai`. Perintah ini hanya menampilkan nilai unik dan jumlahnya, tanpa data pribadi. Sesudah itu
sesuaikan bagian `[nilai]`. Kalau bingung, kirim isi `data\skema.json` ke tim web. File itu tidak berisi data pribadi.

---

## 5. Uji 50 video dulu, lalu 500

1. Nyalakan mesin: klik **`NYALAKAN-ASISTEN-REVIEW.bat`**. Biarkan jendelanya terbuka sampai muncul tulisan
   *"Menunggu antrian dari website"*.
2. Di website, buka tab **Asisten Review (Uji) → Uji**, lalu klik **"Jalankan uji 50 video"**. Laptop otomatis mengambil
   sampel keputusan lama. Sampelnya seimbang approve/reject, dari banyak campaign dan reviewer, dan tersebar di banyak hari.
   Progres dan perkiraan sisa waktu tampil di website.
3. Sesudah selesai, buka **Ringkasan**. Baca tingkat setuju dan contoh salahnya. Rubrik bisa diperbaiki, lalu klik
   **"Ulangi dengan rubrik terbaru"**. Sampelnya tetap sama, jadi hasil antar versi rubrik bisa dibandingkan.
4. Kalau hasilnya sudah meyakinkan, klik **"Jalankan uji 500 video"**. Hasil inilah yang dipakai untuk laporan resmi.

Lewat jendela PowerShell juga bisa: `.venv\Scripts\python review.py uji --jumlah 50`. Kalau Supabase belum diisi, hasilnya
disimpan lokal di `data\hasil-lokal.jsonl`.

- **Ctrl+C sekali**: mesin berhenti sesudah video yang sedang jalan. Uji dilanjutkan otomatis dari video berikutnya saat
  mesin dinyalakan lagi.
- **Ctrl+C dua kali**: mesin berhenti sekarang juga.
- **VPN putus**: mesin menunggu dan mencoba lagi tiap 60 detik sampai 30 menit. Kalau masih putus, uji berhenti. Klik
  **Lanjutkan** sesudah VPN tersambung.
- **Batas biaya harian tercapai**: uji berhenti. Klik **Lanjutkan** besok.

**Uji video tertentu:** di halaman Uji, tempel ID video Konten.com atau link video (maks 20 baris). Link tidak disimpan;
yang disimpan hanya id-nya. Lewat PowerShell: `.venv\Scripts\python review.py video 48213`.

---

## 6. Membuka laporan

- Website: **Ringkasan → "Buka laporan"**. Isinya satu halaman bahasa awam, siap dicetak atau diajukan.
- Di laptop: file `review-worker\data\laporan\<nomor-run>.html` (klik dua kali, terbuka di browser).
- Buat ulang laporan: `.venv\Scripts\python review.py laporan <nomor-run>`.

Isi laporan: tingkat setuju AI vs reviewer dan vs hasil banding, tabel salah-benar, akurasi per alasan reject dan per
campaign, persentase yang diserahkan ke manusia, biaya per video (Rp) dan perkiraan per bulan, waktu proses, serta contoh
kasus benar dan salah. Laporan tidak memuat username, link, atau gambar frame.

---

## 7. Biaya

Claude Haiku 5.5: $0,10 per 1 juta token masukan, $0,50 per 1 juta token keluaran. Rubrik dan brief disimpan di cache selama
1 jam, jadi lebih murah. Perkiraannya ±$0,0013 (±Rp 23) per video, jadi uji 500 video ±$0,7. Untuk 2.000 video/hari, biayanya
±$2,6/hari (±Rp 1,4 juta/bulan). Angka sebenarnya diukur dan tercantum di laporan. Batas harian `REVIEW_DAILY_BUDGET_USD`
tidak pernah terlewati, walau Supabase sedang tidak terjangkau.

---

## 8. Bersama mesin suara (GPU)

Mesin suara (`NYALAKAN-MESIN-SUARA.bat`) boleh menyala bersamaan. GPU dipakai **bergantian** lewat kunci bersama di
`%LOCALAPPDATA%\HotIssueKonten\gpu`:

- Mesin suara selalu didahulukan.
- Asisten Review hanya memakai GPU per tahap singkat (suara → teks, OCR), lalu mengalah kalau mesin suara sedang menunggu.
- Kalau mesin suara sering butuh GPU, atau mesin ini menganggur 10 menit, model OCR dan suara dilepas dari memori GPU.

Kunci bermasalah tidak pernah membuat job gagal. Kedua mesin tetap jalan.

---

## 9. Privasi & keamanan

- Database Konten.com **hanya dibaca**. Sesi database dikunci read-only, perintah selain SELECT ditolak, dan batas waktunya
  30 detik. Tidak ada yang ditulis ke sistem Konten.com.
- Yang dikirim ke AI: brief (data brand), frame (username di layar diburamkan), serta transkrip, teks layar, dan caption yang
  sudah dibersihkan dari @username, username tanpa @ (mis. "ig budi99"), email, nomor HP, dan link (termasuk linktr.ee dll.).
  **Tanpa** link video, data akun clipper dari database, atau id/nama staff.
- Kalau OCR mati (`REVIEW_OCR=mati`) atau gagal, pita atas-kiri dan pita bawah frame (tempat watermark TikTok/IG)
  diburamkan rata. Username yang ditulis clipper di tengah layar tidak tertangkap cara ini — biarkan OCR menyala.
- **Batas yang perlu diketahui:** nama orang biasa yang ditulis atau diucapkan sendiri oleh clipper di caption/video
  (mis. "Aku Budi Santoso dari Bekasi") **tidak bisa** dihapus otomatis dan bisa ikut terbaca AI. Yang pasti dibuang hanya
  @username, username berpola akun, email, nomor HP, dan link.
- Reviewer ditulis sebagai kode samaran `R-xxxxxx`, bukan nama.
- Log di `data\logs` otomatis menyamarkan kunci, email, nomor HP, @username, dan link.
- Video sementara dihapus sesudah setiap video. Sisa lebih dari 6 jam dihapus saat mesin menyala.
- `.env`, `data\`, `tools\jdk`, dan `tools\panako` tidak pernah masuk GitHub.

---

## 10. Kalau ada masalah

| Tulisan | Artinya / yang dilakukan |
|---|---|
| "Database Konten.com tidak bisa dihubungi. VPN sudah tersambung?" | Sambungkan VPN, lalu klik Lanjutkan / coba lagi. |
| "Login DB Konten.com ditolak" / "Password … tidak ditemukan" | Cek baris di `%APPDATA%\postgresql\pgpass.conf`. Host, port, database, dan user harus sama dengan env PG*. |
| "Kolom alif.… tidak ada" | Jalankan `review.py kenali-skema`, lalu sesuaikan `kolom.toml`. |
| "Tabel Asisten Review belum ada di Supabase" | Admin menjalankan `supabase/migration-23-asisten-review.sql`. |
| "Kunci SUPABASE_SERVICE_ROLE_KEY ditolak" | Salin lagi dari Supabase → Project Settings → API → service_role. |
| "Video tidak bisa diakses" | Video dihapus, private, atau butuh login (sering terjadi di Instagram). Hasilnya diserahkan ke manusia. |
| "Materi belum ada" | Link Google Drive di brief private atau kosong. Upload lagu, poster, atau trailer di halaman **Materi**. |
| Musik "tidak bisa dicek" / mesin "chroma" | Java atau Panako belum siap. Jalankan `install.ps1` lagi, atau biarkan (cara cadangan tetap jalan). |
| "Batas biaya harian … tercapai" | Tunggu besok, atau naikkan `REVIEW_DAILY_BUDGET_USD` (keputusan pemilik). |

---

## 11. Semua perintah

```text
review.py cek                          cek pengaturan & koneksi (tanpa biaya)
review.py kenali-skema [--nilai]       daftar kolom DB replika → data\skema.json
review.py sinkron-alasan               alasan reject resmi → website
review.py uji --jumlah 50 [--seed N] [--label teks] [--dari 2026-07-01 --sampai 2026-11-10]
review.py uji --lanjut <run> | --ulang <run>
review.py video <id-atau-link> [...]   uji manual video tertentu
review.py materi <campaign_id> [--paksa]
review.py laporan <run>
review.py jalan                        tunggu antrian dari website (dipakai jalankan.bat)
```

Tes mandiri (tanpa GPU, VPN, atau kunci): `.venv\Scripts\python tests\selftest_inti.py`.

Lisensi paket utama: yt-dlp (Unlicense), PySceneDetect (BSD-3), faster-whisper (MIT), EasyOCR (Apache-2.0), gdown (MIT),
anthropic (Apache-2.0), psycopg (LGPL-3.0, dipakai apa adanya), Panako (AGPL-3.0, dipakai internal lewat perintah terpisah
tanpa diubah dan tidak disebarkan; JAR-nya dibangun di laptop dan tidak disimpan di GitHub).
