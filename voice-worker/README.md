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
| Upload video gagal (file besar) | Paket gratis Supabase membatasi ukuran file (±50 MB). Render video lebih pendek atau naikkan batas di Supabase. |
| `Skor kealamian UTMOS tidak dipakai di sesi ini` | Tidak masalah: suara tetap dibuat & dipilih dari kejelasan + nada. Biasanya karena unduhan pertama (±410 MB dari GitHub) gagal / tanpa internet. Coba lagi dengan menyalakan ulang worker, atau matikan dengan `NATURAL_MOS=0`. |
| `Worker sudah jalan` | Sudah ada worker lain (mis. dari nyala otomatis). Cukup satu. |

**Tes tanpa GPU / model** (memastikan pemasangan benar):
```powershell
.venv\Scripts\python selftest.py
.venv\Scripts\python selftest_natural.py
```

---

## Isi folder

| File | Fungsi |
|---|---|
| `worker.py` | Program utama (antrian, detak jantung, Ctrl+C rapi, job gagal tidak bikin crash) |
| `jalankan.bat` / `pasang-otomatis.ps1` | Menjalankan manual / otomatis lewat Task Scheduler |
| `install.ps1`, `requirements.txt`, `requirements-gpu.txt` | Pemasang (urutan paket penting — pakai `install.ps1`) |
| `cek_gpu.py` | Cek GPU + tes suara |
| `selftest.py`, `selftest_natural.py` | Tes mandiri tanpa GPU/model (`selftest_natural.py`: suara natural — nada, jeda, sambungan, tempo) |
| `tambah_sfx.py`, `freesound_cc0.py` | Tambah SFX |
| `studio_worker/` | Isi mesin: `engines/` (Chatterbox, pocket-tts), `clean.py` (pembersih), `natural.py` (skor kealamian, room tone, jeda alami), `post.py` (EQ/kompresor/loudness), `asr.py` (cek ucapan), `beats.py`, `mix.py`, `jobs_*.py`, `seed.py`, `supa.py` (Supabase) |
| `bank-suara/` | Rekaman referensi suara Alif (jangan diubah) |
| `data/` | Dibuat otomatis: log, cache suara, model, file sementara (tidak masuk Git) |

## Pengaturan `.env` lain
Lihat `.env.example`. Yang paling sering diubah: `CPU_THREADS`, `TAKES` (jumlah versi per baris untuk job yang tidak membawa
setelan, 1–4, bawaan 3 — website Studio sekarang selalu meminta 3 versi, jadi angka ini tidak mengubah job dari website; laptop lambat
tidak perlu diatur: versi ke-3 otomatis dilewati kalau batas waktu per baris terlewati, minimal 2 versi), `NATURAL_MOS` (skor kealamian, 1 = nyala), `WHISPER_MODEL` (`small` bawaan; `medium` lebih akurat tapi lebih
berat), `RENDER_ENABLED`, `IDLE_UNLOAD_MIN`.

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
