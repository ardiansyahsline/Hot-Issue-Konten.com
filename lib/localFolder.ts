/**
 * Akses folder di laptop user lewat File System Access API (Chrome / Edge desktop).
 * Semua kerja (baca, pindah, ganti nama, hapus) terjadi di browser user — server tidak pernah menyentuh file.
 */

/* ---------- tipe minimal (belum lengkap di lib.dom TypeScript) ---------- */
type Perm = "granted" | "denied" | "prompt";
export type DirHandle = {
  kind: "directory";
  name: string;
  entries(): AsyncIterableIterator<[string, DirHandle | FileHandle]>;
  getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<DirHandle>;
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandle>;
  removeEntry(name: string, o?: { recursive?: boolean }): Promise<void>;
  /** true = file dipilih lewat "pilih file" (HP / browser tanpa akses folder): hanya bisa dibaca */
  readonly?: boolean;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<Perm>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<Perm>;
};
export type FileHandle = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: Blob | BufferSource | string): Promise<void>; close(): Promise<void> }>;
  move?: (dir: DirHandle, name: string) => Promise<void>;
};

/**
 * HP / Safari / Firefox: tidak bisa membuka folder, tapi bisa memilih file (atau folder baca-saja lewat webkitdirectory).
 * File dibungkus jadi "folder" baca-saja supaya AI tetap bisa membaca & membuat laporan.
 */
export function scanFromFiles(list: File[], name = "File dipilih"): Scan {
  const ro = async () => {
    throw new Error("Di perangkat ini file hanya bisa dibaca — pindah/ganti nama/hapus pakai Chrome/Edge di laptop.");
  };
  const root = { kind: "directory", name, readonly: true, entries: async function* () {}, getDirectoryHandle: ro, getFileHandle: ro, removeEntry: ro } as unknown as DirHandle;
  const files: FileEntry[] = list.slice(0, 4000).map((f) => {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/");
    const path = rel.length > 1 ? rel.slice(1).join("/") : rel[0];
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const handle = { kind: "file", name: f.name, getFile: async () => f, createWritable: ro } as unknown as FileHandle;
    return { path, name: f.name, dir, ext: extOf(f.name), size: f.size, modified: f.lastModified, handle, parent: root };
  });
  const dirs = [...new Set(files.map((f) => f.dir).filter(Boolean))];
  return { root, files, dirs, truncated: list.length > 4000, at: Date.now() };
}

export const folderSupported = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

export async function pickFolder(): Promise<DirHandle | null> {
  try {
    const w = window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> };
    return await w.showDirectoryPicker({ id: "cs-ai-folder", mode: "readwrite" });
  } catch {
    return null; // dibatalkan
  }
}

/** pastikan izin edit masih ada (Chrome bisa minta ulang) */
export async function ensureWrite(root: DirHandle) {
  if (!root.queryPermission) return true;
  if ((await root.queryPermission({ mode: "readwrite" })) === "granted") return true;
  return (await root.requestPermission?.({ mode: "readwrite" })) === "granted";
}

/* ---------- pindai isi folder ---------- */
export type FileEntry = { path: string; name: string; dir: string; ext: string; size: number; modified: number; handle: FileHandle; parent: DirHandle };
export type Scan = { root: DirHandle; files: FileEntry[]; dirs: string[]; truncated: boolean; at: number; dups?: string[][] };

const SKIP = /^(\.|~\$|desktop\.ini$|thumbs\.db$|node_modules$|\$recycle\.bin$)/i;
export const extOf = (n: string) => (n.includes(".") ? n.split(".").pop()!.toLowerCase() : "");

export async function scanFolder(root: DirHandle, maxFiles = 4000, maxDepth = 6): Promise<Scan> {
  const files: FileEntry[] = [];
  const dirs: string[] = [];
  let truncated = false;
  const walk = async (dir: DirHandle, prefix: string, depth: number) => {
    for await (const [name, h] of dir.entries()) {
      if (files.length >= maxFiles) {
        truncated = true;
        return;
      }
      if (SKIP.test(name)) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (h.kind === "directory") {
        dirs.push(path);
        if (depth < maxDepth) await walk(h, path, depth + 1);
        else truncated = true;
      } else {
        try {
          const f = await h.getFile();
          files.push({ path, name, dir: prefix, ext: extOf(name), size: f.size, modified: f.lastModified, handle: h, parent: dir });
        } catch {}
      }
    }
  };
  await walk(root, "", 0);
  return { root, files, dirs, truncated, at: Date.now() };
}

