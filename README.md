# CS Tracker — Konten.com

Web internal tim CS untuk mencatat hot issue clipper. Login email + password dengan 5 role, agent bisa buat & edit issue, input kontak clipper (No HP/WA, Instagram, Discord, Email), dan sistem otomatis menandai **HOT** kalau kontak yang sama dilaporkan berulang.

**Stack:** Next.js 15 (di-host di Vercel) + Supabase (login + database). Semua pakai paket gratis.

## Fitur

- **Login** email + password. Tidak ada halaman daftar; akun dibuat oleh admin.
- **Dashboard:** statistik (Hot aktif, Urgent, Open, In Progress, Resolved hari ini), filter status/kategori/prioritas/HOT/PIC saya, dan pencarian (judul, campaign, no HP, IG, dll).
- **Issue:** judul, deskripsi, kategori, status, prioritas, campaign/brand, PIC, tanda HOT manual, dan banyak kontak per issue.
- **HOT otomatis:** kontak yang muncul di ≥ 2 issue dalam 30 hari (angkanya bisa diubah lewat `NEXT_PUBLIC_HOT_THRESHOLD`). Issue juga bisa ditandai HOT manual.
- **Normalisasi kontak:** `0812-3456-789`, `+62 812 3456 789`, dan `812 3456789` dianggap nomor yang sama. `@Clipper.A` dan `instagram.com/clipper.a` juga dianggap akun yang sama.
- **Peringatan saat input:** waktu mengetik kontak di form, langsung muncul info kalau kontak itu sudah ada di issue lain.
- **Cek Kontak:** cari no HP/IG/Discord/email untuk melihat riwayat issue clipper itu.
- **Catatan per issue** untuk update dan handover shift.
- **Top 3 issue** di Dashboard dengan tab **Video Review** / **Dari agent** (kategori kasus / Hot Issue baru terbanyak 7 hari terakhir), tren dibanding minggu lalu, bar status, dan rangkuman otomatis.
- **Chat:** room bersama (default `semua-cs`), room grup, dan pesan pribadi antar semua pengguna. Ada halaman Chat dan tombol chat melayang di semua halaman dengan jumlah pesan belum dibaca.
- **Video Review:** log kasus review video (banding, rilis, saldo dibekukan, kesesuaian brief, dll.) dengan kolom yang sama seperti sheet "Video Review WA", rekap otomatis per kategori & status, dan **import dari Google Sheet (CSV)**.
- **Report Video Review:** sub-menu **Detail** (rekap per kategori), **Visualisasi** (tren harian, status, per kategori; 7/30/90 hari/semua), dan **Compare** (tabel heatmap 3/7/14/30 hari/all time + perbandingan dengan periode sebelumnya).
- **Chat:** kirim gambar & dokumen (📎, tarik-lepas, atau Ctrl+V) di room maupun pesan pribadi, daftar anggota dengan status **Online / Terakhir dilihat**, galeri file per room, dan keterangan **Dilihat** di pesan kamu.
- **Foto profil:** upload di halaman Akun; tampil di menu atas, chat, dan komentar.
- **Notifikasi:** pop-up browser (walau tab tertutup) untuk Hot Issue baru & chat, plus email untuk Hot Issue baru dan pesan pribadi saat penerima offline. Tiap orang bisa atur sendiri di Akun → Notifikasi.
- **Komentar & reaksi:** semua role bisa komentar di Hot Issue dan Catatan & Saran, membalas komentar tertentu (menjorok), dan memberi reaksi emoji (👍 🙏 🔥 ✅ dan lainnya) di issue, catatan, komentar, serta pesan chat. Kolom ketik punya tombol 😊.
- **Lampiran bukti:** di form Hot Issue, Catatan & Saran, update issue, dan tanggapan bisa melampirkan gambar & dokumen (tarik-lepas, pilih file, atau **Ctrl+V** screenshot). Di halaman detail tampil sebagai galeri (klik untuk perbesar) + daftar dokumen dengan tombol Unduh, dan bisa ditambah lewat **+ Tambah**. File disimpan privat — hanya user yang login yang bisa membuka.
- **Catatan & Saran:** journal tim dengan kategori Fitur, Keluhan clipper, dan Brief campaign (bug dilaporkan lewat Hot Issue kategori Bug platform). Semua role bisa menulis dan memberi tanggapan. Progress (Baru / In Progress / Done / Rejected) beserta alasannya hanya bisa diubah oleh admin.
- **Nama otomatis:** selain admin, tidak ada pilihan "siapa yang mencatat". PIC issue baru dan pencatat catatan otomatis diisi akun yang login. Admin tetap bisa memilih.
- **Mode terang / gelap:** tombol ☀️/🌙 di pojok kanan atas, dan pilihannya tersimpan di browser.
- **5 role:** Admin, CS, Video Review, Discord Moderator, User (lihat tabel hak akses di bawah).
- **Admin:** buat akun, ganti role lewat dropdown, reset password, dan hapus akun.
- **Akun saya:** ganti nama dan password sendiri.

