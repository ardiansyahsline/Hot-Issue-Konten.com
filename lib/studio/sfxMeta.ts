/**
 * Katalog SFX bawaan Studio (dibuat dari assets/audio/sfx/sfx.json + analisis transien).
 * `hit` = detik ke berapa di dalam file bunyi "pukulan"-nya terjadi -> saat SFX ditaruh di detik X, file mulai di X - hit
 * supaya pukulannya jatuh tepat di ketukan (latar panjang: ambience/trailer-pulse/glitch-error = 0). `peak` = detik paling keras (riser: puncak sebelum reveal).
 * File audionya TIDAK di public/: disajikan lewat /api/studio/asset (wajib login + akses Studio).
 * Lisensi: Sonniss GDC 2026 Game Audio Bundle (royalty-free, tanpa atribusi, jangan dibagikan ulang sebagai file mentah).
 */
export type SfxMeta = { id: string; file: string; cat: string; tags: string[]; dur: number; lufs: number; tp: number; hit: number; peak: number; use: string; src?: string };

export const SFX_BUILTIN: SfxMeta[] = [
  { id: "ai-magic", file: "ai-magic.mp3", cat: "magic", tags: ["ai", "magis", "sparkle"], dur: 3.22, lufs: -20.2, tp: -3.1, hit: 0.15, peak: 0.71, use: "AI mulai bekerja / Train your AI hasil tipe" },
  { id: "ambience-gelap", file: "ambience-gelap.mp3", cat: "ambience", tags: ["ambience", "drone", "gelap", "tegang"], dur: 20.04, lufs: -20.2, tp: -7.3, hit: 0, peak: 10.22, use: "Latar hook (pelan, di bawah musik)" },
  { id: "bass-drop-cepat", file: "bass-drop-cepat.mp3", cat: "bass-drop", tags: ["bass", "drop", "cepat"], dur: 2.16, lufs: -13.7, tp: -5.2, hit: 0.19, peak: 1.36, use: "Angka/judul jatuh, beat drop singkat" },
  { id: "bass-drop-jumpstart", file: "bass-drop-jumpstart.mp3", cat: "bass-drop", tags: ["bass", "drop", "jump"], dur: 3.74, lufs: -10.8, tp: -3.1, hit: 0.08, peak: 0.12, use: "Awal montage / kick-off" },
  { id: "bass-drop-sedang", file: "bass-drop-sedang.mp3", cat: "bass-drop", tags: ["bass", "drop", "sedang"], dur: 4.51, lufs: -14.5, tp: -4.4, hit: 0.36, peak: 0.49, use: "Drop sebelum babak baru" },
  { id: "boom-trailer-1", file: "boom-trailer-1.mp3", cat: "boom", tags: ["boom", "trailer", "sinematik", "berat"], dur: 8.04, lufs: -7.8, tp: -1.2, hit: 0.29, peak: 0.3, use: "Ketukan berat di reveal & outro" },
  { id: "boom-trailer-2", file: "boom-trailer-2.mp3", cat: "boom", tags: ["boom", "trailer", "sinematik"], dur: 8.04, lufs: -17.6, tp: -1.3, hit: 0.28, peak: 0.3, use: "Aksen besar di pergantian babak" },
  { id: "boom-trailer-3", file: "boom-trailer-3.mp3", cat: "boom", tags: ["boom", "trailer", "sinematik"], dur: 8.04, lufs: -12.2, tp: -1.2, hit: 0.29, peak: 0.31, use: "Aksen besar / penutup" },
  { id: "braam-epik-1", file: "braam-epik-1.mp3", cat: "braam", tags: ["braam", "horn", "epik", "gelap"], dur: 8.04, lufs: -22.0, tp: -9.8, hit: 0.17, peak: 6.48, use: "Reveal logo, pembuka trailer" },
  { id: "braam-epik-2", file: "braam-epik-2.mp3", cat: "braam", tags: ["braam", "horn", "epik", "gelap"], dur: 8.04, lufs: -15.3, tp: -2.6, hit: 0.12, peak: 5.9, use: "Outro / klimaks" },
  { id: "braam-transisi-gelap", file: "braam-transisi-gelap.mp3", cat: "braam", tags: ["braam", "transisi", "tegang"], dur: 4.54, lufs: -17.1, tp: -3.2, hit: 0.28, peak: 2.54, use: "Hook masalah (suasana tegang)" },
  { id: "glitch-error", file: "glitch-error.mp3", cat: "glitch", tags: ["glitch", "error", "masalah"], dur: 5.47, lufs: -23.2, tp: -1.3, hit: 0, peak: 1.82, use: "Hook masalah (data berantakan)" },
  { id: "glitch-tinggi", file: "glitch-tinggi.mp3", cat: "glitch", tags: ["glitch", "digital"], dur: 3.02, lufs: -22.5, tp: -7.0, hit: 0.06, peak: 0.15, use: "Transisi digital / data" },
  { id: "impact-chord", file: "impact-chord.mp3", cat: "impact", tags: ["impact", "chord", "reverb", "epik"], dur: 3.24, lufs: -19.9, tp: -0.0, hit: 0.89, peak: 0.87, use: "Reveal logo / momen penting" },
  { id: "impact-cut-sweep", file: "impact-cut-sweep.mp3", cat: "impact", tags: ["impact", "sweep", "tegas"], dur: 2.83, lufs: -18.3, tp: -1.4, hit: 0.94, peak: 1.07, use: "Judul besar muncul, angka 3D slam" },
  { id: "kertas-balik-halaman", file: "kertas-balik-halaman.mp3", cat: "foley", tags: ["kertas", "halaman", "laporan"], dur: 0.58, lufs: -38.3, tp: -19.8, hit: 0.21, peak: 0.2, use: "Laporan/PPT/carousel geser" },
  { id: "koin-flip", file: "koin-flip.mp3", cat: "koin", tags: ["koin", "flip"], dur: 0.98, lufs: -23.7, tp: -3.6, hit: 0.06, peak: 0.06, use: "Detail kecil soal uang/crypto" },
  { id: "koin-ting", file: "koin-ting.mp3", cat: "koin", tags: ["koin", "uang", "ting"], dur: 1.15, lufs: -24.1, tp: -6.4, hit: 0.12, peak: 0.13, use: "Payout/saldo/angka uang muncul" },
  { id: "notif-chat", file: "notif-chat.mp3", cat: "ui", tags: ["notifikasi", "chat", "pesan"], dur: 0.6, lufs: -21.1, tp: -3.9, hit: 0.16, peak: 0.05, use: "Pesan chat tim masuk" },
  { id: "riser-blastoff", file: "riser-blastoff.mp3", cat: "riser", tags: ["riser", "naik", "tegang", "launch"], dur: 8.78, lufs: -19.8, tp: -6.6, hit: 7.14, peak: 7.14, use: "Membangun ketegangan sebelum reveal/drop (taruh berakhir tepat di reveal)" },
  { id: "sukses-happy", file: "sukses-happy.mp3", cat: "ui", tags: ["sukses", "ceria", "game"], dur: 0.91, lufs: -17.0, tp: -4.5, hit: 0.14, peak: 0.02, use: "Selesai/berhasil, Train AI selesai" },
  { id: "swoosh-readout", file: "swoosh-readout.mp3", cat: "whoosh", tags: ["ui", "readout", "data"], dur: 2.33, lufs: -21.8, tp: -2.2, hit: 0.96, peak: 1.08, use: "Panel/angka/dashboard muncul" },
  { id: "trailer-pulse-lambat", file: "trailer-pulse-lambat.mp3", cat: "trailer-pulse", tags: ["pulse", "trailer", "ritmis", "musik"], dur: 30.02, lufs: -9.2, tp: -0.4, hit: 0, peak: 12.24, use: "Lapisan ritme trailer (bisa jadi musik cadangan)" },
  { id: "trailer-pulse-panjang", file: "trailer-pulse-panjang.mp3", cat: "trailer-pulse", tags: ["pulse", "trailer", "sustain", "musik"], dur: 30.02, lufs: -12.0, tp: -0.9, hit: 0, peak: 0.02, use: "Lapisan sustain trailer (musik cadangan)" },
  { id: "trailer-pulse-sedang", file: "trailer-pulse-sedang.mp3", cat: "trailer-pulse", tags: ["pulse", "trailer", "ritmis", "musik"], dur: 30.02, lufs: -11.0, tp: -1.1, hit: 0, peak: 5.12, use: "Lapisan ritme trailer energik (musik cadangan)" },
  { id: "transisi-shaker-snap", file: "transisi-shaker-snap.mp3", cat: "transisi", tags: ["snap", "cepat", "perkusi"], dur: 1.49, lufs: -18.8, tp: -2.5, hit: 0.49, peak: 0.51, use: "Potongan cepat di montage, ikut ketukan" },
  { id: "transisi-snap-spin", file: "transisi-snap-spin.mp3", cat: "transisi", tags: ["snap", "spin", "energik"], dur: 3.24, lufs: -17.2, tp: -0.4, hit: 1.27, peak: 1.34, use: "Pergantian adegan energik, montage" },
  { id: "ui-accept-boing", file: "ui-accept-boing.mp3", cat: "ui", tags: ["ui", "accept", "lucu"], dur: 1.01, lufs: -16.6, tp: -3.8, hit: 0.06, peak: 0.3, use: "Momen fun / reaksi emoji" },
  { id: "ui-accept-glassy", file: "ui-accept-glassy.mp3", cat: "ui", tags: ["ui", "accept", "kaca"], dur: 0.48, lufs: -22.9, tp: -9.7, hit: 0.06, peak: 0.03, use: "AskCard dipilih / konfirmasi" },
  { id: "ui-arp-twinkle", file: "ui-arp-twinkle.mp3", cat: "ui", tags: ["ui", "twinkle", "magis"], dur: 1.85, lufs: -13.8, tp: -2.5, hit: 0.09, peak: 0.24, use: "Hero MBTI muncul, label \"dibantu oleh\"" },
  { id: "ui-plucks-happy", file: "ui-plucks-happy.mp3", cat: "ui", tags: ["ui", "ceria", "pluck"], dur: 0.89, lufs: -13.8, tp: -3.7, hit: 0.33, peak: 0.13, use: "Hasil AI keluar / sukses kecil" },
  { id: "ui-pop", file: "ui-pop.mp3", cat: "ui", tags: ["ui", "pop", "klik"], dur: 0.67, lufs: -15.9, tp: -1.2, hit: 0.06, peak: 0.03, use: "Tombol diklik, chip/badge muncul" },
  { id: "ui-readout-panjang", file: "ui-readout-panjang.mp3", cat: "ui", tags: ["ui", "readout", "proses", "berpikir"], dur: 4.42, lufs: -16.1, tp: -3.2, hit: 0.06, peak: 1.22, use: "Langkah berpikir AI / loading" },
  { id: "ui-scifi-ping", file: "ui-scifi-ping.mp3", cat: "ui", tags: ["ui", "ping", "scifi"], dur: 0.79, lufs: -13.6, tp: -3.6, hit: 0.13, peak: 0.14, use: "Notifikasi sistem, hot issue naik" },
  { id: "ui-snap", file: "ui-snap.mp3", cat: "ui", tags: ["ui", "snap", "perkusi"], dur: 0.7, lufs: -28.4, tp: -5.3, hit: 0.2, peak: 0.2, use: "Elemen kecil masuk, centang" },
  { id: "whoosh-angin", file: "whoosh-angin.mp3", cat: "whoosh", tags: ["transisi", "angin", "udara"], dur: 1.08, lufs: -28.0, tp: -15.3, hit: 0.06, peak: 0.12, use: "Transisi halus, teks masuk/keluar" },
  { id: "whoosh-cepat", file: "whoosh-cepat.mp3", cat: "whoosh", tags: ["transisi", "cepat", "ringan", "infografis"], dur: 0.53, lufs: -17.6, tp: -0.3, hit: 0.07, peak: 0.08, use: "Transisi antar adegan cepat, geser kartu/slide" },
  { id: "whoosh-confetti", file: "whoosh-confetti.mp3", cat: "whoosh", tags: ["sukses", "perayaan", "ceria"], dur: 2.57, lufs: -21.9, tp: -1.8, hit: 0.07, peak: 0.29, use: "Momen berhasil / perayaan / hasil keluar" },
  { id: "whoosh-debris", file: "whoosh-debris.mp3", cat: "whoosh", tags: ["transisi", "debris", "sinematik"], dur: 2.4, lufs: -21.2, tp: -1.6, hit: 1.24, peak: 0.44, use: "Transisi besar sebelum reveal" },
  { id: "whoosh-metal", file: "whoosh-metal.mp3", cat: "whoosh", tags: ["transisi", "metal", "berat"], dur: 1.25, lufs: -20.9, tp: -1.0, hit: 0.07, peak: 0.52, use: "Transisi ke adegan serius / mockup HP masuk" },
];

export const sfxById = (id: string, extra: SfxMeta[] = []) => SFX_BUILTIN.find((s) => s.id === id) ?? extra.find((s) => s.id === id);
