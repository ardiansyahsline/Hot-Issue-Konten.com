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
/** ragam lisan yang sering ditulis berbeda oleh ASR — disamakan (Map: kata "constructor" dll. bukan kunci bawaan objek) */
const SAME: ReadonlyMap<string, string> = new Map(Object.entries({
  nggak: "gak", enggak: "gak", ngga: "gak", engga: "gak", ga: "gak", gak: "gak", gk: "gak", nggk: "gak",
  saja: "aja", aja: "aja", sudah: "udah", udah: "udah", dah: "udah", kalau: "kalo", kalo: "kalo", begitu: "gitu", gitu: "gitu",
  memang: "emang", emang: "emang", tetapi: "tapi", tapi: "tapi", bgt: "banget", banget: "banget", gimana: "gimana", bagaimana: "gimana",
  // "hot issue" biasa ditulis ASR "hot isu" / "isyu"; "ei ai" (AI) kadang "eh ai"
  issue: "isu", isyu: "isu", isu: "isu", issu: "isu", eh: "e",
}));
/** huruf kembar disatukan ("ppt" → "pt"), juga sesudah kunci beberapa kata digabung ("p"+"p"+"t") */
const squash = (s: string) => s.replace(/(.)\1+/g, "$1");
/** kunci bunyi satu kata / frasa (lihat keterangan modul) */
export function soundKey(s: string): string {
  let t = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const same = SAME.get(t);
  if (same) return same;
  t = t
    .replace(/([uo])w(?=[aeiou])/g, "$1")
    .replace(/iy(?=[aeiou])/g, "i")
    .replace(/sy/g, "s")
    .replace(/ph/g, "f")
    .replace(/kh/g, "h")
    .replace(/[cq]/g, "k")
    .replace(/x/g, "ks")
    .replace(/v/g, "f")
    .replace(/y/g, "i")
    .replace(/w/g, "u")
    // diftong ei ≈ e ("survei" = "surve", "ei ai" = "e ai")
    .replace(/ei/g, "e");
  return squash(t);
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
          cat = squash(cat + hk[j + k - 1]);
          if (rk[i].includes(cat)) relax(i, j, { di: 1, dj: k, op: "ok" }, 0.001 * (k - 1));
          else if (k === 1 && Math.min(cat.length, rk[i][0].length) >= 6 && rk[i].some((x) => lev(x, cat) <= 1)) relax(i, j, { di: 1, dj: 1, op: "ok" }, 0.3);
        }
        // 2..KR kata naskah = satu kata terdengar
        for (let k = 2; k <= KR && i + k <= n; k++) {
          const a = squash(rk.slice(i, i + k).map((x) => x[0]).join(""));
          const b = squash(rk.slice(i, i + k).map((x) => x[x.length - 1]).join(""));
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
      const key = squash(hk.slice(s.j, s.j + s.dj).join(""));
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
const LETTER: ReadonlyMap<string, string> = new Map(Object.entries({
  a: "a", b: "be", c: "se", d: "de", e: "e", f: "ef", g: "ge", h: "ha", i: "i", j: "je", k: "ka", l: "el", m: "em",
  n: "en", o: "o", p: "pe", q: "ki", r: "er", s: "es", t: "te", u: "u", v: "ve", w: "we", x: "eks", y: "ye", z: "zet",
}));
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
  if (isAcronym(w)) add([...w.replace(/[^\p{L}]/gu, "").toLowerCase()].map((c) => LETTER.get(c) ?? c).join(" "));
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

// ---------------------------------------------------------------------------------------------
// kamus dari luar (impor skill): entri yang mengganti kata dengan kata lain
// ---------------------------------------------------------------------------------------------
/** nama huruf cara Inggris (singkatan asing: GPU → ji pi yu, AI → ei ai) */
const LETTER_EN: ReadonlyMap<string, string> = new Map(Object.entries({
  a: "ei", b: "bi", c: "si", d: "di", e: "i", f: "ef", g: "ji", h: "eic", i: "ai", j: "jei", k: "kei", l: "el", m: "em",
  n: "en", o: "o", p: "pi", q: "kiu", r: "ar", s: "es", t: "ti", u: "yu", v: "vi", w: "dabelyu", x: "eks", y: "wai", z: "zet",
}));
/** jarak edit penuh (lev di atas dibatasi untuk pencocokan kata) */
function editDistance(a: string, b: string): number {
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
}
const isSubsequence = (short: string, long: string) => {
  let i = 0;
  for (const ch of long) if (ch === short[i]) i++;
  return i === short.length;
};

/**
 * kata umum bahasa Indonesia (sering dipakai + kata yang artinya mudah dibalik: naik/turun, untung/rugi, halal/haram …). Entri kamus
 * yang mengubah BUNYI kata ini (bukan sekadar ragam lisan) hampir pasti mengganti artinya.
 */
const COMMON: ReadonlySet<string> = new Set(
  (
    "yang dan atau di ke dari ini itu dengan untuk tidak tak ada adalah akan pada juga saya kamu kami kita mereka dia ia anda aku " +
    "bisa sudah belum masih harus boleh jangan mau ingin perlu sangat lebih paling kurang banyak sedikit semua setiap beberapa " +
    "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh puluh belas ratus ribu juta miliar triliun nol " +
    "ya iya bukan benar salah betul baik buruk bagus jelek besar kecil tinggi rendah naik turun atas bawah depan belakang kiri kanan " +
    "dalam luar baru lama cepat lambat mudah sulit susah murah mahal untung rugi laba aman bahaya berbahaya selamat celaka " +
    "senang sedih suka benci marah takut berani halal haram wajib dilarang larang gratis bayar beli jual harga saham uang emas " +
    "pasar modal utang hutang pinjam bunga pajak hemat boros kaya miskin menang kalah hidup mati sehat sakit panas dingin " +
    "terang gelap siang malam pagi sore hari bulan tahun sekarang nanti kemarin besok selalu pernah sering jarang hanya cuma " +
    "lagi sedang dapat punya buat bikin kerja pakai lihat dengar tahu coba mulai selesai berhenti lanjut tunggu datang pergi " +
    "pulang masuk keluar buka tutup ambil kasih beri terima kirim minta tolong tanya jawab bilang baca tulis hitung pilih cari " +
    "tambah kurang hapus simpan ubah ganti tetap sama beda lain orang anak teman rumah kantor jalan berita kabar resmi palsu " +
    "asli nyata fakta bohong jujur percaya terbukti positif negatif setuju tolak terima lulus gagal berhasil sukses rusak " +
    "penuh kosong habis sisa mulai awal akhir pertama terakhir semua tanpa harus pasti mungkin jarang setuju aktif mati nyala " +
    // istilah pasar (Inggris) yang artinya mudah dibalik
    "bullish bearish buy sell long short profit loss cuan boncos hold up down"
  ).split(" "),
);

export type LexRisk = { kind: "common" | "word" | "acronym"; text: string };

/** kode mata uang yang biasa dibaca nama uangnya (bukan per huruf) */
const CURRENCY: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries({ idr: ["rupiah"], rp: ["rupiah"], usd: ["dolar", "dolar amerika"], sgd: ["dolar singapura"], eur: ["euro"], jpy: ["yen"], cny: ["yuan"], gbp: ["pound", "poundsterling"] }),
);