/** file kembar: ukuran sama + isi sama (SHA-256). Yang pertama (paling lama) dianggap asli. */
export async function findDuplicates(scan: Scan, maxBytes = 600 * 1024 * 1024): Promise<string[][]> {
  const bySize = new Map<number, FileEntry[]>();
  for (const f of scan.files) if (f.size > 0) bySize.set(f.size, [...(bySize.get(f.size) ?? []), f]);
  const groups: string[][] = [];
  let used = 0;
  for (const list of bySize.values()) {
    if (list.length < 2) continue;
    if (used + list[0].size * list.length > maxBytes) continue;
    used += list[0].size * list.length;
    const byHash = new Map<string, FileEntry[]>();
    for (const f of list) {
      try {
        const buf = await (await f.handle.getFile()).arrayBuffer();
        const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
        byHash.set(h, [...(byHash.get(h) ?? []), f]);
      } catch {}
    }
    for (const g of byHash.values()) if (g.length > 1) groups.push(g.sort((a, b) => a.modified - b.modified || a.path.length - b.path.length).map((f) => f.path));
  }
  return groups;
}

/* ---------- ringkasan untuk AI ---------- */
const kb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : n >= 1e3 ? `${Math.round(n / 1e3)}KB` : `${n}B`);
const day = (t: number) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });

export function listingText(scan: Scan, full = 700): string {
  const f = scan.files;
  const lines: string[] = [];
  lines.push(`Folder "${scan.root.name}": ${f.length} file, ${scan.dirs.length} subfolder${scan.truncated ? " (DAFTAR TERPOTONG — folder sangat besar)" : ""}.`);
  const byExt = new Map<string, number>();
  for (const x of f) byExt.set(x.ext || "(tanpa ekstensi)", (byExt.get(x.ext || "(tanpa ekstensi)") ?? 0) + 1);
  lines.push(`Jenis: ${[...byExt.entries()].sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(", ")}`);
  if (scan.dirs.length) lines.push(`Subfolder: ${scan.dirs.slice(0, 120).join(" | ")}${scan.dirs.length > 120 ? " | …" : ""}`);
  if (scan.dups?.length) {
    const extra = scan.dups.reduce((s, g) => s + g.length - 1, 0);
    lines.push(`DUPLIKAT (isi persis sama; yang pertama = asli): ${scan.dups.length} grup, ${extra} file kembar.`);
    for (const g of scan.dups.slice(0, 40)) lines.push(`  - ${g.join("  ==  ")}`);
  }
  const sorted = [...f].sort((a, b) => b.modified - a.modified);
  const shown = sorted.slice(0, full);
  lines.push(`DAFTAR FILE (path | ukuran | tanggal ubah)${f.length > full ? ` — ${full} terbaru dari ${f.length}; sisanya pakai aturan "rule"` : ""}:`);
  for (const x of shown) lines.push(`${x.path} | ${kb(x.size)} | ${day(x.modified)}`);
  return lines.join("\n");
}

/* ---------- baca isi file (teks / csv / xlsx) + profil data ---------- */
const TEXT_EXT = new Set(["txt", "md", "csv", "tsv", "json", "srt", "log", "html", "htm", "xml"]);
export const readable = (e: FileEntry) => TEXT_EXT.has(e.ext) || e.ext === "xlsx";

