# voice-worker — mesin suara gratis di laptop (Studio Pro)

Program kecil yang jalan terus di **laptop Windows** dan mengerjakan pekerjaan berat dari website Studio Pro,
**satu per satu** (supaya bot WAHA di laptop yang sama tetap lancar):

| Pekerjaan | Hasilnya |
|---|---|
| **Suara VO** (bank suara) | Naskah dibacakan dengan suara dari bank suara (mis. *Alif - Energik*). Tiap baris dibaca **satu tarikan** (intonasi utuh, tidak dipotong per kalimat), dibuat beberapa versi (bawaan 3 bila website tidak menentukan) lalu dipilih yang paling jelas **dan** paling natural (nada naik-turun, tidak datar). Jeda diisi suara ruangan asli, bukan hening mati. Hasil: file suara per adegan + VO lengkap (.mp3) + subtitle (.srt). Di adegan teaser (durasi dikunci di ketukan musik), kalimat yang kepanjangan dibuat ulang dengan tempo bicara lebih cepat dulu; sisanya baru dipercepat (maks 30%) tanpa mengubah nada. |
| **Bersihkan rekaman** | Rekaman bank suara dibersihkan dari bising (makin bersih rekamannya, makin ringan pembersihannya), dipotong otomatis ±10 detik yang **paling hidup** (nada naik-turun), volume disamakan, diberi nilai kualitas + saran. |
| **Ketukan musik** | BPM & ketukan musik dideteksi supaya potongan video jatuh pas di ketukan. |
| **Render MP4** | Video dirender di laptop (alternatif gratis selain render di browser), volume akhir -14 LUFS. |

Mesin suara dipilih otomatis:
1. **Chatterbox-TTS-Indonesian** di GPU (paling bagus, bisa meniru suara dari klip 10 detik).
2. Kalau GPU bermasalah → **pocket-tts-indonesian** di CPU (lebih lambat, tetap jalan).
3. Kalau dua-duanya gagal → website otomatis memakai cadangan **Edge-TTS** (dijalankan server website, bukan laptop).

Kalau laptop mati, website tetap jalan (pakai cadangan). Begitu laptop menyala lagi, antrian dikerjakan otomatis.

---

## Yang dibutuhkan

- Windows 10/11 64-bit, internet.
- GPU NVIDIA (laptop ini: **RTX 5050 Laptop 8 GB**). Tanpa GPU tetap bisa (pakai CPU, lebih lambat).
- Ruang kosong **±20 GB** (Python + model suara ±6 GB + paket website untuk render).
- Akses ke **Supabase** project website (untuk mengambil kunci `service_role`).

---

## Cara pasang (sekali saja)

### 1. Update driver NVIDIA
Buka **NVIDIA App** (atau GeForce Experience) → *Drivers* → pasang versi terbaru.
RTX 50xx butuh driver **570 atau lebih baru**. Restart laptop setelahnya.

### 2. Pasang Git & ambil repo
1. Unduh Git: <https://git-scm.com/download/win> → klik *Next* sampai selesai.
2. Buka **PowerShell** (klik Start, ketik `powershell`, Enter), lalu:
   ```powershell
   cd C:\
   mkdir Konten.com -ErrorAction SilentlyContinue
   cd C:\Konten.com
   git clone <alamat repo dari admin> Hot-Issue-Konten.com
   cd Hot-Issue-Konten.com\voice-worker
   ```

### 3. Pasang Node.js 20 (untuk render MP4)
Unduh **Node.js 20 LTS** dari <https://nodejs.org> → *Next* sampai selesai.
(Kalau tidak butuh render MP4 di laptop, langkah ini boleh dilewati.)

### 4. Pasang ffmpeg
Di PowerShell:
```powershell
winget install --id Gyan.FFmpeg -e
```
Lalu **tutup dan buka lagi PowerShell** (supaya ffmpeg terbaca). Cek: `ffmpeg -version`.

