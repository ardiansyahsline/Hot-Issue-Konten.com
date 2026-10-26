/**
 * SALAH DENGAR: teks yang terdengar oleh pengecek ucapan (ASR, faster-whisper di laptop) saat suara bank dibuat dibandingkan
 * dengan naskah VO, supaya kata yang salah diucapkan mesin suara bisa disorot lalu diperbaiki lewat 📖 Kamus ejaan.
 *
 * Perbandingan per kata memakai "kunci bunyi" (huruf kecil, tanpa tanda baca, bunyi luncur w/y dibuang, c/q → k, v → f, huruf
 * kembar disatukan, beberapa ragam lisan disamakan: nggak = gak, saja = aja …). Naskah dibaca dalam beberapa bentuk: tulisan asli,
 * hasil kamus ejaan, dan angka sebagai kata — jadi "16.800" vs "enam belas ribu delapan ratus", "PPT" vs "pepete", "soal" vs
 * "sowal" tidak dianggap salah. Satu kata naskah boleh terdengar sebagai beberapa kata (dan sebaliknya).
 * Modul tanpa React; hanya memakai pronounce.ts.
 */
import { applyLexicon, glideWord, lexiconOf, numbersToWords, speakText, type LexEntry } from "./pronounce";

/** panjang maksimal teks terdengar yang disimpan di VoLine.heard */
export const HEARD_MAX = 400;