function parseCsv(t: string): string[][] {
  const sep = (t.split("\n")[0].match(/;/g)?.length ?? 0) > (t.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : t.includes("\t") && !t.includes(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cur);
      cur = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else cur += c;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

/** angka gaya Indonesia / internasional: "Rp 1.234.567", "12,5%", "1,234.5" */
export function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/^rp\.?\s*/i, "").replace(/[%\s]/g, "");
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (dots > 1 || (dots === 1 && /\.\d{3}$/.test(s))) s = s.replace(/\./g, "");
  else if (commas > 1 || (commas === 1 && /,\d{3}$/.test(s))) s = s.replace(/,/g, "");
  else s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const fmt = (n: number) => (Math.abs(n) >= 1000 || Number.isInteger(n) ? Math.round(n).toLocaleString("id-ID") : n.toLocaleString("id-ID", { maximumFractionDigits: 2 }));

/** profil tabel: jumlah baris, total/rata-rata kolom angka, dan total per kategori — supaya AI tidak menghitung manual */
export function profileTable(rows: string[][] | unknown[][]): string {
  const data = rows.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c))));
  if (data.length < 2) return "";
  const head = data[0].map((h, i) => (h || `Kolom${i + 1}`).trim());
  const body = data.slice(1);
  const numCols: number[] = [];
  const catCols: number[] = [];
  head.forEach((_, i) => {
    const vals = body.map((r) => r[i]).filter((x) => x !== undefined && String(x).trim() !== "");
    if (!vals.length) return;
    const nums = vals.filter((x) => toNum(x) !== null).length;
    if (nums / vals.length >= 0.8) numCols.push(i);
    else {
      const distinct = new Set(vals).size;
      if (distinct <= 40 && distinct < vals.length) catCols.push(i);
    }
  });
  const out: string[] = [`baris data: ${body.length}; kolom: ${head.join(" | ")}`];
  for (const i of numCols) {
    const v = body.map((r) => toNum(r[i])).filter((x): x is number => x !== null);
    if (!v.length) continue;
    const sum = v.reduce((a, b) => a + b, 0);
    out.push(`- ${head[i]}: total ${fmt(sum)}, rata-rata ${fmt(sum / v.length)}, min ${fmt(Math.min(...v))}, maks ${fmt(Math.max(...v))} (${v.length} nilai)`);
  }
  for (const c of catCols.slice(0, 4)) {
    const groups = new Map<string, { n: number; sums: number[] }>();
    for (const r of body) {
      const k = (r[c] ?? "").trim() || "(kosong)";
      const g = groups.get(k) ?? { n: 0, sums: numCols.map(() => 0) };
      g.n++;
      numCols.forEach((ni, j) => (g.sums[j] += toNum(r[ni]) ?? 0));
      groups.set(k, g);
    }
    out.push(`- per ${head[c]}:`);
    for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 40))
      out.push(`    ${k}: ${g.n} baris${numCols.length ? "; " + numCols.map((ni, j) => `${head[ni]} ${fmt(g.sums[j])}`).join("; ") : ""}`);
  }
  return out.join("\n");
}

const tableText = (rows: string[][], maxRows: number) =>
  rows
    .slice(0, maxRows + 1)
    .map((r) => r.map((c) => String(c ?? "").replace(/\s+/g, " ").slice(0, 80)).join(" | "))
    .join("\n") + (rows.length > maxRows + 1 ? `\n… (${rows.length - maxRows - 1} baris lagi — pakai angka di PROFIL DATA untuk total)` : "");

export async function readFileForAi(e: FileEntry, budget: number): Promise<string> {
  const file = await e.handle.getFile();
  if (e.ext === "xlsx") {
    const { default: readXlsx } = await import("read-excel-file/browser");
    const sheets = (await readXlsx(file)) as { sheet: string; data: unknown[][] }[];
    const parts: string[] = [];
    for (const s of sheets.slice(0, 8)) {
      const rows = s.data.map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c))));
      parts.push(`[Sheet: ${s.sheet}]\nPROFIL DATA:\n${profileTable(rows)}\nCONTOH BARIS:\n${tableText(rows, 40)}`);
    }
    return parts.join("\n\n").slice(0, budget);
  }
  const text = (await file.text()).replace(/^﻿/, "");
  if (e.ext === "csv" || e.ext === "tsv") {
    const rows = parseCsv(text);
    return `PROFIL DATA:\n${profileTable(rows)}\nCONTOH BARIS:\n${tableText(rows, 60)}`.slice(0, budget);
  }
  if (e.ext === "html" || e.ext === "htm") return text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, budget);
  return text.slice(0, budget);
}