## Hak akses per role

| Role | Hot Issues | Video Review | Kelola user & hapus data |
|---|---|---|---|
| Admin | Input & edit | Input & edit | ✅ |
| CS | Input & edit | Input & edit | – |
| Video Review | Input & edit | Input & edit | – |
| Discord Moderator | Input & edit | Input & edit | – |
| User | Lihat saja | Lihat saja | – |

---

## Cara deploy (sekitar 15 menit)

### Langkah 1 — Buat database di Supabase

1. Buka **https://supabase.com**, login (bisa pakai GitHub), lalu klik **New project**.
   - Name: `hot-issues-cs`
   - Database password: buat sendiri dan simpan.
   - Region: **Southeast Asia (Singapore)**
2. Tunggu sampai project selesai dibuat (±2 menit).
3. Buka menu **SQL Editor** → **New query**. Copy semua isi `supabase/schema.sql`, paste, lalu klik **Run**. Hasilnya harus "Success".
4. Matikan pendaftaran publik: **Authentication → Sign In / Providers → Email**, matikan **"Allow new users to sign up"**, lalu Save.
   (Akun tetap bisa dibuat lewat dashboard Supabase dan halaman Admin di web.)
5. Buat akun kamu sendiri: **Authentication → Users → Add user → Create new user**.
   Isi email + password, dan centang **Auto Confirm User**.
6. Jadikan akun kamu admin: buka **SQL Editor**, paste isi `supabase/jadikan-admin.sql` (cek dulu emailnya), lalu **Run**.
7. Ambil kunci API di **Project Settings → API Keys** (atau **Data API**):
   - **Project URL**: `https://xxxx.supabase.co`
   - **anon / publishable key**: aman untuk browser
   - **service_role / secret key**: RAHASIA, hanya untuk Vercel

**Langkah 1b — Update 02 (role + Video Review):** di **SQL Editor**, buat query baru, paste semua isi `supabase/migration-02-roles-video-review.sql`, lalu **Run**. Akun lama yang role-nya "agent" otomatis jadi **CS**.

**Langkah 1c — Update 03 (kategori otomatis, rangkuman, sync sheet):** jalankan `supabase/migration-03-kategori-rangkuman-sync.sql` dengan cara yang sama. Kasus yang kategorinya masih kosong langsung terisi otomatis. Tidak ada data yang dihapus.

