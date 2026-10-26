# Teaser CS Tracker — storyboard & naskah (bahasa awam)

Video teaser internal tim, gaya trailer produk premium.
**Format:** 9:16 (1080×1920), 30 fps, 59,4 detik + 0,5 detik hening di akhir.
**Penonton:** tim internal (nama asli tim boleh tampil, identitas clipper selalu disamarkan).
**Musik:** trailer bed 100 BPM yang disusun dari SFX bawaan (tidak pakai musik berhak cipta). 1 ketukan = 0,6 detik; semua pergantian adegan & pukulan efek jatuh tepat di ketukan.
**Sumber:** `assets/audio/teaser/cue-sheet.md` + `naskah-vo.md` (diterjemahkan ke `lib/studio/teaser.ts`). Semua tampilan dibuat ulang dari komponen website asli, bukan screenshot.

## Storyboard

| # | Detik | Adegan | Yang terlihat | Suara VO | Teks di layar | Efek suara (detik di adegan) | Musik |
|---|---|---|---|---|---|---|---|
| 1 | 0,0–3,0 | Hook | Potongan cepat masalah sebelum ada CS Tracker: sheet laporan berantakan, topik kembar, notifikasi chat menumpuk, layar glitch & gelap | "Hot issue numpuk… chat tim berantakan…" | Hot issue numpuk? · Chat tim berantakan? | glitch (0) · ambience gelap (0) · snap (0,6 / 1,8 / 2,4) · braam gelap (1,2) | pelan, membangun |
| 2 | 3,0–4,8 | Reveal | Logo CS Tracker menghantam layar dengan kilat & sapuan cahaya, lalu tulisan "CS Tracker · Konten.com" | "Kenalin. CS Tracker." | CS Tracker | riser memuncak + impact (0) · braam (0,3) | hit pertama |
| 3 | 4,8–10,2 | Dashboard + Hot Issue | Angka dashboard berjalan, satu topik naik ke peringkat #1, badge 🔥 HOT menyala | "Semua hot issue langsung ke-ranking otomatis. Yang paling panas, paling atas." | Paling panas, paling atas | readout (0,3) · koin (1,2) · ping HOT (2,4) | groove masuk |
| 4 | 10,2–15,0 | Video Review | Kartu kasus digeser masuk, status dipilih: Menunggu → Diproses → Disetujui (centang hijau) | "Video review? Cek, kasih status… beres." | Cek, kasih status, beres | whoosh (0,6 / 2,4) · klik terima (1,8 / 3,6) | groove |
| 5 | 15,0–21,0 | Chat tim | Pesan dari Alif, Derencalibur, Nengok, Irsyad masuk real-time, reaksi 🔥, Natasha kirim screenshot chat clipper (nama & foto clipper disamarkan) | "Ngobrol bareng tim, real-time. Satu tempat, nggak ada yang kelewat." | Satu tempat, real-time | notif chat (0,3 / 1,2 / 2,1 / 3,0) · boing reaksi (3,9) · pop lampiran (4,8) | groove agak turun |
| 6 | 21,0–33,0 | AI (terpanjang) | Tanya AI soal IHSG & kripto → AI nanya balik lewat kartu pilihan → langkah berpikir → jawaban analisa → chart (ilustrasi) | "Tanya AI soal hot issue, saham, sampai kripto. Dia mikir dulu… bahkan nanya balik, biar jawabannya pas." | AI yang mikir dulu · Bahkan nanya balik | ai magic (0) · twinkle (0,6) · pilih kartu (3,0) · readout berpikir (4,8) · jawaban (7,2) · koin chart (9,0) | build kedua |
| 7 | 33,0–40,2 | Desain berita (TWS) | Ketik sekali → cover berita jadi: angka "-11,57%" menghantam layar, carousel geser ke cover Prabowo & kronologi, tombol download SVG Figma ditekan | "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal download." | Sekali ketik, langsung jadi | bass drop + impact (1,2) · balik halaman (3,0 / 4,2) · pop download (6,0) | drop / klimaks 1 |
| 8 | 40,2–46,2 | Train your AI | Kuis kepribadian diketuk 3×, hasil tipe ENFP muncul dramatis + konfeti, lalu pilih peran | "Mau AI yang ngerti gaya kamu? Latih versimu sendiri." | Latih AI versimu | snap (0,6 / 1,2 / 1,8) · magic + sukses (2,4) · konfeti (3,0) · pop pilih peran (4,8) | energi tinggi |
| 9 | 46,2–49,8 | Musik + laporan/PPT | Pemutar musik AI dibuka, lalu halaman laporan/PPT dibalik dan tombol Unduh PowerPoint menyala | "Plus musik, laporan, sampai PPT." | Musik, laporan, PPT | pluck (0,6) · balik halaman (2,4) | menuju klimaks |
| 10 | 49,8–55,2 | Montage + Studio | Potongan super cepat semua fitur di tiap ketukan, terakhir tampilan Studio yang sedang membuat video ini | "Dan video ini… juga dibikin di sini." (mulai detik 1,2) | Dibikin di sini | bass drop (0) · snap/spin (0,6 / 1,2 / 1,8 / 3,0) · glitch (2,4) | klimaks / drop terbesar |
| 11 | 55,2–59,4 | Outro | Logo mendarat dengan hentakan, tagline, avatar tim, tombol ajakan, lalu fade ke hitam tepat di ketukan terakhir | "CS Tracker. Kerja lebih cepat… bareng-bareng." | Kerja lebih cepat · Bareng-bareng · Buka CS Tracker | whoosh serpihan (0) · boom + braam (0,6) | hit akhir, potong bersih |

