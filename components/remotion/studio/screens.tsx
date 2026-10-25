"use client";

/**
 * Layar website CS Tracker versi mini untuk mockup HP / laptop di video Studio — dibuat ulang dari komponen asli (bukan screenshot).
 * `AppScreen` mengisi 100% layar perangkat (ukuran dibaca dari <Phone> / <Laptop> / <ScreenBox>), semua gerak dari useCurrentFrame
 * relatif ke awal Sequence (+ `start`). Warna selalu mode gelap (tidak ikut tema website). Data pribadi clipper selalu diburamkan.
 *
 * Arti `title` & `items` per jenis layar (kosong = contoh bawaan):
 * - dashboard   : title = judul halaman; items berangka ("Hot aktif 12") = kartu angka, items lain = judul Top 3 issue
 * - hotIssue    : title = judul; items[0] = issue yang naik ke #1, items[1..4] = issue lain
 * - videoReview : title = judul; items = judul kartu video (status Menunggu/Banding/Rilis berganti sendiri)
 * - chat        : items = isi pesan berurutan (pesan ke-4 = pesan "kamu" yang diketik dulu)
 * - ai          : title = pertanyaan; items = [jawaban (**tebal**), pilihan kartu tanya 1–3]
 * - design      : title = judul cover (dipecah otomatis, baris terakhir disorot biru); items = [angka besar, kalimat isi (**kata** = biru), pengantar]
 * - trainAi     : title = tipe hasil 4 huruf (mis. "INTJ"); items = teks pertanyaan kuis
 * - studio      : title = judul proyek; items = nama/teks adegan
 * - music       : title = judul lagu; items = nama suasana
 * - report      : title = judul laporan; items berangka ("Issue selesai 186") = kartu KPI, items lain = poin kesimpulan
 * - website     : title = judul utama; items = fitur ("Judul: keterangan"); src = gambar pratinjau (opsional)
 * - media       : src = foto / klip; title = keterangan di bawah (opsional)
 */
import { useCurrentFrame, useVideoConfig } from "remotion";
import { BRANDS, type Brand } from "@/lib/studio/timeline";
import { isVideoSrc } from "./backgrounds";
import { useDevice } from "./devices";
import { AiScreen, StudioScreen, TrainAiScreen } from "./screens/ai";
import { DesignScreen, MediaScreen, ReportScreen, WebsiteScreen } from "./screens/content";
import { ChatScreen, MusicScreen } from "./screens/team";
import { ORANGE_GRAD, Z, lumOf, mixHex, mkClock, type Env, type ScreenProps } from "./screens/ui";
import { DashboardScreen, HotIssueScreen, VideoReviewScreen } from "./screens/work";

export type { ScreenProps } from "./screens/ui";

/** ukuran tata letak bawaan: HP 390×844, layar lebar 1280×800 */
const PHONE_VIEW = { w: 390, h: 844 };
const WIDE_VIEW = { w: 1280, h: 800 };

/** warna aksen untuk UI website: CS Tracker = oranye Konten (brand TWS tetap oranye di UI aplikasi; biru TWS dipakai di layar desain) */
function accentOf(b: Brand) {
  const app = b.id === "tws" ? BRANDS.konten : b;
  if (app.id === "konten") return { acc: "#f97316", acc2: "#fb923c", grad: ORANGE_GRAD };
  // aksen terlalu gelap di latar gelap -> dicerahkan supaya tetap terbaca
  const acc = lumOf(app.primary) < 0.3 ? mixHex(app.primary, "#ffffff", 0.3) : app.primary;
  return {
    acc,
    acc2: mixHex(acc, "#ffffff", 0.22),
    grad: `linear-gradient(180deg, ${app.accent || mixHex(acc, "#ffffff", 0.12)} 0%, ${mixHex(acc, "#000000", 0.12)} 100%)`,
  };
}

/** isi layar sesuai jenisnya */
function View({ kind, e }: { kind: ScreenProps["kind"]; e: Env }) {
  switch (kind) {
    case "hotIssue":
      return <HotIssueScreen e={e} />;
    case "videoReview":
      return <VideoReviewScreen e={e} />;
    case "chat":
      return <ChatScreen e={e} />;
    case "ai":
      return <AiScreen e={e} />;
    case "design":
      return <DesignScreen e={e} />;
    case "trainAi":
      return <TrainAiScreen e={e} />;
    case "studio":
      return <StudioScreen e={e} />;
    case "music":
      return <MusicScreen e={e} />;
    case "report":
      return <ReportScreen e={e} />;
    case "website":
      return <WebsiteScreen e={e} />;
    case "media":
      return <MediaScreen e={e} />;
    default:
      return <DashboardScreen e={e} />;
  }
}

/**
 * UI website mini yang beranimasi, mengisi 100% kotak induk (layar HP / laptop).
 * `compact` memaksa tampilan HP (true) / layar lebar (false); kalau tidak cocok dengan ukuran layar,
 * tampilannya dibuat di ukuran aslinya lalu diskalakan pas di tengah.
 */
export function AppScreen(p: ScreenProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const dev = useDevice();
  const start = p.start ?? 0;
  const d = Math.max(1, Math.round(p.dur ?? durationInFrames - start));
  const wide = p.compact !== undefined ? !p.compact : dev.kind === "laptop" || (dev.kind === "none" && dev.w > dev.h);

  // ukuran tata letak: pakai ukuran layar asli kalau cocok, kalau tidak buat di ukuran bawaan lalu diskalakan
  let view = { w: dev.w, h: dev.h, top: dev.top, bottom: dev.bottom };
  let s = 1;
  const mismatch = p.kind !== "media" && (wide ? dev.w < 1000 : dev.w > 560);
  if (mismatch) {
    const v = wide ? WIDE_VIEW : PHONE_VIEW;
    s = Math.min(dev.w / v.w, dev.h / v.h);
    view = { ...v, top: 0, bottom: 0 };
  }

  const brand = p.brand ?? BRANDS.konten;
  const own = p.kind === "website" || p.kind === "media";
  const a = own ? { acc: brand.primary, acc2: mixHex(brand.primary, "#ffffff", 0.22), grad: `linear-gradient(180deg, ${brand.accent} 0%, ${mixHex(brand.primary, "#000000", 0.12)} 100%)` } : accentOf(brand);
  const e: Env = {
    t: mkClock(frame - start, d, fps),
    wide,
    brand,
    ...a,
    items: (p.items ?? [])
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((x) => x.slice(0, 120)),
    title: String(p.title ?? "").trim().slice(0, 90),
    // video hanya untuk layar media; layar lain (website / desain) memakai <Img> → sisa klip dari layar media diabaikan
    src: p.src && (p.kind === "media" || !isVideoSrc(p.src)) ? p.src : null,
    w: view.w,
    h: view.h,
    top: view.top,
    bottom: view.bottom,
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: Z[950] }}>
      {s === 1 ? (
        <View kind={p.kind} e={e} />
      ) : (
        <div style={{ position: "absolute", left: (dev.w - view.w * s) / 2, top: (dev.h - view.h * s) / 2, width: view.w, height: view.h, transform: `scale(${s})`, transformOrigin: "0 0", overflow: "hidden" }}>
          <View kind={p.kind} e={e} />
        </div>
      )}
    </div>
  );
}