**Langkah 1i — Update 09 (Report, lampiran & status online di Chat, foto profil, notifikasi, Bug pindah ke Hot Issue):** jalankan `supabase/migration-09-report-chat-profil.sql`. Isinya:
- Discord Moderator bisa input + edit Video Review.
- Semua Catatan & Saran kategori **Bug** dipindah jadi Hot Issue kategori **Bug platform** (lampiran, tanggapan, dan reaksi ikut pindah), dan pilihan Bug di Catatan & Saran dihapus.
- Bucket `avatar` (foto profil, publik, maks 2 MB), status online / terakhir dilihat, dan lampiran di chat (room & pesan pribadi — file pesan pribadi hanya bisa dibuka 2 orang itu).
- Tabel notifikasi (langganan push browser & pengaturan per orang).

**Langkah 1j — Notifikasi (push browser + email):** tambahkan env berikut di Vercel → Settings → Environment Variables, lalu **Redeploy**:

| Nama | Isi |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | kunci publik push (dari file `notif.env` yang dikirim) |
| `VAPID_PRIVATE_KEY` | kunci privat push (rahasia) |
| `VAPID_SUBJECT` | `mailto:email-admin@domainmu` |
| `RESEND_API_KEY` | API key dari resend.com (rahasia) |
| `EMAIL_FROM` | mis. `CS Tracker <notif@orovagroup.id>` — domainnya harus sudah diverifikasi di Resend |
| `APP_URL` | alamat web, mis. `https://cs-tracker.vercel.app` (untuk link di email/notifikasi) |

`SUPABASE_SERVICE_ROLE_KEY` juga wajib ada (sudah dipakai halaman Admin). Kalau env push/email belum diisi, aplikasi tetap jalan — notifikasi jenis itu saja yang dilewati.
Resend: daftar di resend.com → **Domains → Add Domain** → tambahkan record DNS yang diminta di pengelola domain → tunggu status *Verified* → **API Keys → Create**.
Tiap orang menyalakan notifikasi browser di **Akun → Notifikasi → Aktifkan** (atau dari ajakan 🔔 yang muncul sekali). Di iPhone: buka web di Safari → Share → **Add to Home Screen**, lalu buka dari ikon itu dan aktifkan.

**Langkah 1h — Update 08 (komentar semua role, balas komentar, reaksi emoji):** jalankan `supabase/migration-08-komentar-reaksi.sql`. Semua role (termasuk User) jadi bisa komentar di Hot Issue, ada kolom balasan, dan tabel reaksi emoji untuk issue, catatan, komentar, dan pesan chat (ikut Realtime).

**Langkah 1g — Update 07 (lampiran bukti gambar & dokumen):** jalankan `supabase/migration-07-lampiran.sql`. Ini membuat bucket penyimpanan **privat** `lampiran` (maks 10 MB per file; JPG/PNG/WebP/GIF/HEIC, PDF, Word, Excel, PowerPoint, CSV, TXT) beserta aturan aksesnya. Cek di Supabase → **Storage** muncul bucket `lampiran`. Paket gratis Supabase dapat 1 GB storage; screenshot besar otomatis dikecilkan sebelum di-upload supaya hemat.

**Langkah 1f — Update 06 (kolom Catatan, Top 3 issue, Chat, percepatan):** jalankan `supabase/migration-06-catatan-chat-speed.sql`. Isi Insight + Argumen clipper yang lama otomatis digabung ke kolom **Catatan** (data lama tidak dihapus), kasus yang Penyelesaiannya "belum ada respons" tapi Insight-nya berisi penyelesaian otomatis dibaca statusnya dari Insight, dan tabel Chat + Realtime disiapkan. Kalau setelah deploy chat belum muncul real-time, cek di Supabase → **Database → Publications → supabase_realtime** bahwa tabel `chat_messages` tercentang (tanpa ini chat tetap jalan, hanya update tiap beberapa detik).

**Langkah 1e — Update 05 (Discord Moderator bisa edit Video Review):** jalankan `supabase/migration-05-discord-mod-edit-vr.sql`.

**Langkah 1d — Update 04 (Catatan & Saran + nama otomatis):** jalankan `supabase/migration-04-catatan-saran.sql`. Mulai update ini, selain admin, nama pencatat dan PIC otomatis diambil dari akun yang login (juga dikunci di database).

