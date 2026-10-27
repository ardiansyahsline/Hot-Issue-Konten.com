# Suara VO yang natural (tidak kedengeran AI)

Panduan singkat untuk bank suara (Chatterbox di laptop). Berlaku untuk suara yang dibuat worker laptop, bukan cadangan Edge-TTS.

## 1. Rekam referensi yang benar (paling berpengaruh)

Chatterbox **meniru cara bicara di rekaman referensi**: kalau rekamannya datar, hasilnya ikut datar.

| Lakukan | Hindari |
|---|---|
| Rekam **10–20 detik**, bicara terus tanpa jeda panjang | Rekaman < 6 detik atau banyak diam |
| Gaya **sama dengan videonya**: teaser/promo → semangat, tutorial → ngobrol santai | Membaca naskah dengan nada datar seperti membaca berita |
| Nada **naik-turun** wajar: tanya naik, akhir kalimat turun, beri tekanan di kata penting | Tertawa, batuk, berteriak, musik di belakang |
| Ruangan **sepi** (tutup jendela, matikan kipas/AC kalau bisa) | Ruangan bergema (kamar mandi, ruangan kosong) |
| Mulut **±15–20 cm** dari mic, volume stabil, tidak pecah | Terlalu dekat (napas "plop") atau terlalu jauh |

Setelah upload, worker otomatis:
- membersihkan bising **secukupnya** (rekaman sudah bersih → dibersihkan ringan, supaya suara tidak "metalik");
- memilih potongan ±10 detik yang **paling hidup** (nada paling naik-turun, banyak bicara, tanpa jeda panjang / suara pecah).

Suara lama yang dibersihkan versi sebelumnya otomatis **dibersihkan ulang sekali** saat dipakai berikutnya. Kalau gagal, rekaman
bersih lama tetap dipakai.

## 2. Cara worker membuat suara supaya natural

1. **Satu tarikan**: satu baris naskah (≤ 260 huruf) dibaca sekali jalan, jadi intonasi tidak "reset" tiap kalimat. Baris yang
   lebih panjang dipotong di akhir kalimat.
2. **Beberapa versi per baris**: website selalu meminta 3 versi (`TAKES` di `.env`, 1–4, hanya untuk job tanpa setelan).
   Laptop lambat tidak perlu diatur: versi ke-3 dilewati otomatis kalau batas waktu per baris (maks(45 dtk, 6 × durasi ucapan))
   terlewati, minimal 2 versi — jadi job paling lama ±1,5× dibanding 2 versi dulu. Website mengirim 3 versi + angka **gaya bicara** (Natural ngobrol / Promo energik / Tenang meyakinkan / Kustom: ekspresi,
   tempo, variasi) yang sama untuk "Generate ulang VO", 🔊 Dengar, dan kecepatan per kalimat di Timeline. Versi yang paling jelas menang; kalau ada beberapa yang sama jelasnya, dipilih
   yang **paling natural**.
3. **Jeda alami**: jeda antar kalimat dijaga 0,25–0,6 detik (sesudah "…" 0,45–0,7 detik) dan diisi **suara ruangan** dari rekaman
   referensi, bukan hening mati. Ujung kalimat (napas, nada turun) tidak terpotong. Jeda hanya dipanjangkan kalau mesin memang
   berhenti di situ (≥ 0,12 detik); jeda koma tidak pernah dipanjangkan, jadi tidak ada "putus" di tengah kata.
   Potongan yang disambung (baris panjang / mode per kalimat) disamakan volumenya supaya tidak ada lompatan keras-pelan.
4. **Adegan teaser yang kepanjangan**: kalimat dibuat ulang dengan tempo bicara lebih cepat dulu (lebih natural), baru sisanya
   dipercepat (maks 30%, nada tetap).

## 3. Apa itu skor kealamian

Dipakai untuk memilih versi terbaik, dan ditampilkan per baris di hasil job (`natural`):

| Isi | Arti |
|---|---|
| **Variasi nada** (`st`) | Seberapa naik-turun nadanya (semitone). Bicara biasa ±2–4. Di bawah ±1,8 dianggap **datar/monoton**. |
| **MOS** (`mos`) | Perkiraan "seberapa alami" 1–5 dari model UTMOS (gratis, MIT). 4 ke atas = bagus. Kosong = tidak dipakai. |
| **Dipercepat** (`native` / `atempo`) | Persen dipercepat lewat tempo bicara asli vs. dipercepat mesin (atempo). Atempo makin kecil makin natural. |
| **Mode** (`mode`) | `satu-tarikan` (normal) atau `per-kalimat` (cadangan kalau satu tarikan salah ucap terus). |

Tiap baris hasil job juga membawa `heard`: teks yang terdengar oleh pengecek ucapan (ASR) dari versi yang dipakai (maks 400 huruf;
kosong kalau ASR tidak ada). Website menampilkannya di kartu adegan sebagai **👂 Terdengar** dan menyorot kata yang salah ucap
(mis. "soal" terdengar "su ul") supaya ejaannya bisa diperbaiki lewat kamus. Bunyi luncur dari ejaan mesin suara (soal → sowal,
dia → diya) tidak dihitung salah ucap saat memilih versi.

## 4. Mematikan skor MOS

Pertama kali dipakai, UTMOS mengunduh ±410 MB dari GitHub. Kalau tidak mau / internet terbatas:

1. Buka `voice-worker\.env`, isi `NATURAL_MOS=0`.
2. Jalankan ulang worker.

Suara tetap dibuat dan dipilih dari kejelasan + variasi nada. Tanpa internet, MOS juga mati sendiri tanpa error.

## 5. Kalau masih kedengeran AI

- Rekam ulang referensi dengan gaya yang lebih hidup (poin 1) — ini yang paling ampuh.
- Pakai tanda baca untuk ritme: koma = jeda pendek, "…" = jeda menggantung, "!" / "?" = nada naik. Kalimat 8–15 kata.
- Coba dengarkan A/B: Generate ulang (hasil baru karena versi cache naik) lalu bandingkan dengan hasil lama.
