/**
 * Berita ASLI untuk cover TWS di adegan 7 teaser (dicek silang beberapa media, per 25 Okt 2026).
 * Judul ditulis sebagai ringkasan berita, BUKAN kutipan langsung. Angka persis seperti dilaporkan.
 * Sumber juga dicantumkan di docs/teaser-cs-tracker.md dan deskripsi PR teaser.
 */
import type { TwsDeck } from "@/lib/tws";

export type NewsSource = { outlet: string; title: string; url: string; date: string };

export const TEASER_NEWS_SOURCES: { msci: NewsSource[]; prabowo: NewsSource[] } = {
  msci: [
    {
      outlet: "Databoks (Katadata)",
      title: 'Terancam Jadi "Standalone Market", IHSG Anjlok 11% (Jumat, 16 Oktober 2026)',
      url: "https://databoks.katadata.co.id/pasar/statistik/6ad1f159e1b8f/terancam-jadi-standalone-market-ihsg-anjlok-11-jumat-16-oktober-2026",
      date: "2026-10-16",
    },
    {
      outlet: "Kontan",
      title: "IHSG Anjlok 11%, Penurunan Harian Terdalam Sejak 1998 Usai Pengumuman MSCI",
      url: "https://investasi.kontan.co.id/news/ihsg-anjlok-11-penurunan-harian-terdalam-sejak-1998-usai-pengumuman-msci",
      date: "2026-10-16",
    },
    {
      outlet: "Kontan",
      title: "MSCI Ancam Turunkan Status Pasar Saham Indonesia, IHSG Anjlok",
      url: "https://investasi.kontan.co.id/news/msci-ancam-turunkan-status-pasar-saham-indonesia-ihsg-anjlok",
      date: "2026-10-16",
    },
  ],
  prabowo: [
    {
      outlet: "CNBC Indonesia",
      title: "Respons MSCI Potensi Downgrade Bursa RI, Prabowo: Indonesia Tak Takut",
      url: "https://www.cnbcindonesia.com/market/20261021161750-17-778300/respons-msci-potensi-downgrade-bursa-ri-prabowo-indonesia-tak-takut",
      date: "2026-10-21",
    },
    { outlet: "detikNews", title: "Pesan Prabowo ke MSCI, Tegaskan Tidak Takut", url: "https://news.detik.com/berita/d-8718327/pesan-prabowo-ke-msci-tegaskan-tidak-takut", date: "2026-10-21" },
    { outlet: "Tempo", title: "Prabowo: MSCI Mau Menakut-nakuti Kita", url: "https://www.tempo.co/politik/prabowo-msci-pasar-saham-2301428", date: "2026-10-21" },
    {
      outlet: "Bloomberg Technoz",
      title: "Prabowo Tanggapi MSCI: Kita Tidak Takut, Tidak Akan Gentar",
      url: "https://www.bloombergtechnoz.com/detail-news/125329/prabowo-tanggapi-msci-kita-tidak-takut-tidak-akan-gentar",
      date: "2026-10-21",
    },
  ],
};

/**
 * Carousel TWS untuk adegan 7: cover MSCI (angka 3D "slam") → cover Prabowo → ringkasan kronologi.
 * Fakta: MSCI mengusulkan klasifikasi Indonesia turun dari Emerging Market ke Standalone Market (15/10/2026);
 * IHSG ditutup -11,57% ke 5.185,10 (16/10/2026), penurunan harian terdalam sejak 1998; konsultasi sampai 30/4/2027,
 * keputusan final paling lambat 30/6/2027; Presiden Prabowo menanggapi di sidang kabinet paripurna (21/10/2026).
 */
export const TEASER_TWS_DECK: TwsDeck = {
  title: "MSCI & IHSG",
  asOf: "25 Okt 2026",
  slides: [
    {
      type: "cover",
      big: "-11,57%",
      tone: "red",
      kicker: "IHSG · 16 OKT 2026",
      title: ["IHSG AMBRUK,", "TERDALAM", "SEJAK 1998"],
      hl: 3,
      graphic: "chart-down",
    },
    {
      type: "cover",
      kicker: "SIDANG KABINET · 21 OKT 2026",
      title: ["PRABOWO TEGASKAN", "RI TAK GENTAR", "HADAPI MSCI"],
      hl: 2,
      graphic: "bank",
    },
    {
      type: "text",
      text: "MSCI mengusulkan status pasar saham RI turun ke **Standalone Market**. Keputusan final paling lambat **30 Juni 2027**.",
      rows: [
        { label: "15 Okt 2026", value: "MSCI umumkan usulan" },
        { label: "16 Okt 2026", value: "IHSG -11,57% ke 5.185,10" },
        { label: "30 Apr 2027", value: "Batas konsultasi" },
      ],
    },
  ],
  caption: "MSCI usul turunkan status pasar saham RI, IHSG ambruk 11,57%. Presiden Prabowo menanggapi di sidang kabinet.",
  sources: [...TEASER_NEWS_SOURCES.msci.slice(0, 2), ...TEASER_NEWS_SOURCES.prabowo.slice(0, 2)].map((s) => ({ title: `${s.outlet}: ${s.title}`, url: s.url })),
  brand: "tws",
};