## Beda kecil dari cue sheet (dan alasannya)
- **Batas adegan ditempel ke ketukan terdekat** (aturan cue sheet): 5,0 → 4,8 · 10,0 → 10,2 · 40,0 → 40,2 · 46,0 → 46,2 · 50,0 → 49,8 · 55,0 → 55,2. Musik berhenti di ketukan terakhir 59,4 lalu hening ±0,5 detik.
- **Reveal:** cue sheet minta riser + braam + impact bersamaan di 3,0. Aturan "maks 2 SFX keras bersamaan" → riser & impact di 3,0, braam masuk sebagai ombak di 3,3.
- **Video Review:** status memakai status asli website (Menunggu → Diproses → Disetujui), bukan contoh "Rilis/Banding" di cue sheet.
- **Chat tim:** level musik "groove" (agak turun karena musik otomatis turun saat VO bicara).
- **VO** mulai di "waktu target" naskah tiap adegan (mis. VO montage mulai 51,0 sesuai catatan "di akhir").

## Berita asli di adegan 7 (dan angka IHSG di adegan 6)
Judul ditulis sebagai ringkasan berita, bukan kutipan. Angka persis seperti dilaporkan. Dicek silang per 25 Okt 2026.
- Databoks (Katadata) — Terancam Jadi "Standalone Market", IHSG Anjlok 11% (16 Okt 2026): https://databoks.katadata.co.id/pasar/statistik/6ad1f159e1b8f/terancam-jadi-standalone-market-ihsg-anjlok-11-jumat-16-oktober-2026
- Kontan — IHSG Anjlok 11%, Penurunan Harian Terdalam Sejak 1998 Usai Pengumuman MSCI: https://investasi.kontan.co.id/news/ihsg-anjlok-11-penurunan-harian-terdalam-sejak-1998-usai-pengumuman-msci
- Kontan — MSCI Ancam Turunkan Status Pasar Saham Indonesia, IHSG Anjlok: https://investasi.kontan.co.id/news/msci-ancam-turunkan-status-pasar-saham-indonesia-ihsg-anjlok
- CNBC Indonesia — Respons MSCI Potensi Downgrade Bursa RI, Prabowo: Indonesia Tak Takut (21 Okt 2026): https://www.cnbcindonesia.com/market/20261021161750-17-778300/respons-msci-potensi-downgrade-bursa-ri-prabowo-indonesia-tak-takut
- detikNews — Pesan Prabowo ke MSCI, Tegaskan Tidak Takut: https://news.detik.com/berita/d-8718327/pesan-prabowo-ke-msci-tegaskan-tidak-takut
- Tempo — Prabowo: MSCI Mau Menakut-nakuti Kita: https://www.tempo.co/politik/prabowo-msci-pasar-saham-2301428
- Bloomberg Technoz — Prabowo Tanggapi MSCI: Kita Tidak Takut, Tidak Akan Gentar: https://www.bloombergtechnoz.com/detail-news/125329/prabowo-tanggapi-msci-kita-tidak-takut-tidak-akan-gentar

Fakta yang dipakai: IHSG ditutup -11,57% ke 5.185,10 (16/10/2026), terdalam sejak 1998; MSCI mengusulkan status pasar saham RI turun ke Standalone Market (15/10/2026), batas konsultasi 30/4/2027, keputusan final paling lambat 30/6/2027; Presiden Prabowo menanggapi di sidang kabinet (21/10/2026). Chart candle di adegan AI berlabel "ilustrasi" (bukan data pasar asli); harga kripto tidak ditampilkan.

## Privasi
Nama tim (Alif, Derencalibur, Nengok, Irsyad, Natasha) tampil. Identitas clipper (nama, foto, @handle, email, nomor WA, link TikTok) **tidak pernah digambar sebagai teks asli** — diganti balok/placeholder tersamar, jadi tetap aman di render laptop maupun render browser.

## Dua versi video
- **Tanpa VO** — `assets/videos/teaser-cs-tracker-tanpa-vo.mp4` (render lewat mesin render Studio di laptop/CLI, komposisi `TeaserCsTracker`). Bisa didownload di Studio → 🧩 Template → "Teaser CS Tracker (premium)".
- **Dengan VO** — Studio Pro → 🎞️ **Buka Teaser CS Tracker** → **Bikin suara VO** → Download "Dengan VO".
  - Laptop suara nyala → suara "Alif - Energik" (Chatterbox).
  - Laptop mati → suara cadangan Edge-TTS (id-ID Ardi), diberi label & nama file **"VO sementara"**. Setelah laptop nyala, klik **Generate ulang VO** untuk ganti ke suara Alif.

## Lisensi aset
- Remotion: gratis untuk tim ≤ 3 orang; lebih dari itu wajib Company License (lihat README).
- SFX: Sonniss GDC (royalty-free, boleh di video, tidak boleh disebar ulang sebagai file SFX → disajikan lewat route wajib login) + CC0.
- Musik: trailer bed disusun dari SFX di atas (tanpa musik berhak cipta).
- Font: Inter, Plus Jakarta Sans, Inter Tight (SIL Open Font License).
- Logo Konten.com & TWS: aset milik sendiri.