/** bersihkan teks terdengar: teks biasa satu baris (tanpa tag / karakter kontrol), spasi dirapikan, maks 400 huruf */
export function normHeard(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v
    .replace(/<\/?[a-z!?][^>]*>/gi, " ")
    .replace(/[<>`{}\\\u0000-\u001f\u007f-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return undefined;
  if (t.length <= HEARD_MAX) return t;
  const cut = t.slice(0, HEARD_MAX);
  const sp = cut.lastIndexOf(" ");
  return (sp > HEARD_MAX * 0.6 ? cut.slice(0, sp) : cut).trim();
}

/**
 * teks terdengar dari satu baris hasil job bank (laptop): `heard` (teks) kalau ada, selain itu gabungan `takes[].heard`
 * (versi terpilih per kalimat / potongan, urut). Bentuk lain / kosong → undefined (worker lama tidak mengirimnya).
 */
export function heardFromResult(row: unknown): string | undefined {
  const o = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  if (typeof o.heard === "string") return normHeard(o.heard);
  const takes = Array.isArray(o.takes) ? o.takes : [];
  const parts = takes.map((t) => (t && typeof t === "object" && typeof (t as Record<string, unknown>).heard === "string" ? ((t as Record<string, unknown>).heard as string) : "")).filter((x) => x.trim());
  return parts.length ? normHeard(parts.join(" ")) : undefined;
}

// ---------------------------------------------------------------------------------------------
// kunci bunyi & potongan kata
// ---------------------------------------------------------------------------------------------
/** ragam lisan yang sering ditulis berbeda oleh ASR — disamakan */
const SAME: Record<string, string> = {
  nggak: "gak", enggak: "gak", ngga: "gak", engga: "gak", ga: "gak", gak: "gak", gk: "gak", nggk: "gak",
  saja: "aja", aja: "aja", sudah: "udah", udah: "udah", dah: "udah", kalau: "kalo", kalo: "kalo", begitu: "gitu", gitu: "gitu",
  memang: "emang", emang: "emang", tetapi: "tapi", tapi: "tapi", bgt: "banget", banget: "banget", gimana: "gimana", bagaimana: "gimana",
};
/** kunci bunyi satu kata / frasa (lihat keterangan modul) */
export function soundKey(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (SAME[t]) return SAME[t];
  t = t
    .replace(/([uo])w(?=[aeiou])/g, "$1")
    .replace(/iy(?=[aeiou])/g, "i")
    .replace(/ph/g, "f")
    .replace(/kh/g, "h")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/v/g, "f")
    .replace(/y/g, "i")
    .replace(/w/g, "u")
    .replace(/(.)\1+/g, "$1");
  return t;
}

type Unit = { raw: string; start: number; end: number };
/** kata: angka (16.800 · 2,5% · Rp16.800 · 10:30) atau huruf/angka bersambung strip / apostrof / titik (real-time, Konten.com, ke-3) */
const UNIT = /(?:rp\.?\s?)?\d+(?:[.,:]\d+)*(?:\s?%)?(?![\p{L}])|[\p{L}\p{N}]+(?:[-'’.,][\p{L}\p{N}]+)*%?/giu;
function units(s: string): Unit[] {
  const out: Unit[] = [];
  for (const m of s.matchAll(UNIT)) out.push({ raw: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return out;
}
const lev = (a: string, b: string): number => {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
};

// ---------------------------------------------------------------------------------------------
// perbandingan
// ---------------------------------------------------------------------------------------------
/** sepotong teks terdengar: `pre` = tanda baca / spasi sebelumnya; `ok` false = beda dari naskah; `ref` = indeks kata naskah */
export type HeardPart = { pre: string; text: string; ok: boolean; ref: number | null; extra?: boolean };
export type HeardDiff = {
  parts: HeardPart[];
  /** sisa teks sesudah kata terakhir */
  tail: string;
  /** kata naskah (urut) */
  refs: string[];
  /** indeks kata naskah yang tidak terdengar sama sekali */
  missing: number[];
  /** jumlah bagian yang beda (tidak termasuk kata hilang) */
  bad: number;
  /** semua kata terdengar sama dengan naskah */
  clean: boolean;
};

const MAX_UNITS = 120;
/** paling banyak kata terdengar untuk satu kata naskah (angka panjang: "enam belas ribu delapan ratus" = 5) */
const KH = 8;
/** paling banyak kata naskah untuk satu kata terdengar ("bareng bareng" ↔ "barengbareng") */
const KR = 3;

type Step = { di: number; dj: number; op: "ok" | "sub" | "del" | "ins" };

/**
 * Bandingkan teks terdengar dengan naskah VO (`text`, bentuk tulis). `spell` (ejaan khusus adegan) & `lexicon` (kamus proyek)
 * ikut dipakai: kata yang terdengar persis seperti teks ucapan yang dikirim tidak dianggap salah.
 */
export function heardDiff(text: string, heard: string, opts: { spell?: string | null; lexicon?: readonly LexEntry[] | null } = {}): HeardDiff {
  const lex = lexiconOf(opts.lexicon);
  const R = units(text).slice(0, MAX_UNITS);
  const H = units(heard).slice(0, MAX_UNITS);
  const rk = R.map((u) => {
    const a = soundKey(numbersToWords(u.raw));
    const b = soundKey(numbersToWords(applyLexicon(u.raw, lex)));
    return a === b ? [a] : [a, b];
  });
  const hk = H.map((u) => soundKey(numbersToWords(u.raw)));
  const n = R.length;
  const m = H.length;
  const INF = 1e9;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const back: (Step | null)[][] = Array.from({ length: n + 1 }, () => new Array<Step | null>(m + 1).fill(null));
  cost[0][0] = 0;
  const relax = (i: number, j: number, s: Step, c: number) => {
    const ni = i + s.di;
    const nj = j + s.dj;
    if (ni > n || nj > m) return;
    const v = cost[i][j] + c;
    if (v < cost[ni][nj] - 1e-9) {
      cost[ni][nj] = v;
      back[ni][nj] = s;
    }
  };
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= m; j++) {
      if (cost[i][j] >= INF) continue;
      if (i < n) relax(i, j, { di: 1, dj: 0, op: "del" }, 1);
      if (j < m) relax(i, j, { di: 0, dj: 1, op: "ins" }, 1);
      if (i < n && j < m) {
        // satu kata naskah = 1..KH kata terdengar
        let cat = "";
        for (let k = 1; k <= KH && j + k <= m; k++) {
          cat += hk[j + k - 1];
          if (rk[i].includes(cat)) relax(i, j, { di: 1, dj: k, op: "ok" }, 0.001 * (k - 1));
          else if (k === 1 && Math.min(cat.length, rk[i][0].length) >= 6 && rk[i].some((x) => lev(x, cat) <= 1)) relax(i, j, { di: 1, dj: 1, op: "ok" }, 0.3);
        }
        // 2..KR kata naskah = satu kata terdengar
        for (let k = 2; k <= KR && i + k <= n; k++) {
          const a = rk.slice(i, i + k).map((x) => x[0]).join("");
          const b = rk.slice(i, i + k).map((x) => x[x.length - 1]).join("");
          if (a === hk[j] || b === hk[j]) relax(i, j, { di: k, dj: 1, op: "ok" }, 0.001 * (k - 1));
        }
        // salah ucap: satu kata naskah terdengar sebagai 1–2 kata lain ("soal" → "su ul"), atau dua kata naskah jadi satu kata lain
        // (sedikit lebih mahal dari hilang + tambahan, supaya kata yang cuma hilang / diulang tidak dianggap tertukar)
        relax(i, j, { di: 1, dj: 1, op: "sub" }, 1.2);
        if (j + 2 <= m) relax(i, j, { di: 1, dj: 2, op: "sub" }, 1.7);
        if (i + 2 <= n) relax(i, j, { di: 2, dj: 1, op: "sub" }, 1.7);
      }
    }
  // telusur balik
  const steps: (Step & { i: number; j: number })[] = [];
  for (let i = n, j = m; i > 0 || j > 0; ) {
    const s = back[i][j];
    if (!s) break;
    i -= s.di;
    j -= s.dj;
    steps.unshift({ ...s, i, j });
  }
  // kata yang HANYA ada di teks ucapan yang dikirim (ejaan khusus adegan, mis. "Alip" untuk "Alif") → terdengar begitu = bukan salah.
  // Kata naskah biasa tidak ikut, supaya kata yang diulang / tertukar tempat tetap tersorot.
  const plain = new Set(rk.flat());
  const sent = new Set(units(speakText(text, opts.spell, opts.lexicon)).map((u) => soundKey(u.raw)).filter((k) => !plain.has(k)));
  const parts: HeardPart[] = [];
  const missing: number[] = [];
  let cursor = 0;
  const push = (j0: number, j1: number, ok: boolean, ref: number | null, extra?: boolean) => {
    if (j1 <= j0) return;
    const text0 = heard.slice(H[j0].start, H[j1 - 1].end);
    parts.push({ pre: heard.slice(cursor, H[j0].start), text: text0, ok, ref, ...(extra ? { extra } : {}) });
    cursor = H[j1 - 1].end;
  };
  steps.forEach((s, k) => {
    if (s.op === "ok") return push(s.j, s.j + s.dj, true, s.i);
    if (s.op === "del") return void missing.push(s.i);
    if (s.op === "sub") {
      const key = hk.slice(s.j, s.j + s.dj).join("");
      const fine = sent.has(key) || hk.slice(s.j, s.j + s.dj).every((x) => sent.has(x));
      return push(s.j, s.j + s.dj, fine, s.i);
    }
    // kata tambahan: ikut kata naskah di sebelahnya kalau kata itu juga salah, selain itu tidak bisa diklik
    const prev = steps[k - 1];
    const next = steps[k + 1];
    const near = prev && prev.op !== "ok" && prev.op !== "ins" ? prev.i : next && (next.op === "sub" || next.op === "del") ? next.i : null;
    const fine = sent.has(hk[s.j]);
    push(s.j, s.j + 1, fine, fine ? null : near, !fine);
  });
  const tail = H.length ? heard.slice(cursor) : heard;
  // bagian salah yang berurutan untuk kata naskah yang sama digabung (satu sorotan)
  const merged: HeardPart[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && !last.ok && !p.ok && last.ref !== null && last.ref === p.ref) {
      last.text += p.pre + p.text;
      last.extra = undefined;
      continue;
    }
    merged.push({ ...p });
  }
  for (const p of merged) if (p.extra === undefined) delete p.extra;
  const bad = merged.filter((p) => !p.ok).length;
  return { parts: merged, tail, refs: R.map((u) => u.raw), missing, bad, clean: bad === 0 && missing.length === 0 };
}

// ---------------------------------------------------------------------------------------------
// saran ejaan
// ---------------------------------------------------------------------------------------------
const VOW = "aeiou";
/** suku kata bahasa Indonesia sederhana: V-CV, VC-CV, VC-CCV; ng / ny / kh / sy satu konsonan; diftong di ujung kata satu bunyi */
export function syllables(word: string): string[] {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return [];
  const u: { s: string; v: boolean }[] = [];
  for (let i = 0; i < w.length; ) {
    const two = w.slice(i, i + 2);
    if (["ng", "ny", "kh", "sy"].includes(two)) {
      u.push({ s: two, v: false });
      i += 2;
    } else if (["ai", "au", "oi", "ei"].includes(two) && i + 2 === w.length) {
      u.push({ s: two, v: true });
      i += 2;
    } else {
      u.push({ s: w[i], v: VOW.includes(w[i]) });
      i++;
    }
  }
  const vi = u.flatMap((x, k) => (x.v ? [k] : []));
  if (vi.length < 2) return [w];
  const out: string[] = [];
  let from = 0;
  for (let a = 0; a < vi.length - 1; a++) {
    const cons = vi[a + 1] - vi[a] - 1;
    const cut = cons === 0 ? vi[a + 1] : cons === 1 ? vi[a] + 1 : vi[a] + 2;
    out.push(u.slice(from, cut).map((x) => x.s).join(""));
    from = cut;
  }
  out.push(u.slice(from).map((x) => x.s).join(""));
  return out.filter(Boolean);
}

/** nama huruf cara Indonesia (untuk singkatan: OJK → o je ka) */
const LETTER: Record<string, string> = {
  a: "a", b: "be", c: "se", d: "de", e: "e", f: "ef", g: "ge", h: "ha", i: "i", j: "je", k: "ka", l: "el", m: "em",
  n: "en", o: "o", p: "pe", q: "ki", r: "er", s: "es", t: "te", u: "u", v: "ve", w: "we", x: "eks", y: "ye", z: "zet",
};
const isAcronym = (w: string) => {
  const l = w.replace(/[^\p{L}]/gu, "");
  return l.length >= 2 && l.length <= 6 && l === l.toUpperCase() && l !== l.toLowerCase();
};

/**
 * Saran ejaan untuk kata naskah yang salah dengar (paling atas = isian awal): bunyi luncur (soal → sowal), suku kata dipisah
 * spasi (be ran ta kan), singkatan dieja per huruf (OJK → o je ka), angka jadi kata. Ejaan kamus yang sedang dipakai & tulisan
 * aslinya tidak disarankan lagi (itulah yang salah dengar). Maks 3.
 */
export function spellSuggestions(word: string, lexicon?: readonly LexEntry[] | null): string[] {
  const w = word.trim();
  if (!w) return [];
  const lower = w.toLowerCase();
  const cur = applyLexicon(w, lexiconOf(lexicon)).toLowerCase();
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim().toLowerCase();
    if (t && t !== lower && t !== cur && !out.includes(t)) out.push(t);
  };
  if (/\d/.test(w)) add(numbersToWords(w));
  if (isAcronym(w)) add([...w.replace(/[^\p{L}]/gu, "").toLowerCase()].map((c) => LETTER[c] ?? c).join(" "));
  const g = glideWord(lower);
  if (g !== lower) add(g);
  const base = cur !== lower ? cur : lower;
  const bg = glideWord(base);
  add(base.split(/\s+/).map((x) => syllables(glideWord(x)).join(" ") || x).join(" "));
  if (bg !== base) add(bg);
  if (cur !== lower) add(cur.split(/\s+/).map((x) => syllables(x).join(" ") || x).join(" "));
  if (!out.length) add(lower.split(/[-\s]+/).map((x) => syllables(x).join(" ") || x).join(" "));
  return out.slice(0, 3);
}
