/**
 * Daftar tab yang bisa dibuka/ditutup admin per user (Admin → Akses tab per user).
 * Disimpan sebagai daftar TUTUP (tabel user_tab_blocks): tidak ada baris = semua tab boleh,
 * jadi tab baru otomatis terbuka. Admin selalu boleh semua tab.
 * Studio TIDAK di sini (diatur bagian "Akses Studio", maks 3). /admin hanya admin, /akun selalu boleh.
 *
 * Kalau menambah tab: tambahkan di TABS + daftar id di check constraint migration-22 (user_tab_blocks_known).
 */

/** urutan = urutan menu (tab pertama yang boleh jadi tujuan pengalihan) */
export const TAB_IDS = ["dashboard", "video_review", "catatan", "chat", "ai", "musik"] as const;
export type TabId = (typeof TAB_IDS)[number];

export type TabDef = {
  id: TabId;
  label: string;
  icon: string;
  /** halaman tujuan di menu (null = bukan halaman, mis. tombol Musik) */
  home: string | null;
  /** awalan path halaman / API milik tab ini ("/" khusus dashboard, dicek terpisah) */
  paths: readonly string[];
  /** keterangan singkat di Admin */
  hint: string;
};

export const TABS: readonly TabDef[] = [
  { id: "dashboard", label: "Dashboard & Hot Issue", icon: "🏠", home: "/", paths: ["/issues", "/contacts"], hint: "Beranda, Hot Issue, laporan, cek kontak" },
  { id: "video_review", label: "Video Review", icon: "🎬", home: "/video-review", paths: ["/video-review"], hint: "Rekap & kasus video review" },
  { id: "catatan", label: "Catatan & Saran", icon: "📝", home: "/catatan", paths: ["/catatan"], hint: "Catatan & saran tim" },
  { id: "chat", label: "Chat", icon: "💬", home: "/chat", paths: ["/chat"], hint: "Halaman chat, chat melayang & bunyinya" },
  { id: "ai", label: "AI", icon: "✨", home: "/ai", paths: ["/ai", "/api/ai"], hint: "Tab ✨ AI" },
  { id: "musik", label: "Musik AI", icon: "🎵", home: null, paths: ["/api/music"], hint: "Tombol 🎵 Musik di menu" },
];

export function isTabId(v: unknown): v is TabId {
  return typeof v === "string" && (TAB_IDS as readonly string[]).includes(v);
}

export function tabDef(id: TabId): TabDef {
  return TABS.find((t) => t.id === id)!;
}

/** Isi dari database / form -> id tab yang dikenal saja, tanpa dobel, urut seperti menu */
export function normalizeTabs(v: unknown): TabId[] {
  const list = Array.isArray(v) ? v : [];
  return TAB_IDS.filter((id) => list.includes(id));
}

/** Tab pemilik lampiran / reaksi / komentar menurut jenis targetnya (lib/attachments.ts, lib/reactions.ts) */
export const TARGET_TAB = {
  issue: "dashboard",
  issue_note: "dashboard",
  issue_report: "dashboard",
  suggestion: "catatan",
  suggestion_comment: "catatan",
  chat_message: "chat",
} as const satisfies Record<string, TabId>;

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** Path halaman / API -> tab pemiliknya (null = tidak diatur per tab, mis. /akun, /admin, /remotion) */
export function tabForPath(raw: string): TabId | null {
  const path = (raw || "/").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "dashboard";
  for (const t of TABS) if (t.paths.some((p) => under(path, p))) return t.id;
  return null;
}

/** Halaman tab pertama yang masih boleh (urutan menu); null = semua tab halaman ditutup */
export function firstOpenHome(blocked: Iterable<TabId>): string | null {
  const b = new Set(blocked);
  for (const t of TABS) if (t.home && !b.has(t.id)) return t.home;
  return null;
}

/** Tujuan kalau tab `tab` ditutup: tab pertama yang boleh (+ ?tutup=tab supaya muncul pesan), atau /akun */
export function closedRedirect(blocked: Iterable<TabId>, tab: TabId | null): string {
  const home = firstOpenHome(blocked);
  if (!home) return "/akun?tutup=semua";
  return tab ? `${home}?tutup=${tab}` : home;
}

export function tabClosedText(tab: TabId): string {
  return `Tab ${tabDef(tab).label} ditutup admin untuk akunmu.`;
}

/** Error Supabase seputar akses tab -> kalimat awam (pola studioErrorText) */
export function tabErrorText(e: { code?: string; message?: string } | null | undefined, fallback = "Gagal menyimpan. Coba lagi sebentar."): string {
  const code = e?.code ?? "";
  const msg = e?.message ?? "";
  if (/semua tab/i.test(msg)) return "Admin selalu bisa membuka semua tab.";
  if (code === "42P01" || code === "PGRST205" || /schema cache|does not exist/i.test(msg))
    return "Jalankan supabase/migration-22-akses-tab.sql dulu di Supabase (SQL Editor), lalu muat ulang halaman.";
  if (code === "42501" || /row-level security|permission denied/i.test(msg)) return "Hanya admin yang boleh mengatur akses tab.";
  if (code === "23514") return "Ada tab yang tidak dikenal. Muat ulang halaman lalu coba lagi.";
  if (code === "23503") return "User tidak ditemukan. Muat ulang halaman.";
  return fallback;
}