/**
 * bacaan kasar kata Inggris cara Indonesia ("share" → "syer", "caption" → "kepsyen", "download" → "daunlod", "email" → "imel")
 * — hanya untuk menilai apakah ejaan kamus masih "cara baca" kata itu, bukan untuk diucapkan
 */
function enReading(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/^e(?=m[aeiou])/, "i")
    .replace(/[st]ion/g, "syen")
    .replace(/sh/g, "sy")
    .replace(/ch/g, "c")
    .replace(/th/g, "t")
    .replace(/ph/g, "f")
    .replace(/qu/g, "kw")
    .replace(/are$/, "er")
    .replace(/(?:ee|ea|ie)/g, "i")
    .replace(/oo/g, "u")
    .replace(/o[uw]/g, "au")
    .replace(/oa/g, "o")
    .replace(/a[iy]/g, "e")
    .replace(/a(?=[^aeiou]e$)/, "e")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/([a-z][^aeiou])e$/, "$1")
    .replace(/y$/, "i");
}

/**
 * Entri kamus yang MENGGANTI kata dengan kata lain (bukan sekadar cara baca): bunyi ejaan jauh dari bunyi tulisannya, mis.
 * "naik" → "anjlok", "aman" → "berbahaya", "BBCA" → "be be er i". Dipakai pratinjau impor skill (file dari luar, tidak dipercaya):
 * subtitle tetap tulisan aslinya tapi suara VO mengucapkan kata lain, dan pengecek ucapan menganggap ejaan kamus itu benar.
 * Bukan risiko: cara baca istilah asing ("download" → "daunlod", "share" → "syer"), singkatan dieja per huruf cara Indonesia /
 * Inggris ("IHSG" → "i ha es ge", "GPU" → "ji pi yu") atau kepanjangannya ("OJK" → "otoritas jasa keuangan"), kode uang
 * ("IDR" → "rupiah"), singkatan tanpa huruf hidup ("dll" → "dan lain lain", "yg" → "yang"), angka jadi kata ("MP3" → "em pe tiga").
 * `known` = ejaan lain yang sudah dipercaya untuk tulisan yang sama (mis. kamus bawaan Studio) — ejaan yang mirip itu aman.
 * null = aman.
 */