### Langkah 2 — Upload kode ke GitHub

**Cara paling gampang (tanpa terminal):**
1. Buka **https://github.com/new**, buat repo **Private** bernama `hot-issues-cs`.
2. Di halaman repo, klik **uploading an existing file**.
3. Extract zip-nya, lalu drag **semua isi folder** `hot-issues-cs` (bukan folder-nya) ke halaman itu. Jangan upload `node_modules` atau `.next` kalau ada.
4. Klik **Commit changes**.

**Atau lewat terminal:**
```bash
cd hot-issues-cs
git init && git add . && git commit -m "init hot issues cs"
git branch -M main
git remote add origin https://github.com/USERNAME/hot-issues-cs.git
git push -u origin main
```

### Langkah 3 — Connect ke Vercel

1. Buka **https://vercel.com**, login pakai **GitHub**.
2. Klik **Add New… → Project**, lalu pilih repo `hot-issues-cs` dan klik **Import**.
   (Kalau repo tidak muncul, klik **Adjust GitHub App Permissions** dan beri akses ke repo itu.)
3. Framework otomatis terdeteksi sebagai **Next.js**. Biarkan setting build default.
4. Buka bagian **Environment Variables** dan isi 4 variabel ini:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL dari Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key |
   | `NEXT_PUBLIC_HOT_THRESHOLD` | `2` |

5. Klik **Deploy** dan tunggu ±1–2 menit. Kamu akan dapat link seperti `https://hot-issues-cs.vercel.app`.
6. (Disarankan) Di Supabase buka **Authentication → URL Configuration**, lalu isi **Site URL** dengan link Vercel tadi.

### Langkah 4 — Mulai pakai

1. Buka link Vercel dan login dengan akun yang kamu buat di Langkah 1.5.
2. Buka menu **Admin**, lalu buat akun untuk tiap agent CS.
3. Kirim email + password awal ke agent. Mereka bisa ganti password di menu **Akun** (klik nama di pojok kanan atas).

### Update kode ke depannya

Setiap kali ada perubahan yang di-push atau di-upload ke GitHub, Vercel otomatis redeploy.
Kalau mengubah Environment Variables di Vercel, buka **Deployments → ⋯ → Redeploy**.

### Custom domain (opsional)

Di Vercel buka **Project → Settings → Domains**, tambahkan misalnya `cs.konten.com`, lalu ikuti instruksi DNS dari Vercel.

---

## Import / sync data dari sheet "Video Review WA"

**Cara 1 — Sync langsung dari link (disarankan):**
1. Di Google Sheet, klik **Share → General access → Anyone with the link → Viewer**.
2. Di web, buka **Video Review → Import dari Sheet**, lalu klik **Sync sekarang** (link sheet sudah terisi otomatis).
3. Kasus baru akan ditambahkan, dan kasus lama diperbarui kalau Penyelesaian, Insight, atau Argumen berubah di sheet (Insight + Argumen masuk ke kolom **Catatan**). Kalau Penyelesaian masih "belum ada respons" tapi Insight sudah ada isinya, status dibaca dari Insight; Insight kosong berarti memang belum ada respons dari tim review. Klik berkali-kali pun data tidak akan dobel.

**Cara 2 — Upload CSV (kalau sheet harus tetap private):**
1. Di Google Sheet, buka tab **Video Review**, lalu klik **File → Download → Comma-separated values (.csv)**.
2. Di web, buka **Video Review → Import dari Sheet**, lalu pilih file .csv itu.
3. Cek preview, lalu klik **Import**.