/** pilih file yang dibaca: yang disebut user dulu, lalu file data/teks terbaru */
export async function readContents(scan: Scan, message: string, total = 120_000): Promise<string> {
  const msg = message.toLowerCase();
  const cands = scan.files.filter(readable);
  const named = cands.filter((f) => msg.includes(f.name.toLowerCase()) || msg.includes(f.name.replace(/\.[^.]+$/, "").toLowerCase()));
  const inDir = cands.filter((f) => f.dir && msg.includes(f.dir.toLowerCase().split("/").pop()!));
  const rest = [...cands].sort((a, b) => b.modified - a.modified);
  const order = [...new Set([...named, ...inDir, ...rest])].slice(0, 40);
  const parts: string[] = [];
  let left = total;
  for (const f of order) {
    if (left < 1500) break;
    try {
      const t = await readFileForAi(f, Math.min(40_000, left));
      const block = `=== ${f.path} ===\n${t}`;
      parts.push(block);
      left -= block.length;
    } catch {
      parts.push(`=== ${f.path} === (gagal dibaca)`);
    }
  }
  const skipped = cands.length - parts.length;
  return parts.join("\n\n") + (skipped > 0 ? `\n\n(${skipped} file teks/data lain tidak dibaca karena batas panjang — minta user menyebut nama filenya kalau perlu)` : "");
}

/* ---------- rencana perubahan (dari AI) -> daftar aksi konkret ---------- */
export type Match = { ext?: string[]; name?: string; in?: string; olderThanDays?: number; newerThanDays?: number; minSize?: number; maxSize?: number; dup?: boolean };
export type PlanOp =
  | { op: "mkdir"; path: string }
  | { op: "move"; from: string; to: string; reason?: string }
  | { op: "rename"; from: string; to: string; reason?: string }
  | { op: "delete"; path: string; reason?: string }
  | { op: "rule"; match: Match; action: "move" | "delete"; to?: string; reason?: string }
  | { op: "renameRule"; match: Match; find: string; replace: string; reason?: string };
export type FilePlan = { summary?: string; ops: PlanOp[] };
export type Action = { kind: "move" | "delete"; from: string; to?: string; reason?: string };

