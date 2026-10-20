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
  menunggu: { label: "Menunggu", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  diproses: { label: "Diproses", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  disetujui: { label: "Disetujui", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  ditolak: { label: "Ditolak", cls: "bg-red-500/15 text-red-300 ring-red-500/30" },
  selesai: { label: "Selesai / Info", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
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