### 5. Jalankan pemasang
Masih di folder `voice-worker`:
```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
Pemasang otomatis:
- memasang **uv** dan **Python 3.11** (tidak mengganggu Python lain di laptop),
- memasang **PyTorch CUDA 12.8 (cu128)** — wajib untuk RTX 50xx (Blackwell / sm_120),
- memasang Chatterbox (tanpa dependensi lama yang mengunci PyTorch versi lama), pocket-tts, DeepFilterNet, faster-whisper, librosa, dll.,
- memasang Remotion untuk render (`npm i --no-save @remotion/cli@4.0.535` di root repo, tidak mengubah package.json),
- membuat file `.env`.

Butuh 10–30 menit tergantung internet. Kalau ada tulisan **GAGAL**, baca pesannya lalu jalankan ulang (aman diulang).

### 6. Isi kunci Supabase di `.env`
```powershell
notepad .env
```
Isi 2 baris ini:
```
SUPABASE_URL=https://xxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi....
```
Ambil dari **Supabase Dashboard → Project Settings → API** (`Project URL` dan kunci **service_role**).

> **PENTING:** kunci `service_role` = kunci master database. **Hanya** disimpan di file `.env` laptop ini.
> Jangan dikirim lewat chat, jangan di-screenshot, jangan di-commit. File `.env` sudah diabaikan Git
> (`.gitignore` di root repo dan di `voice-worker/`).

### 7. Cek GPU & tes suara
```powershell
.venv\Scripts\python cek_gpu.py
```
Yang dicek: GPU terbaca PyTorch, versi CUDA cocok untuk RTX 50xx, tes 1 kalimat Chatterbox di GPU,
ffmpeg, faster-whisper, DeepFilterNet, Node + Remotion. Hasil suara tes disimpan di `data\tes-chatterbox.wav` — dengarkan.
Pertama kali akan **mengunduh model ±3–5 GB** (sekali saja).

Kalau muncul **"pindah ke pocket-tts"**: GPU belum bisa dipakai (lihat *Masalah umum*). Worker tetap jalan pakai CPU.

### 8. Jalankan
**Paling gampang:** klik dua kali **`NYALAKAN-MESIN-SUARA.bat`** di folder utama repo (boleh juga disalin ke Desktop).
Isinya otomatis: `git pull` → pasang ulang paket hanya kalau ada yang berubah → nyalakan worker.

Atau manual: klik dua kali **`jalankan.bat`** (atau dari PowerShell: `.\jalankan.bat`). Biarkan jendelanya terbuka.
- `Ctrl+C` sekali = berhenti setelah tugas yang sedang jalan selesai.
- `Ctrl+C` dua kali = berhenti sekarang (tugas dikembalikan ke antrian).

Saat pertama jalan, worker otomatis mengisi **bank suara** dari folder `bank-suara/`
(*Alif - Energik* dan *Alif - Tenang*) lalu membersihkannya.

### 9. Nyala otomatis saat laptop hidup
```powershell
powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1
```
Worker akan menyala sendiri (tanpa jendela) setiap kamu login, dan dicek tiap 10 menit — kalau mati, dinyalakan lagi.
Menghapusnya: `powershell -ExecutionPolicy Bypass -File .\pasang-otomatis.ps1 -Hapus`.

---

## Cara cek worker masih jalan

1. **Di website**: halaman Studio menampilkan status *mesin laptop* (online/offline, nama GPU, mesin suara, jumlah antrian).
   Worker mengirim "detak" tiap 20 detik; kalau lebih dari 60 detik tidak ada detak → dianggap mati.
2. **Log**: buka `voice-worker\data\logs\worker-<tanggal>.log` (satu file per hari, disimpan 14 hari).
3. **Task Scheduler** (kalau pakai nyala otomatis): Start → *Task Scheduler* → *Task Scheduler Library* →
   **Konten Studio voice-worker** → kolom *Status* harus *Running*.

## Alur kerja worker (supaya cepat) & log
- **Saat mulai**: worker mengecek model di laptop (hanya cek file, sekejap). Model yang belum ada **tidak pernah diunduh di tengah
  job** — komponennya dilewati dulu (Chatterbox → pocket-tts / Edge di website, cek ucapan → cek audio saja, DeepFilterNet → pembersih
  ffmpeg, UTMOS → versi dipilih dari kejelasan + nada) lalu diunduh di latar (`AUTO_DOWNLOAD=1`); begitu selesai langsung dipakai lagi.
- **Pemanasan** (`PRELOAD=1`, bawaan): mesin suara, cek ucapan (faster-whisper) & UTMOS dimuat **sekali** di latar dan tetap di GPU
  selama worker hidup. Antrian tetap dicek; job yang datang saat pemanasan menunggu sebentar ("Menyiapkan mesin suara…").
  `.env` lama yang masih berisi `PRELOAD=0` bawaan dulu otomatis dianggap 1 (mematikan: `PRELOAD=mati`).
- **Selama job**: progres dikirim ke website di latar (paling sering 1× per detik, GPU tidak menunggu internet); mp3 tiap kalimat dibuat
  & diunggah sambil kalimat berikutnya dibuat (`UPLOAD_WORKERS`, bawaan 3 sekaligus); `full.mp3` & SRT diunggah bersamaan. Tombol batal
  di website menghentikan job di batas kalimat berikutnya.
- **Perkiraan selesai**: pesan job di Studio diakhiri `· sisa ±40 dtk` / `· sisa ±2 mnt`, dihitung dari catatan kecepatan laptop ini
  (`data/speed.json`, makin tepat setelah beberapa job) dan diperbarui tiap kalimat selesai. Render MP4 juga (perkiraan muncul setelah
  ±10%). Detak jantung mengirim kecepatan (`info.speed`), status model (`info.models`) dan `info.warm` (mesin sudah panas).
- **Cek antrian**: tiap 1 dtk selama 1 menit sesudah job (job susulan langsung terambil), lalu tiap `POLL_SEC`, dan tiap ≥ 10 dtk kalau
  sudah 30 menit menganggur.
- **Log bersih** (`QUIET_LOG=1`, bawaan): peringatan library yang tidak penting (FutureWarning / DeprecationWarning torch, torchaudio,
  transformers, diffusers, pkg_resources, librosa, DeepFilterNet; "EOS token detected", "Detected 2x repetition", "forcing EOS" dari
  Chatterbox) dan progress bar per langkah disembunyikan. Peringatan & error dari worker sendiri tetap tampil. Tiap job ditutup ringkasan,
  mis. `Job selesai: 5 kalimat, 32 dtk suara, 41 dtk proses (perkiraan awal 45 dtk)`. Mencari masalah? Isi `QUIET_LOG=0` → semua tampil lagi.

## Render MP4 pakai GPU NVIDIA
Laptop ini punya 2 GPU (Intel bawaan + NVIDIA RTX). Tanpa diatur, Windows memberi Chrome render (Remotion) GPU **Intel** dan
video di-encode CPU → render lambat. Dengan `RENDER_GPU=auto` (bawaan) worker otomatis:
1. mendeteksi NVIDIA (`nvidia-smi`),
2. mengunduh Chrome render kalau belum ada (`remotion browser ensure`) lalu mengatur exe-nya ke GPU **High performance** di
   pengaturan Windows (registry pengguna `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`, sama dengan menu Settings > Graphics,
   tanpa hak admin) — exe-nya: `node_modules\.remotion\chrome-headless-shell\win64\chrome-headless-shell-win64\chrome-headless-shell.exe`
   di folder repo (atau `REMOTION_BROWSER` kalau diisi),
3. merender dengan `--gl=angle` (gambar di GPU) + `--hardware-acceleration=if-possible --video-bitrate=10M` (encode video NVENC),
4. kalau render seperti itu gagal → diulang sekali dengan cara lama (encode CPU) dan sampai worker dinyalakan ulang NVENC tidak dipakai lagi.

Cek di log (sekali per sesi, saat worker mulai — atau saat render pertama kalau Chrome render belum diunduh):
**`Render memakai GPU: NVIDIA GeForce RTX 5050 Laptop GPU (ANGLE, D3D11)`** = sudah benar.
Kalau tertulis Intel / SwiftShader, atur manual sekali: **Settings > System > Display > Graphics** → *Add desktop app* (*Browse*) →
pilih `chrome-headless-shell.exe` di atas → *Options* → **High performance** → *Save*, lalu nyalakan ulang worker.
Matikan semuanya dengan `RENDER_GPU=off`; `RENDER_GPU=nvidia`
memaksa walau `nvidia-smi` tidak terbaca. `RENDER_BITRATE` (bawaan `10M`) = kualitas video saat encode NVENC.
`RENDER_CONCURRENCY=auto` = jumlah tab Chrome render sesuai core CPU (2–4; bawaan tetap 2).

## Update setelah ada perubahan di repo
```powershell
cd C:\Konten.com\Hot-Issue-Konten.com
git pull
cd voice-worker
powershell -ExecutionPolicy Bypass -File .\install.ps1
```
Lalu restart worker (tutup jendela `jalankan.bat` dan buka lagi, atau restart laptop kalau pakai nyala otomatis).

---

## Tambah SFX

**Dari folder Sonniss (lokal):**
```powershell
.venv\Scripts\python tambah_sfx.py --coba                       # lihat dulu tebakan kategori, tanpa upload
.venv\Scripts\python tambah_sfx.py                              # folder bawaan C:\Konten.com\STUDIO-FX
.venv\Scripts\python tambah_sfx.py "D:\SFX\Whoosh" --maks 20
.venv\Scripts\python tambah_sfx.py --juga-json                  # juga masuk assets/audio/sfx/sfx.json (lalu commit)
```
Tiap file dikonversi ke mp3 48 kHz 192 kbps, diukur LUFS / true peak / durasi / titik "pukulan",
ditebak kategori & tag dari nama file/folder (whoosh, impact, boom, braam, riser, ui, glitch, koin, foley, ambience, transisi, magic),
lalu di-upload ke penyimpanan Studio dan langsung muncul di katalog SFX website. File yang sudah pernah diimpor otomatis dilewati.

**Dari Freesound (hanya lisensi CC0):** isi `FREESOUND_API_KEY` di `.env` (daftar gratis di <https://freesound.org/apiv2/apply>), lalu:
```powershell
.venv\Scripts\python freesound_cc0.py "whoosh" --jumlah 5
```

---

## Masalah umum

| Gejala | Solusi |
|---|---|
| `GPU tidak terdeteksi` / "pindah ke pocket-tts" | Update driver NVIDIA (≥ 570), restart, jalankan `install.ps1` lagi, lalu `cek_gpu.py`. |
| `butuh PyTorch CUDA 12.8+` | PyTorch terpasang versi lama. Jalankan `install.ps1` lagi (memasang ulang torch cu128). |
| `VRAM GPU penuh` | Tutup game / aplikasi berat lain. Worker otomatis mencoba sekali lagi lalu pindah ke pocket-tts. |
| Unduh model gagal / lambat | Cek internet. Kalau sering kena batas unduh HuggingFace, buat token gratis di huggingface.co → isi `HF_TOKEN` di `.env`. |
| `DeepFilterNet tidak bisa dipakai` | Model pembersih diunduh dari GitHub saat pertama dipakai. Kalau gagal, worker memakai pembersih ffmpeg (hasil sedikit kurang bersih). |
| Bot WAHA jadi lambat | Turunkan `CPU_THREADS` di `.env` (mis. 2). Worker sudah jalan dengan prioritas rendah & satu tugas sekaligus. |
| VRAM ingin dilepas saat menganggur | Isi `IDLE_UNLOAD_MIN=30` (model dilepas setelah 30 menit tanpa tugas, dimuat lagi saat ada tugas). |
| Render gagal | Pastikan Node.js 20 terpasang lalu `install.ps1` lagi. Render pertama mengunduh Chrome khusus render (±100 MB). Kalau unduhan itu diblokir jaringan, unduh *chrome-headless-shell* (Chrome for Testing) sendiri lalu isi path-nya di `REMOTION_BROWSER` (`.env`). |
| Render lambat / Task Manager menunjukkan GPU Intel | Lihat log: `Render memakai GPU: …`. Kalau bukan NVIDIA, ikuti langkah manual di bagian *Render MP4 pakai GPU NVIDIA*. Pastikan `RENDER_GPU` bukan `off`. |
| Log `NVENC … tidak bisa dipakai` | Driver NVIDIA lama / ffmpeg Remotion tanpa NVENC. Render tetap jalan (encode CPU). Update driver NVIDIA lalu nyalakan ulang worker. |
| Upload video gagal (file besar) | Paket gratis Supabase membatasi ukuran file (±50 MB). Render video lebih pendek atau naikkan batas di Supabase. |
| `Skor kealamian UTMOS tidak dipakai di sesi ini` | Tidak masalah: suara tetap dibuat & dipilih dari kejelasan + nada. Biasanya karena unduhan pertama (±410 MB dari GitHub) gagal / tanpa internet. Coba lagi dengan menyalakan ulang worker, atau matikan dengan `NATURAL_MOS=0`. |
| `Worker sudah jalan` | Sudah ada worker lain (mis. dari nyala otomatis). Cukup satu. |

**Tes tanpa GPU / model** (memastikan pemasangan benar):
```powershell
.venv\Scripts\python selftest.py
.venv\Scripts\python selftest_natural.py
.venv\Scripts\python selftest_runtime.py
```

---

## Isi folder

| File | Fungsi |
|---|---|
| `worker.py` | Program utama (antrian, detak jantung, Ctrl+C rapi, job gagal tidak bikin crash) |
| `jalankan.bat` / `pasang-otomatis.ps1` | Menjalankan manual / otomatis lewat Task Scheduler |
| `install.ps1`, `requirements.txt`, `requirements-gpu.txt` | Pemasang (urutan paket penting — pakai `install.ps1`) |
| `cek_gpu.py` | Cek GPU + tes suara |
| `selftest.py`, `selftest_natural.py`, `selftest_runtime.py` | Tes mandiri tanpa GPU/model (`selftest_natural.py`: suara natural — nada, jeda, sambungan, tempo; `selftest_runtime.py`: alur worker — progres latar, batal, perkiraan sisa, unggah paralel, cek antrian, pemanasan, log bersih) |
| `tambah_sfx.py`, `freesound_cc0.py` | Tambah SFX |
| `studio_worker/` | Isi mesin: `engines/` (Chatterbox, pocket-tts), `clean.py` (pembersih), `natural.py` (skor kealamian, room tone, jeda alami), `post.py` (EQ/kompresor/loudness), `asr.py` (cek ucapan), `beats.py`, `mix.py`, `jobs_*.py`, `seed.py`, `supa.py` (Supabase) |
| `bank-suara/` | Rekaman referensi suara Alif (jangan diubah) |
| `data/` | Dibuat otomatis: log, cache suara, model, file sementara (tidak masuk Git) |

## Pengaturan `.env` lain
Lihat `.env.example`. Yang paling sering diubah: `CPU_THREADS`, `TAKES` (jumlah versi per baris untuk job yang tidak membawa
setelan, 1–4, bawaan 3 — website Studio sekarang selalu meminta 3 versi, jadi angka ini tidak mengubah job dari website; laptop lambat
tidak perlu diatur: jumlah versi otomatis dikurangi kalau tidak sempat, lihat **Kecepatan mesin suara** di bawah), `NATURAL_MOS` (skor kealamian, 1 = nyala), `WHISPER_MODEL` (`small` bawaan; `medium` lebih akurat tapi lebih
berat), `RENDER_ENABLED`, `IDLE_UNLOAD_MIN`, `PRELOAD` (1 = panaskan mesin di latar saat mulai), `UPLOAD_WORKERS` (unggahan
bersamaan, bawaan 3), `QUIET_LOG` (1 = log bersih, 0 = semua peringatan tampil).

## Kecepatan mesin suara
Kenapa dulu lambat (6,5 detik suara butuh ±32 detik) dan apa yang diubah:
- **Hook yang bocor.** Chatterbox bawaan memasang 3 "penyadap" attention baru di setiap kalimat tanpa pernah melepasnya — tiap
  penyadap menyalin data ke CPU di setiap langkah, jadi worker makin lama makin lambat. Sekarang dipasang **sekali** saja.
- **Semua 30 layer dipaksa ke mode attention lambat** (eager) hanya untuk mengecek keselarasan teks. Sekarang hanya 3 layer yang
  dicek memakai mode itu, 27 sisanya memakai SDPA (cepat).
- **Versi dibuat satu-satu.** 3 versi = 3× waktu. Sekarang 3 versi dibuat **sekaligus** di GPU (konteks suara + teks dihitung sekali);
  GPU mengerjakan beberapa baris hampir sama cepatnya dengan satu baris. Tiap versi tetap punya benih acaknya sendiri.
- **bf16** (RTX 30xx ke atas, termasuk RTX 50xx): transformer dijalankan bf16, bagian lain tetap fp32. Kalau muncul angka tidak wajar,
  otomatis kembali ke fp32 untuk sesi itu.
- **Batas panjang dari teks.** Dulu tiap versi boleh sampai 40 detik suara; versi yang "nyasar" membuang waktu sampai batas itu.
  Sekarang batasnya ±2,5× perkiraan panjang kalimat.
- **Muat model lebih cepat**: model dicari di laptop dulu (tanpa cek internet), modul dibangun langsung di GPU, bobot dibaca langsung
  ke GPU. Model belum diunduh → pesan "jalankan SIAPKAN-MODEL.bat" (tidak pernah mengunduh di tengah job).
- **Cek ucapan tiap versi** memakai faster-whisper beam 1 langsung dari memori (tanpa tulis file); timestamp kata hasil akhir tetap
  teliti (beam 5).
- **Batas waktu per kalimat dihitung dari panjang kalimat** (bawaan `max(20 dtk, 8 × panjang ucapan)`, dulu minimal 45 dtk tetap).
  Jumlah versi otomatis disesuaikan dari kecepatan laptop yang tercatat (`data/speed.json`): kalau 3 versi diperkirakan tidak sempat,
  dibuat 2 atau 1 (alasannya tertulis di log). Semua versi salah ucap → dicoba sekali lagi maksimal 2 versi kalau waktunya cukup.

Contoh baris log per potongan: `6,5 dtk suara dalam 9,8 dtk (3 versi sekaligus)` (angkanya tergantung laptop).

Ukur sendiri di laptop: matikan worker, lalu klik dua kali **`UKUR-KECEPATAN.bat`** (±2–4 menit). Hasilnya tabel cara lama vs cara
baru (detik suara per detik proses, langkah/detik, VRAM puncak), file `data/bench-<tanggal>.json`, dan contoh suara
`data/bench-A.wav` (lama) / `data/bench-C.wav` (baru) untuk didengar.

Pengaturan (`.env`, biarkan bawaan kecuali ada masalah):

| Nama | Bawaan | Arti |
|---|---|---|
| `TTS_DTYPE` | `auto` | `auto` = bf16 kalau GPU mendukung; `fp32` = paling aman (lebih lambat) |
| `TTS_BATCH` | `1` | `1` = versi satu kalimat dibuat sekaligus; `0` = satu-satu |
| `ASR_BEAM_TAKES` | `1` | ketelitian cek ucapan tiap versi (1 = cepat) |
| `LINE_BUDGET_PER_SEC` | `8` | batas waktu per kalimat = detik ucapan × angka ini … |
| `LINE_BUDGET_MIN` | `20` | … tapi minimal sekian detik |

Tes mandiri jalur cepat (bobot acak di CPU, tanpa GPU/internet): `.venv\Scripts\python selftest_cepat.py` (`--ringan` = tanpa torch).

---

## Supaya suara tidak kedengeran AI
Panduan lengkap: [`docs/suara-natural.md`](../docs/suara-natural.md). Ringkasnya:
- **Rekaman referensi menentukan gaya bicara.** Chatterbox meniru cara bicara di rekaman, termasuk datarnya. Rekam 10–20 detik
  dengan gaya yang SAMA dengan videonya (ngobrol / semangat), nada naik-turun, di ruangan sepi, mulut ±15–20 cm dari mic.
- Worker memilih potongan rekaman yang paling hidup, membaca tiap baris satu tarikan, membuat beberapa versi (bawaan 3), lalu memilih yang paling jelas
  dan paling natural (**skor kealamian**: nada tidak datar + perkiraan MOS 1–5 dari UTMOS).
- Skor kealamian bisa dimatikan: isi `NATURAL_MOS=0` di `.env` lalu jalankan ulang worker. Suara tetap dibuat, dipilih dari kejelasan + nada.
- Huruf e salah bunyi ("bareng" jadi "baréng")? Pakai **🎧 Coba ejaan huruf e** di panel Suara VO: satu job berisi kalimat yang sama
  dengan beberapa ejaan (`settings.purpose = "coba-ejaan"`, 1 versi, benih `seed` sama untuk semua) → dengar, pilih yang pas.

---

## Etika suara
Bank suara **hanya** untuk suara milik sendiri atau yang **sudah memberi izin** (website mewajibkan centang izin,
worker menolak suara tanpa izin). Suara Alif di `bank-suara/` dipakai atas izin pemiliknya, khusus CS Tracker.
Audio dari Chatterbox diberi watermark tak terdengar (Perth dari Resemble AI) sebagai penanda suara buatan AI.

## Kredit & lisensi
- **Chatterbox-TTS-Indonesian** — grandhigh, <https://huggingface.co/grandhigh/Chatterbox-TTS-Indonesian> (Apache-2.0),
  berbasis **Chatterbox** dari Resemble AI (<https://github.com/resemble-ai/chatterbox>, MIT).
- **pocket-tts-indonesian** — tryzz889, <https://huggingface.co/tryzz889/pocket-tts-indonesian>, lisensi **CC-BY-4.0**
  (atribusi wajib: *"pocket-tts-indonesian oleh tryzz889 (CC-BY-4.0), berbasis Pocket TTS dari Kyutai"* — ditulis juga di log
  dan di hasil job saat mesin ini dipakai). Pocket TTS © Kyutai.
- **DeepFilterNet** — Hendrik Schröter (MIT / Apache-2.0).
- **faster-whisper** (SYSTRAN, MIT) dengan model **Whisper** (OpenAI, MIT).
- **librosa** (ISC), **pyloudnorm** (MIT), **ffmpeg** (LGPL/GPL, dipasang terpisah).
- **Remotion** — gratis untuk perorangan & tim kecil; perusahaan besar butuh lisensi (lihat <https://remotion.dev/license>).
- SFX **Sonniss GDC 2026 Game Audio Bundle** (royalty-free, tanpa atribusi, jangan dibagikan ulang sebagai file mentah);
  SFX Freesound yang ditambah lewat skrip **hanya CC0**.