const clean = (p: string) =>
  p
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map((s) => s.replace(/[<>:"|?*\u0000-\u001f]/g, "-"))
    .join("/");

const tokens = (t: string, f: FileEntry, n: number) => {
  const d = new Date(f.modified);
  const pad = (x: number) => String(x).padStart(2, "0");
  return t
    .replace(/\{yyyy\}/g, String(d.getFullYear()))
    .replace(/\{mm\}/g, pad(d.getMonth() + 1))
    .replace(/\{dd\}/g, pad(d.getDate()))
    .replace(/\{ext\}/g, f.ext)
    .replace(/\{name\}/g, f.name.replace(/\.[^.]+$/, ""))
    .replace(/\{n\}/g, String(n))
    .replace(/\{nn\}/g, pad(n))
    .replace(/\{nnn\}/g, String(n).padStart(3, "0"));
};

function matches(f: FileEntry, m: Match, dupSet: Set<string>) {
  if (m.ext?.length && !m.ext.map((e) => e.toLowerCase().replace(/^\./, "")).includes(f.ext)) return false;
  if (m.in && !(`${f.dir}/`.toLowerCase().startsWith(`${clean(m.in).toLowerCase()}/`) || (clean(m.in) === "" && !f.dir))) return false;
  if (m.name) {
    try {
      if (!new RegExp(m.name, "i").test(f.name)) return false;
    } catch {
      if (!f.name.toLowerCase().includes(m.name.toLowerCase())) return false;
    }
  }
  const age = (Date.now() - f.modified) / 86400_000;
  if (m.olderThanDays != null && age < m.olderThanDays) return false;
  if (m.newerThanDays != null && age > m.newerThanDays) return false;
  if (m.minSize != null && f.size < m.minSize) return false;
  if (m.maxSize != null && f.size > m.maxSize) return false;
  if (m.dup && !dupSet.has(f.path)) return false;
  return true;
}

/** ubah rencana AI jadi aksi konkret per file (urut, tanpa tabrakan nama) */
export function expandPlan(plan: FilePlan, scan: Scan): { actions: Action[]; skipped: string[] } {
  const byPath = new Map(scan.files.map((f) => [f.path, f]));
  const dupSet = new Set((scan.dups ?? []).flatMap((g) => g.slice(1)));
  const taken = new Set(scan.files.map((f) => f.path.toLowerCase()));
  const used = new Set<string>();
  const actions: Action[] = [];
  const skipped: string[] = [];
  const unique = (target: string) => {
    let t = target;
    const base = t.replace(/(\.[^./]+)?$/, "");
    const ext = t.slice(base.length);
    for (let i = 2; taken.has(t.toLowerCase()); i++) t = `${base} (${i})${ext}`;
    taken.add(t.toLowerCase());
    return t;
  };
  const move = (f: FileEntry, to: string, reason?: string) => {
    if (used.has(f.path)) return;
    const dest = clean(to);
    if (!dest || dest.toLowerCase() === f.path.toLowerCase()) return;
    taken.delete(f.path.toLowerCase());
    used.add(f.path);
    actions.push({ kind: "move", from: f.path, to: unique(dest), reason });
  };
  const del = (f: FileEntry, reason?: string) => {
    if (used.has(f.path)) return;
    used.add(f.path);
    taken.delete(f.path.toLowerCase());
    actions.push({ kind: "delete", from: f.path, reason });
  };
  for (const op of plan.ops ?? []) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "move" || op.op === "rename") {
      const f = byPath.get(clean(op.from));
      if (!f) {
        skipped.push(op.from);
        continue;
      }
      let to = clean(op.to);
      if (op.op === "rename") to = f.dir ? `${f.dir}/${to.split("/").pop()}` : to.split("/").pop()!;
      else if (op.to.trim().endsWith("/") || !/\.[a-z0-9]{1,6}$/i.test(to)) to = `${to}/${f.name}`;
      move(f, to, op.reason);
    } else if (op.op === "delete") {
      const f = byPath.get(clean(op.path));
      if (f) del(f, op.reason);
      else skipped.push(op.path);
    } else if (op.op === "rule") {
      const list = scan.files.filter((f) => matches(f, op.match ?? {}, dupSet)).sort((a, b) => a.modified - b.modified);
      list.forEach((f, i) => {
        if (op.action === "delete") del(f, op.reason);
        else if (op.to) {
          const t = tokens(clean(op.to), f, i + 1);
          move(f, /\.[a-z0-9]{1,6}$/i.test(t) && /\{name\}|\{n/.test(op.to) ? t : `${t}/${f.name}`, op.reason);
        }
      });
    } else if (op.op === "renameRule") {
      const list = scan.files.filter((f) => matches(f, op.match ?? {}, dupSet)).sort((a, b) => a.modified - b.modified);
      let re: RegExp;
      try {
        re = new RegExp(op.find || "^$", "i");
      } catch {
        continue;
      }
      list.forEach((f, i) => {
        const nn = tokens(f.name.replace(re, op.replace ?? ""), f, i + 1).trim();
        if (nn && nn !== f.name) move(f, f.dir ? `${f.dir}/${nn}` : nn, op.reason);
      });
    }
  }
  return { actions, skipped };
}

/* ---------- jalankan + batalkan ---------- */
async function dirOf(root: DirHandle, path: string, create: boolean): Promise<DirHandle> {
  let d = root;
  for (const part of path.split("/").filter(Boolean)) d = await d.getDirectoryHandle(part, { create });
  return d;
}
const split = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) };
};

