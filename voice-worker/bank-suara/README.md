# Bank Suara

Rekaman referensi untuk voice cloning (Chatterbox). Pemilik suara: **Alif** - sudah setuju dipakai khusus untuk CS Tracker.
Jangan dipakai untuk meniru orang lain, jangan dibagikan di luar repo privat ini.

| File | Nama di bank suara | Gaya | Durasi | Pakai untuk |
|---|---|---|---|---|
| `referensi-alif-energik-10dtk.wav` | Alif - Energik | energik, semangat | 10.3 dtk | **Referensi utama cloning** (teaser, TikTok, promo) |
| `referensi-alif-tenang-10dtk.wav` | Alif - Tenang | tenang, jelas | 9.1 dtk | **Referensi utama cloning** (tutorial, explainer) |
| `suara-alif-energik.wav` | (cadangan) | energik | 36.2 dtk | Referensi panjang / pilih potongan lain |
| `suara-alif-tenang.wav` | (cadangan) | tenang | 28.0 dtk | Referensi panjang / pilih potongan lain |

Format: WAV mono 44.1 kHz 16-bit, sudah dipotong, diberi jeda 0.3 dtk di awal/akhir, dibersihkan ringan
(high-pass 80 Hz + pengurang bising ringan), volume disamakan -20 LUFS, true peak ±-2 dBTP.

Kualitas: jelas, tidak pecah. Ada **dengung rendah ringan** di latar (rasio suara:bising ±18 dB).
Disarankan worker menjalankan pembersih (DeepFilterNet, peredaman maks 15-20 dB) sebelum dipakai,
atau rekam ulang di ruangan lebih sepi nanti.

## Transkrip (untuk mesin suara yang butuh teks referensi)
- **referensi-alif-energik-10dtk:** "Halo semuanya! Kamu pernah gak, ngerasa kerjaan numpuk, tapi waktunya cuma sedikit? Tenang… sekarang ada cara yang jauh lebih gampang."
- **referensi-alif-tenang-10dtk:** "Selamat datang. Di video singkat ini, kita akan bahas cara kerja fitur Video Review, langkah demi langkah. Pertama,"
- **suara-alif-energik:** "Halo semuanya! Kamu pernah gak, ngerasa kerjaan numpuk, tapi waktunya cuma sedikit? Tenang… sekarang ada cara yang jauh lebih gampang. Cukup ketik apa yang kamu mau, terus biarin sistemnya bekerja. Mulai dari bikin laporan, ngecek video, sampai pantau harga saham dan kripto, semuanya beres dalam hitungan detik! Hari ini, harga emas naik dua koma lima persen, sementara rupiah bertahan di enam belas ribu delapan ratus. Penasaran? Yuk, coba sekarang juga, dan rasakan bedanya!"
- **suara-alif-tenang:** "Selamat datang. Di video singkat ini, kita akan bahas cara kerja fitur Video Review, langkah demi langkah. Pertama, buka menu di sebelah kiri. Kedua, pilih video yang ingin diperiksa. Setelah itu, sistem akan menampilkan status, catatan, dan riwayat perubahannya secara otomatis. Sederhana, cepat, dan rapi. Kalau ada pertanyaan, tim kami siap membantu kapan saja."
