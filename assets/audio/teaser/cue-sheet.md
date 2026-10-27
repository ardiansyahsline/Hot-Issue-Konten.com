# Cue Sheet Audio - Teaser CS Tracker (9:16, 30 fps, ±60 detik)

> **Catatan 27 Okt 2026:** teaser sekarang **tanpa musik / suara latar** (termasuk `ambience-gelap` & trailer bed) atas permintaan Alif — musik ditambah sendiri. Kolom "Musik" di bawah = level kalau musik ditambah.

ID SFX merujuk ke `assets/audio/sfx/sfx.json`. Waktu = target; tempel ke ketukan musik terdekat.
Level awal disarankan: musik -18 LUFS (turun ±8 dB saat VO), SFX aksen -16 s/d -12 LUFS, VO -16 LUFS.

| Waktu | Adegan | Visual (ringkas) | SFX | Musik | VO |
|---|---|---|---|---|---|
| 0.0 - 3.0 | Hook | Potongan cepat masalah: hot issue numpuk, chat berantakan, data kececer | `glitch-error` (0.0), `ui-snap` tiap potongan, ~~`ambience-gelap` pelan di bawah~~ (dibuang 27 Okt), `braam-transisi-gelap` (1.2) | Intro pelan / build-up | #1 |
| 3.0 - 5.0 | Reveal | Logo CS Tracker + light sweep | `riser-blastoff` berakhir tepat 3.0, `braam-epik-1` + `impact-chord` (3.0) | Hit pertama | #2 |
| 5.0 - 10.0 | Dashboard + Hot Issue | Angka berjalan, badge HOT naik ke #1 | `swoosh-readout` (5.1), `ui-scifi-ping` saat HOT naik, `koin-ting` di angka | Groove masuk | #3 |
| 10.0 - 15.0 | Issue & Video Review | Kartu status digeser (Rilis/Banding/Menunggu) | `whoosh-cepat` tiap geser, `ui-accept-glassy` saat status dipilih | Groove | #4 |
| 15.0 - 21.0 | Chat tim (Alif, Derencalibur, Nengok, Irsyad, Natasha) | Bubble chat masuk, reaksi emoji, lampiran | `notif-chat` tiap pesan, `ui-accept-boing` saat reaksi, `ui-pop` lampiran | Groove (agak turun) | #5 |
| 21.0 - 33.0 | AI | AskCard muncul & dipilih, hero MBTI + label "dibantu oleh", langkah berpikir, jawaban, chart saham/kripto | `ai-magic` (21.0), `ui-arp-twinkle` hero muncul, `ui-readout-panjang` saat berpikir, `ui-accept-glassy` pilih kartu, `ui-plucks-happy` jawaban keluar, `koin-flip` di chart | Build kedua | #6 |
| 33.0 - 40.0 | Desain berita (TWS) | Cover dengan angka 3D "slam", carousel geser, export Figma | `bass-drop-cepat` + `impact-cut-sweep` saat angka slam, `kertas-balik-halaman` tiap slide, `ui-pop` download | Drop / klimaks 1 | #7 |
| 40.0 - 46.0 | Train your AI | Kuis diketuk, animasi tipe muncul, pilih peran | `ui-snap` tiap jawaban, `ai-magic` + `sukses-happy` saat tipe muncul, `whoosh-confetti` | Energi tinggi | #8 |
| 46.0 - 50.0 | Musik + laporan/PPT | Pemutar musik, halaman laporan/PPT dibalik | `kertas-balik-halaman`, `ui-plucks-happy` | Menuju klimaks | #9 |
| 50.0 - 55.0 | Montage cepat + Studio | Potongan 0.3-0.5 detik semua fitur, terakhir tampilan Studio | `transisi-shaker-snap` / `transisi-snap-spin` tiap ketukan, `bass-drop-jumpstart` awal montage, `glitch-tinggi` sekali | Klimaks / drop terbesar | #10 (di akhir) |
| 55.0 - 60.0 | Outro | Logo + tagline + CTA | `whoosh-debris` (55.0), `boom-trailer-1` + `braam-epik-2` (55.5), hening total 59.6 | Hit akhir, potong bersih | #11 |

Aturan tambahan:
- Jangan menumpuk lebih dari 2 SFX keras di saat yang sama; VO selalu paling jelas.
- Transisi & impact harus jatuh tepat di ketukan (toleransi ±1 frame).
- Musik berhenti di ketukan terakhir, beri 0.3-0.5 detik hening sebelum video habis.
- (Tidak berlaku lagi untuk teaser sejak 27 Okt — teaser tanpa musik.) Kalau `music/musik-teaser.mp3` tidak ada: susun trailer bed dari `trailer-pulse-sedang` (groove),
  `trailer-pulse-panjang` (sustain), `boom-trailer-*` (ketukan berat), `braam-*` (reveal/outro), `riser-blastoff` (build-up).