Catatan:
- Baris lanjutan yang cuma berisi link/email tambahan otomatis digabung ke kasus di atasnya.
- Kolom rekap (Kategori / Jumlah Kasus / Rangkuman) diabaikan, karena sudah dihitung otomatis di web.
- Kategori diisi **otomatis** dari kata kunci di kolom Penjelasan (aturannya di `lib/videoReview.ts` → `VR_CATEGORY_RULES`). Kalau perlu, kategori bisa diganti lewat dropdown, dan pilihan manual tidak akan ditimpa saat sync.
- **Rangkuman** per kategori disusun otomatis dari data: jumlah kasus, rentang tanggal, jumlah per status, siapa yang menangani (nama dalam kurung di kolom Penyelesaian), dan kasus terbaru. Tiap kategori juga bisa diberi catatan manual.
- Status dibaca dari teks Penyelesaian ("Ditolak…" → Ditolak, "Disetujui/Sudah sesuai…" → Disetujui, "Belum ada respons"/kosong → Menunggu). Teks aslinya tetap disimpan dan status bisa diedit.
- File yang sama aman di-import ulang. Kasus yang sudah ada tidak akan dobel, hanya diperbarui kalau isinya berubah.

## Jalankan di laptop (opsional)

```bash
npm install
cp .env.example .env.local   # isi dengan kunci Supabase
npm run dev                  # buka http://localhost:3000
```

## Mengubah isi

- **Daftar kategori Hot Issues:** `lib/constants.ts` → `CATEGORIES`
- **Daftar kategori Video Review:** `lib/videoReview.ts` → `VR_CATEGORIES`
- **Hak akses role:** `lib/roles.ts` dan fungsi `can_write_issues()` / `can_write_reviews()` di migration-02
- **Batas HOT:** env `NEXT_PUBLIC_HOT_THRESHOLD`. Window 30 hari ada di `supabase/schema.sql` (view `contact_stats`).

## Troubleshooting

| Masalah | Solusi |
|---|---|
| "Email atau password salah" padahal benar | Pastikan user sudah **Auto Confirm** (di Supabase Users kolom "Last sign in" / "Confirmed"). |
| Dashboard error "relation issue_list does not exist" | `schema.sql` belum di-run, atau di-run di project Supabase yang lain. |
| Menu Video Review error "Gagal ambil data" | `migration-02-roles-video-review.sql` belum di-run. |
| Menu Admin tidak muncul | Jalankan `jadikan-admin.sql`, lalu logout dan login lagi. |
| Admin gagal buat akun | `SUPABASE_SERVICE_ROLE_KEY` belum di-set di Vercel. Tambahkan lalu redeploy. |
| Build gagal di Vercel | Cek 2 env `NEXT_PUBLIC_…` sudah terisi, lalu redeploy. |

## Peringatan "Dangerous" di Chrome

Peringatan ini berasal dari **Google Safe Browsing**, bukan dari kode web. Halaman login di domain acak `*.vercel.app` yang membawa nama brand ("konten-com") sering salah dikira halaman phishing. Cara menghilangkannya:

1. **Pakai link production, bukan link deployment.** Link seperti `hot-issue-konten-com-9ivi-j40r3h9p0-kontencom.vercel.app` adalah link versi tertentu. Gunakan link di Vercel → Project → **Domains**, misalnya `hot-issue-konten-com.vercel.app`.
2. **(Paling ampuh) Pakai domain sendiri**, misalnya `cs.konten.com`: Vercel → Project → Settings → **Domains** → Add, lalu tambahkan record DNS (CNAME ke `cname.vercel-dns.com`) di pengelola DNS konten.com.
3. **Laporkan salah deteksi ke Google:** buka https://safebrowsing.google.com/safebrowsing/report_error/, isi URL web-nya, lalu jelaskan bahwa ini tools internal milik Konten.com. Atau verifikasi domain di **Google Search Console**, buka menu **Security issues**, lalu klik **Request review**. Biasanya selesai dalam 1–3 hari.

Dari sisi kode, web ini sudah diset `noindex` (tidak masuk Google), punya `robots.txt`, header keamanan, serta judul dan deskripsi yang jelas sebagai tools internal.
