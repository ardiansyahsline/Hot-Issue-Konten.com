// Lampiran bukti (gambar & dokumen) — aturan yang dipakai di browser dan server
export const ATTACH_BUCKET = "lampiran";
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const ATTACH_MAX_FILES = 10; // per kali simpan

/** ekstensi -> tipe file yang diizinkan (sama dengan bucket di migration-07) */
export const ATTACH_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  txt: "text/plain",
};
export const ATTACH_MIMES = new Set(Object.values(ATTACH_TYPES));
export const ATTACH_ACCEPT = Object.keys(ATTACH_TYPES).map((e) => `.${e}`).join(",") + ",image/*";

export const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();

/** tipe file final: pakai bawaan browser kalau dikenal, kalau tidak tebak dari ekstensi */
export function mimeOf(name: string, browserType?: string) {
  if (browserType && ATTACH_MIMES.has(browserType)) return browserType;
  return ATTACH_TYPES[extOf(name)] ?? browserType ?? "";
}

/** gambar yang bisa ditampilkan langsung di browser (HEIC tidak) */
export const isViewableImage = (mime: string | null) => !!mime && /^image\/(jpeg|png|webp|gif)$/.test(mime);

export function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** label + warna ikon dokumen */
export function docBadge(name: string, mime: string | null): [string, string] {
  const e = extOf(name);
  if (mime === "application/pdf" || e === "pdf") return ["PDF", "bg-red-500/15 text-red-400"];
  if (/xls|csv/.test(e) || /sheet|excel|csv/.test(mime ?? "")) return [e === "csv" ? "CSV" : "XLS", "bg-emerald-500/15 text-emerald-400"];
  if (/doc/.test(e) || /word/.test(mime ?? "")) return ["DOC", "bg-sky-500/15 text-sky-400"];
  if (/ppt/.test(e) || /presentation|powerpoint/.test(mime ?? "")) return ["PPT", "bg-orange-500/15 text-orange-400"];
  if (/heic|heif/.test(e)) return ["IMG", "bg-violet-500/15 text-violet-400"];
  return [(e || "FILE").slice(0, 4).toUpperCase(), "bg-zinc-500/15 text-zinc-300"];
}

/** data lampiran yang dikirim form ke server (file sudah ter-upload ke Storage) */
export type AttachmentInput = { path: string; name: string; size: number; mime: string };

/** lampiran yang ditampilkan (sudah ada link sementara untuk dibuka / diunduh) */
export type AttachmentView = {
  id: number;
  name: string;
  size: number;
  mime: string | null;
  url: string | null;
  downloadUrl: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  issue_note_id: number | null;
  suggestion_comment_id: number | null;
};

/** tempat lampiran menempel */
export type AttachTarget =
  | { kind: "issue"; id: number }
  | { kind: "issue_note"; id: number }
  | { kind: "suggestion"; id: number }
  | { kind: "suggestion_comment"; id: number };

export const TARGET_COLUMN = {
  issue: "issue_id",
  issue_note: "issue_note_id",
  suggestion: "suggestion_id",
  suggestion_comment: "suggestion_comment_id",
} as const;