async function moveFile(root: DirHandle, from: string, to: string) {
  const a = split(from);
  const b = split(to);
  const src = await dirOf(root, a.dir, false);
  const fh = await src.getFileHandle(a.name);
  const dst = await dirOf(root, b.dir, true);
  try {
    await dst.getFileHandle(b.name);
    throw new Error(`sudah ada file ${to}`);
  } catch (e) {
    if ((e as Error).message.startsWith("sudah ada")) throw e;
  }
  if (fh.move) {
    try {
      await fh.move(dst, b.name);
      return;
    } catch {}
  }
  // cadangan: salin isi lalu hapus yang lama
  const file = await fh.getFile();
  const out = await (await dst.getFileHandle(b.name, { create: true })).createWritable();
  await out.write(file);
  await out.close();
  await src.removeEntry(a.name);
}

export type Done = { kind: "move" | "delete"; from: string; to?: string };
export async function applyActions(root: DirHandle, actions: Action[], onProgress: (i: number, err?: string) => void): Promise<{ done: Done[]; errors: string[] }> {
  const done: Done[] = [];
  const errors: string[] = [];
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    try {
      if (a.kind === "move" && a.to) {
        await moveFile(root, a.from, a.to);
        done.push({ kind: "move", from: a.from, to: a.to });
      } else if (a.kind === "delete") {
        const p = split(a.from);
        await (await dirOf(root, p.dir, false)).removeEntry(p.name);
        done.push({ kind: "delete", from: a.from });
      }
      onProgress(i + 1);
    } catch (e) {
      const m = `${a.from}: ${(e as Error).message || "gagal"}`;
      errors.push(m);
      onProgress(i + 1, m);
    }
  }
  return { done, errors };
}

/** kembalikan file yang dipindah / diganti nama ke tempat semula (file yang dihapus tidak bisa kembali) */
export async function undoActions(root: DirHandle, done: Done[], onProgress: (i: number) => void) {
  const errors: string[] = [];
  const moved = done.filter((d) => d.kind === "move").reverse();
  for (let i = 0; i < moved.length; i++) {
    try {
      await moveFile(root, moved[i].to!, moved[i].from);
    } catch (e) {
      errors.push(`${moved[i].to}: ${(e as Error).message}`);
    }
    onProgress(i + 1);
  }
  // folder baru yang sekarang kosong dibersihkan
  const dirs = [...new Set(moved.map((m) => split(m.to!).dir).filter(Boolean))].sort((a, b) => b.length - a.length);
  for (const d of dirs) {
    const parts = d.split("/");
    for (let k = parts.length; k > 0; k--) {
      const path = parts.slice(0, k).join("/");
      try {
        const h = await dirOf(root, path, false);
        let empty = true;
        for await (const _ of h.entries()) {
          void _;
          empty = false;
          break;
        }
        if (!empty) break;
        const p = split(path);
        await (await dirOf(root, p.dir, false)).removeEntry(p.name);
      } catch {
        break;
      }
    }
  }
  return errors;
}

/** simpan file baru (mis. hasil PPT) ke folder, nama dibuat unik */
export async function saveToFolder(root: DirHandle, path: string, data: Blob): Promise<string> {
  const p = split(clean(path));
  const dir = await dirOf(root, p.dir, true);
  let name = p.name;
  const base = name.replace(/(\.[^.]+)?$/, "");
  const ext = name.slice(base.length);
  for (let i = 2; ; i++) {
    try {
      await dir.getFileHandle(name);
      name = `${base} (${i})${ext}`;
    } catch {
      break;
    }
  }
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(data);
  await w.close();
  return p.dir ? `${p.dir}/${name}` : name;
}

export const sizeText = kb;

/* ---------- blok ```fileplan di jawaban AI ---------- */
export function splitFilePlan(text: string): { text: string; plan: FilePlan | null; partial: boolean } {
  const m = text.match(/```fileplan\s*\n([\s\S]*?)```/);
  if (!m) {
    const i = text.indexOf("```fileplan");
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), plan: null, partial: true } : { text, plan: null, partial: false };
  }
  let plan: FilePlan | null = null;
  try {
    const j = JSON.parse(m[1]);
    plan = Array.isArray(j) ? { ops: j } : j && Array.isArray(j.ops) ? j : null;
  } catch {}
  return { text: (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim(), plan, partial: false };
}
