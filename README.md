# 🔥 Hot Issues CS — Konten.com

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
- **Video Review:** log kasus review video (banding, rilis, saldo dibekukan, kesesuaian brief, dll.) dengan kolom yang sama seperti sheet "Video Review WA", rekap otomatis per kategori & status, dan **import dari Google Sheet (CSV)**.
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
| Discord Moderator | Input & edit | Lihat saja | – |
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
3. Kasus baru akan ditambahkan, dan kasus lama diperbarui kalau Penyelesaian, Insight, atau Argumen berubah di sheet. Klik berkali-kali pun data tidak akan dobel.

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
