/**
 * Aturan upload materi referensi (dipakai browser MateriPanel + server action materi/actions.ts — harus sama).
 * Tipe = daftar MIME bucket "asisten-review" (migration-23 §14) tanpa text/html & application/json. Maks 50 MB/file.
 */
import type { CampaignMateriStatus, MateriKind, MateriStatus } from "@/lib/asistenReview";

const AUDIO = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/mp4", "audio/aac", "audio/x-m4a", "audio/flac", "audio/webm"];
const GAMBAR = ["image/jpeg", "image/png", "image/webp"];
const VIDEO = ["video/mp4", "video/webm", "video/quicktime"];

export const MIME_PER_JENIS: Record<MateriKind, string[]> = {
  lagu: [...AUDIO, ...VIDEO], // lagu kadang dikirim brand sebagai mp4 → laptop mengambil audionya
  poster: GAMBAR,
  trailer: VIDEO,
  lainnya: [...AUDIO, ...GAMBAR, ...VIDEO],
};

export const MAKS_MB = 50;

export const JENIS_MATERI: { id: MateriKind; label: string; ikon: string; ket: string }[] = [
  { id: "lagu", label: "Lagu", ikon: "🎵", ket: "mp3 / wav / m4a / ogg / flac" },
  { id: "poster", label: "Poster", ikon: "🖼️", ket: "jpg / png / webp" },
  { id: "trailer", label: "Potongan trailer", ikon: "🎬", ket: "mp4 / webm / mov" },
  { id: "lainnya", label: "Lainnya", ikon: "📎", ket: "audio / gambar / video" },
];
export const JENIS_LABEL = Object.fromEntries(JENIS_MATERI.map((j) => [j.id, j])) as Record<MateriKind, (typeof JENIS_MATERI)[number]>;

export const ACCEPT = [...new Set([...AUDIO, ...GAMBAR, ...VIDEO])].join(",") + ",.mp3,.wav,.m4a,.ogg,.flac,.aac,.mp4,.mov,.webm,.jpg,.jpeg,.png,.webp";

const EXT_MIME: Record<string, string> = {
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/x-m4a", aac: "audio/aac", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac", weba: "audio/webm",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

/** tipe file: dari browser kalau dikenal, selain itu dari ekstensi (Windows kadang memberi "" untuk .m4a / .flac) */
export function mimeFile(name: string, type: string): string {
  const t = (type || "").toLowerCase();
  if (t && Object.values(MIME_PER_JENIS).some((l) => l.includes(t))) return t;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return EXT_MIME[ext] ?? t;
}

/** tebak jenis dari tipe file */
export function tebakJenis(mime: string): MateriKind {
  if (mime.startsWith("audio/")) return "lagu";
  if (mime.startsWith("image/")) return "poster";
  if (mime.startsWith("video/")) return "trailer";
  return "lainnya";
}

/** cek sebelum upload (sama dengan server) → pesan awam, null = boleh */
export function cekFile(f: { name: string; size: number; type: string }, kind: MateriKind): string | null {
  const mime = mimeFile(f.name, f.type);
  if (!f.size) return "File kosong.";
  if (f.size > MAKS_MB * 1024 * 1024) return `File terlalu besar (maks ${MAKS_MB} MB). Potong dulu, mis. 30–60 detik bagian lagunya.`;
  if (!MIME_PER_JENIS[kind].includes(mime)) return `Tipe file tidak cocok untuk "${JENIS_LABEL[kind].label}" (${JENIS_LABEL[kind].ket}).`;
  return null;
}

/** ekstensi dari tipe file (file tanpa / dengan ekstensi asing) — storage hanya menerima ekstensi di EXT_MIME (migration-23 §14) */
const MIME_EXT: Record<string, string> = Object.fromEntries(
  [...Object.entries(EXT_MIME).reverse(), ["audio/mp3", "mp3"], ["audio/x-wav", "wav"], ["audio/wave", "wav"], ["audio/mp4", "m4a"]].map(([a, b]) =>
    a.includes("/") ? [a, b] : [b, a]
  )
);

/** nama file aman untuk storage: <waktu>-<slug>.<ext> (huruf kecil, tanpa spasi / @ / garis miring) */
export function namaStorage(name: string, now = Date.now(), mime = ""): string {
  const dot = name.lastIndexOf(".");
  let ext = (dot > 0 ? name.slice(dot + 1) : "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);
  if (!(ext in EXT_MIME)) ext = MIME_EXT[mime.toLowerCase()] ?? ext;
  const dasar = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "materi";
  return `${now.toString(36)}-${dasar}${ext ? `.${ext}` : ""}`;
}

export const ukuran = (b: number | null | undefined) =>
  b == null ? "" : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString("id-ID", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

export const STATUS_CAMPAIGN: Record<CampaignMateriStatus, { label: string; cls: string }> = {
  belum_dicek: { label: "Belum dicek", cls: "bg-zinc-800 text-zinc-300 ring-zinc-700" },
  proses: { label: "Sedang diunduh", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  ada: { label: "Materi lengkap", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  sebagian: { label: "Sebagian ada", cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30" },
  belum_ada: { label: "Materi belum ada", cls: "bg-red-500/10 text-red-300 ring-red-500/30" },
  gagal: { label: "Gagal dicek", cls: "bg-red-500/10 text-red-300 ring-red-500/30" },
};

export const STATUS_MATERI: Record<MateriStatus, { label: string; cls: string }> = {
  antri_sidik: { label: "Menunggu laptop", cls: "bg-zinc-800 text-zinc-300 ring-zinc-700" },
  proses: { label: "Diproses", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30" },
  siap: { label: "Siap dipakai", cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30" },
  gagal: { label: "Gagal", cls: "bg-red-500/10 text-red-300 ring-red-500/30" },
};