export function lexiconRisk(from: string, to: string, known?: string | null): LexRisk | null {
  const words = from.split(/[\s-]+/).filter(Boolean);
  const target = soundKey(to);
  if (!words.length || !target) return null;
  const acro = (w: string) => isAcronym(w) || (/^[\p{L}\d]+$/u.test(w) && !/[aeiouy]/i.test(w.replace(/\d/g, "")) && /\p{L}/u.test(w));
  const hasAcro = words.some(acro);
  const one = words.length === 1 ? words[0] : "";
  const toWords = to.toLowerCase().split(/[\s-]+/).filter(Boolean);
  // kata umum: bunyinya berubah sedikit pun (selain ragam lisan nggak = gak) → kata lain ("halal" → "haram", "naik" → "anjlok")
  if (one && COMMON.has(one.toLowerCase()) && soundKey(one) !== target && soundKey(enReading(one)) !== target)
    return { kind: "common", text: `Kata umum “${from}” diucapkan “${to}” — artinya bisa berubah. Subtitle tetap “${from}”.` };
  // kode uang dibaca nama uangnya; singkatan dibaca kepanjangannya (huruf depan tiap kata = huruf singkatannya)
  if (one && (CURRENCY.get(one.toLowerCase()) ?? []).includes(toWords.join(" "))) return null;
  if (one && isAcronym(one) && toWords.length === one.length && toWords.every((x, i) => x[0] === one[i].toLowerCase())) return null;
  // bacaan yang wajar untuk tulisan ini: apa adanya, cara baca Inggris, singkatan per huruf (Indonesia / Inggris), angka jadi kata
  const reading = (letters: ReadonlyMap<string, string> | null, en = false) =>
    soundKey(
      words
        .map((w) => {
          const n = /\d/.test(w) ? numbersToWords(w.replace(/(\d)/g, " $1 ")) : w;
          if (letters && acro(w)) return [...n].map((c) => (/[a-z]/i.test(c) ? letters.get(c.toLowerCase()) ?? c : c)).join(" ");
          return en && !acro(w) && !/\d/.test(w) ? enReading(w) : n;
        })
        .join(" "),
    );
  const cands = [reading(null), reading(null, true), ...(hasAcro ? [reading(LETTER), reading(LETTER_EN)] : [])].filter(Boolean);
  const ratio = Math.min(...cands.map((c) => editDistance(c, target) / Math.max(c.length, target.length)));
  const knownKey = known ? soundKey(known) : "";
  const nearKnown = !!knownKey && editDistance(knownKey, target) / Math.max(knownKey.length, target.length) <= 0.34;
  // singkatan tanpa huruf hidup ("dll", "yg", "tdk"): huruf-hurufnya muncul berurutan di ejaannya, huruf pertama sama
  const abbrev = !!one && !isAcronym(one) && acro(one) && target[0] === soundKey(one)[0] && isSubsequence(soundKey(one), target);
  if (nearKnown || abbrev || ratio <= (hasAcro ? 0.34 : 0.5)) return null;
  return hasAcro && one
    ? { kind: "acronym", text: `Singkatan “${from}” diucapkan “${to}” — bunyinya beda dari hurufnya. Subtitle tetap “${from}”.` }
    : { kind: "word", text: `“${from}” diucapkan “${to}” — bunyinya jauh dari tulisannya, bisa jadi kata lain. Subtitle tetap “${from}”.` };
}
