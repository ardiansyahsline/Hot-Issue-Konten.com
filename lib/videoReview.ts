// Kategori diambil dari rekap sheet "Video Review WA" (kolom Kategori)
export const VR_CATEGORIES = [
  "Saldo dibekukan (cek/menanyakan)",
  "Permintaan review video",
  "Review/rilis melewati estimasi waktu",
  "Pengajuan banding",
  "Kesesuaian video dengan brief",
  "Refresh views top clipper",
  "Misskom info brief",
  "Komplain",
  "Lainnya",
] as const;

export const VR_STATUSES = {
  menunggu: { label: "Menunggu", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30", bar: "bg-sky-400", text: "belum ada respons" },
  diproses: { label: "Diproses", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30", bar: "bg-amber-400", text: "diproses" },
  disetujui: { label: "Disetujui", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", bar: "bg-emerald-500", text: "disetujui" },
  ditolak: { label: "Ditolak", cls: "bg-red-500/15 text-red-300 ring-red-500/30", bar: "bg-red-500", text: "ditolak" },
  selesai: { label: "Selesai / Info", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30", bar: "bg-zinc-500", text: "selesai/info" },
} as const;

export type VrStatus = keyof typeof VR_STATUSES;

export type VrLinkKind = "email" | "url" | "other";

export type VrLinkInput = { kind: VrLinkKind; value: string };

export type VrImportRow = {
  report_date: string | null; // YYYY-MM-DD
  explanation: string;
  resolution: string | null;
  insight: string | null;
  clipper_argument: string | null;
  status: VrStatus;
  category: string;
  links: VrLinkInput[];
  source_row: number; // nomor baris di sheet (1-based)
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pecah isi kolom Email/link jadi daftar email & URL. Kata lain (mis. "emailnya") diabaikan. */
export function extractLinks(cell: string): VrLinkInput[] {
  const out: VrLinkInput[] = [];
  for (const raw of cell.split(/\s+/)) {
    const t = raw.trim().replace(/[,;]+$/, "");
    if (!t || !/[a-z0-9]/i.test(t)) continue;
    if (/^https?:\/\//i.test(t) || /^(www\.)?[a-z0-9-]+\.(com|be|site|id|net|me)\//i.test(t)) out.push({ kind: "url", value: t });
    else if (EMAIL_RE.test(t)) out.push({ kind: "email", value: t.toLowerCase() });
  }
  return out;
}

export function parseLinksText(text: string): VrLinkInput[] {
  const seen = new Set<string>();
  const out: VrLinkInput[] = [];
  for (const line of text.split(/\n/)) {
    const found = extractLinks(line);
    const items: VrLinkInput[] = found.length ? found : line.trim() ? [{ kind: "other", value: line.trim() }] : [];
    for (const l of items) {
      const k = l.value.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        out.push(l);
      }
    }
  }
  return out;
}

export function linkPlatform(value: string): string {
  const v = value.toLowerCase();
  if (v.includes("tiktok.com") || v.includes("tt.site")) return "TikTok";
  if (v.includes("instagram.com")) return "IG";
  if (v.includes("youtu")) return "YT";
  if (v.includes("@") && !v.startsWith("http")) return "Email";
  return "Link";
}

/** Status dibaca dari teks kolom Penyelesaian (teks aslinya tetap disimpan apa adanya). */
export function statusFromResolution(text: string | null): VrStatus {
  const t = (text ?? "").toLowerCase().trim();
  if (!t) return "menunggu";
  if (/ditolak/.test(t)) return "ditolak";
  if (/disetujui|\bacc\b|sudah rilis|sesuai/.test(t)) return "disetujui";
  if (/^belum|menunggu|perlu kirim/.test(t)) return "menunggu";
  if (/sudah diproses|selesai|dijelaskan|pembaruan|refresh/.test(t)) return "selesai";
  if (/diproses|masih/.test(t)) return "diproses";
  return "selesai";
}

/** "02/10/26" atau "02/10/2026" (dd/mm/yy) -> "2026-10-02" */
export function parseSheetDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const meaningful = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t && /[a-z0-9]/i.test(t) && t !== "-" ? t : "";
};

const joinText = (a: string | null, b: string) => (a ? `${a}\n${b}` : b);

/**
 * Ubah isi sheet (hasil parseCsv) jadi daftar kasus.
 * - Kolom dicari dari baris header ("Tanggal Report", "Penjelasan", "Email/link", ...).
 * - Baris tanpa Tanggal & Penjelasan = lanjutan kasus di atasnya (link tambahan digabung).
 * - Kolom rekap di kanan (Kategori / Jumlah Kasus / Rangkuman) diabaikan.
 */
export function sheetToReviews(rows: string[][]): { reviews: VrImportRow[]; error?: string } {
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim().toLowerCase() === "tanggal report"));
  if (headerIdx < 0) return { reviews: [], error: 'Header "Tanggal Report" tidak ditemukan. Pastikan file CSV dari sheet Video Review.' };

  const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (name: string) => header.findIndex((h) => h === name);
  const C = {
    date: col("tanggal report"),
    expl: col("penjelasan"),
    link: col("email/link"),
    res: col("penyelesaian"),
    insight: col("insight"),
    arg: col("argumen clipper"),
  };
  if (C.expl < 0 || C.link < 0) return { reviews: [], error: 'Kolom "Penjelasan" atau "Email/link" tidak ditemukan.' };

  const reviews: VrImportRow[] = [];
  let lastDate: string | null = null;

  rows.slice(headerIdx + 1).forEach((r, i) => {
    const get = (c: number) => (c >= 0 ? r[c] ?? "" : "");
    const dateRaw = get(C.date).trim();
    const expl = get(C.expl).trim();
    const links = extractLinks(get(C.link));
    const res = meaningful(get(C.res));
    const insight = meaningful(get(C.insight));
    const arg = meaningful(get(C.arg));

    if (dateRaw || expl) {
      const date = parseSheetDate(dateRaw) ?? lastDate;
      if (parseSheetDate(dateRaw)) lastDate = parseSheetDate(dateRaw);
      reviews.push({
        report_date: date,
        explanation: expl || "(tanpa penjelasan)",
        resolution: res || null,
        insight: insight || null,
        clipper_argument: arg || null,
        status: "menunggu",
        category: "Lainnya",
        links,
        source_row: headerIdx + 2 + i,
      });
    } else if (reviews.length && (links.length || res || insight || arg)) {
      const prev = reviews[reviews.length - 1];
      prev.links.push(...links);
      if (res) prev.resolution = joinText(prev.resolution, res);
      if (insight) prev.insight = joinText(prev.insight, insight);
      if (arg) prev.clipper_argument = joinText(prev.clipper_argument, arg);
    }
  });

  for (const r of reviews) {
    r.status = statusFromResolution(r.resolution);
    r.category = categorize(r.explanation);
    const seen = new Set<string>();
    r.links = r.links.filter((l) => {
      const k = l.value.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return { reviews };
}

// ---------------------------------------------------------------------------
// AUTO-KATEGORI — dibaca dari teks Penjelasan. Urutan aturan penting (yang pertama cocok dipakai).
// Ubah/tambah kata kunci di sini kalau ada pola baru.
// ---------------------------------------------------------------------------
export const VR_CATEGORY_RULES: { category: (typeof VR_CATEGORIES)[number]; pattern: RegExp }[] = [
  { category: "Saldo dibekukan (cek/menanyakan)", pattern: /saldo|dibekukan|freeze|frozen/i },
  { category: "Refresh views top clipper", pattern: /refresh/i },
  { category: "Misskom info brief", pattern: /mis+kom/i },
  { category: "Komplain", pattern: /komplain|complain|berbeda platform|beda platform/i },
  {
    category: "Review/rilis melewati estimasi waktu",
    pattern: /melewati\s+(batas|estimasi)|lewat\s+(batas|estimasi)|tertunda|pending|belum\s+(di)?rilis|estimasi waktu/i,
  },
  { category: "Pengajuan banding", pattern: /banding|appeal/i },
  {
    category: "Kesesuaian video dengan brief",
    pattern: /kesesuaian|sesuai brief|ketentuan brief|alasan (penolakan|reject|ditolak)|alasan.*tolak|\bcta\b|reject|ditolak|perubahan brief/i,
  },
  { category: "Permintaan review video", pattern: /review|tinjau/i },
];

export function categorize(explanation: string): (typeof VR_CATEGORIES)[number] {
  for (const r of VR_CATEGORY_RULES) if (r.pattern.test(explanation)) return r.category;
  return "Lainnya";
}

// Link default sheet "Video Review WA"
export const DEFAULT_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1BeiuI4KH05E4MpmMom29tItugIaf5h6YoL_ofAoyBDg/edit?gid=0#gid=0";

/** Ubah link Google Sheet biasa jadi link download CSV */
export function sheetCsvUrl(url: string): string | null {
  const id = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!id) return null;
  const gid = url.match(/[#?&]gid=(\d+)/)?.[1] ?? "0";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
}

// ---------------------------------------------------------------------------
// RANGKUMAN OTOMATIS per kategori — disusun dari data, tidak mengarang.
// ---------------------------------------------------------------------------
export type VrSummaryRow = { category: string | null; status: VrStatus; resolution: string | null; report_date: string };

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (d: string) => {
  const [, m, day] = d.split("-").map(Number);
  return `${day} ${BULAN[m - 1]}`;
};

export function buildRangkuman(rows: VrSummaryRow[]): string {
  if (!rows.length) return "";
  const n = (st: VrStatus) => rows.filter((r) => r.status === st).length;
  const dates = rows.map((r) => r.report_date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const total = rows.length;

  // nama dalam kurung di kolom Penyelesaian, mis. "Disetujui (Irsyad)"
  const names = new Map<string, number>();
  for (const r of rows) {
    for (const m of (r.resolution ?? "").matchAll(/\(([A-Z][a-zA-Z]+)\)/g)) names.set(m[1], (names.get(m[1]) ?? 0) + 1);
  }
  const top = [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
  const who = top.length > 1 ? top.slice(0, -1).join(", ") + " & " + top[top.length - 1] : (top[0] ?? "");

  const parts: string[] = [];
  parts.push(first === last ? `${total} kasus pada ${tgl(first)}.` : `${total} kasus dari ${tgl(first)} sampai ${tgl(last)}.`);

  const counts: [VrStatus, number, string][] = [
    ["disetujui", n("disetujui"), "disetujui"],
    ["ditolak", n("ditolak"), "ditolak"],
    ["diproses", n("diproses"), "masih diproses"],
    ["menunggu", n("menunggu"), "belum ada respons"],
    ["selesai", n("selesai"), "selesai/info"],
  ];
  const nonZero = counts.filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);
  if (nonZero.length) {
    const [mainKey, mainCount, mainText] = nonZero[0];
    const decided = ["disetujui", "ditolak", "selesai"].includes(mainKey);
    const by = decided && who ? `, ditangani ${who}` : "";
    if (mainCount === total) parts.push(`Semuanya ${mainText}${by}.`);
    else if (mainCount > total / 2) parts.push(`Mayoritas ${mainText} (${mainCount} kasus)${by}.`);
    else parts.push(`Paling banyak ${mainText} (${mainCount} kasus)${by}.`);
    const rest = nonZero.slice(1).map(([, c, t]) => `${c} ${t}`);
    if (rest.length) parts.push(`Sisanya ${rest.join(", ")}.`);
    if (!decided && who) parts.push(`Ditangani ${who}.`);
  }

  const latest = rows.filter((r) => r.report_date === last);
  const latestWaiting = latest.filter((r) => r.status === "menunggu").length;
  if (first !== last) {
    parts.push(
      `Terbaru ${tgl(last)}: ${latest.length} kasus${latestWaiting ? `, ${latestWaiting} masih menunggu respons` : ""}.`
    );
  }
  return parts.join(" ");
}

/** "2026-10-05" -> "05/10/26" (format seperti di sheet) */
export function ddmmyy(d: string | null | undefined) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y.slice(2)}`;
}

/** Kunci stabil baris sheet: tanggal + penjelasan + link pertama (+ urutan kalau kembar). Harus sama dengan migration-03. */
export function sheetBaseKey(r: Pick<VrImportRow, "report_date" | "explanation" | "links">) {
  const firstLink = r.links[0]?.value.trim().toLowerCase() ?? "";
  return `${r.report_date ?? ""}|${r.explanation.trim().toLowerCase()}|${firstLink}`;
}
