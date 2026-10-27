/**
 * SALAH DENGAR: teks yang terdengar oleh pengecek ucapan (ASR, faster-whisper di laptop) saat suara bank dibuat dibandingkan
 * dengan naskah VO, supaya kata yang salah diucapkan mesin suara bisa disorot lalu diperbaiki lewat 📖 Kamus ejaan.
 *
 * Perbandingan per kata memakai "kunci bunyi" (huruf kecil, tanpa tanda baca, bunyi luncur w/y dibuang, c/q → k, v → f, huruf
 * kembar disatukan, beberapa ragam lisan disamakan: nggak = gak, saja = aja …). Naskah dibaca dalam beberapa bentuk: tulisan asli,
 * hasil kamus ejaan, dan angka sebagai kata — jadi "16.800" vs "enam belas ribu delapan ratus", "PPT" vs "pepete", "soal" vs
 * "sowal" tidak dianggap salah. Satu kata naskah boleh terdengar sebagai beberapa kata (dan sebaliknya).
 * Modul tanpa React; hanya memakai pronounce.ts & pepet.ts. Teks terdengar selalu dari suara bank → kamus dibaca versi bank (termasuk
 * ejaan khusus bank suara dari 🎧 Coba ejaan); ə dianggap e, dan ejaan yang cuma menandai bunyi e bukan risiko kamus.
 */
import { applyLexicon, glideWord, lexiconOf, numbersToWords, speakText, type LexEntry } from "./pronounce";
import { isPepetSpelling } from "./pepet";

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
    // ə (lambang pepet, ejaan dari 🎧 Coba ejaan) = e
    .replace(/[əǝƏƎ]/g, "e")
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
  // teks terdengar selalu dari suara bank → kamus versi bank (termasuk ejaan khusus bank suara)
  const lex = lexiconOf(opts.lexicon, "bank");
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
  const sent = new Set(units(speakText(text, opts.spell, opts.lexicon, "bank")).map((u) => soundKey(u.raw)).filter((k) => !plain.has(k)));
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
  const cur = applyLexicon(w, lexiconOf(lexicon, "bank")).toLowerCase();
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
    "bullish bearish buy sell long short profit loss cuan boncos hold up down " +
    // nama hari & bulan ("Oktober" → "November" mengganti tanggalnya)
    "senin selasa rabu kamis jumat sabtu minggu januari februari maret april mei juni juli agustus september oktober november desember"
  ).split(" "),
);

export type LexRisk = { kind: "common" | "word" | "acronym" | "number"; text: string };

/** kata bilangan (untuk membandingkan angka tulisan dengan angka yang diucapkan) */
const NUM_WORDS: ReadonlySet<string> = new Set(
  "nol satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas seratus seribu belas puluh ratus ribu juta miliar triliun koma persen".split(" "),
);
/**
 * satuan sesudah angka → kata satuan yang WAJIB ikut diucapkan ("10rb" → "sepuluh ribu", "5jt" → "lima juta", "1,5x" → "satu koma
 * lima kali"); "10rb" → "sepuluh" mengubah nilainya. Map: satuan "constructor" dll. dari file luar bukan kunci bawaan objek.
 */
const NUM_UNIT: ReadonlyMap<string, readonly string[]> = new Map(Object.entries({
  rb: ["ribu"], ribu: ["ribu"], k: ["ribu"], jt: ["juta"], juta: ["juta"], m: ["juta", "miliar"], b: ["miliar"], bn: ["miliar"],
  miliar: ["miliar"], milyar: ["miliar"], t: ["triliun"], tn: ["triliun"], triliun: ["triliun"], x: ["kali"],
}));
/** satuan huruf kecil yang juga satuan ukuran / waktu (bukan ribu / juta / triliun) → kata yang boleh diucapkan */
const MEASURE: ReadonlyMap<string, readonly string[]> = new Map(
  Object.entries({ m: ["meter", "menit", "mil"], t: ["ton"], k: ["kilo", "kilogram", "kilometer"] }),
);
/** angka cara baca Inggris di ejaan ("GPT-4" → "ji pi ti for", "Web3" → "web tri") */
const EN_NUM: ReadonlyMap<string, string> = new Map(
  Object.entries({
    zero: "nol", ziro: "nol", one: "satu", wan: "satu", two: "dua", tu: "dua", three: "tiga", tri: "tiga", thri: "tiga", four: "empat",
    for: "empat", fo: "empat", five: "lima", faif: "lima", faiv: "lima", six: "enam", siks: "enam", seven: "tujuh", sefen: "tujuh",
    eight: "delapan", eit: "delapan", nine: "sembilan", nain: "sembilan", ten: "sepuluh",
  }),
);
/**
 * kata bilangan dari satu kata ucapan, dalam bentuk baku: "ketiga" = "tiga", "pertama" = "satu", "four" = "empat", "milyar" =
 * "miliar", "sepuluh" / "sebelas" / "seratus" / "seribu" / "sejuta" … = "satu puluh" / "satu belas" / "satu ratus" / "satu ribu" /
 * "satu juta" … (jadi "1rb" → "seribu" = "satu" + "ribu"), "kosong" (nol cara lisan: "021" → "kosong dua satu") = "nol". Bukan kata
 * bilangan → [].
 */
function numWords(word: string): string[] {
  const x = word.toLowerCase().replace(/[^a-z]/g, "").replace(/milyar$/, "miliar");
  const w = x === "pertama" ? "satu" : x === "kosong" ? "nol" : x.startsWith("ke") && NUM_WORDS.has(x.slice(2)) ? x.slice(2) : (EN_NUM.get(x) ?? x);
  if (/^se(puluh|belas|ratus|ribu|juta|miliar|triliun)$/.test(w)) return ["satu", w.slice(2)];
  return NUM_WORDS.has(w) ? [w] : [];
}
/** deret kata bilangan dalam teks (angka ditulis jadi kata dulu; lihat numWords) */
const numSeq = (s: string): string => numbersToWords(s).toLowerCase().split(/[^a-z]+/).flatMap(numWords).join(" ");
/** kata bilangan Indonesia (lihat unglue) */
const NUM_PIECES: readonly string[] = [...NUM_WORDS, "kosong", "sejuta"];
const NUM_ALT = "sepuluh|sebelas|seratus|seribu|sejuta|sembilan|delapan|kosong|nol|satu|dua|tiga|empat|lima|enam|tujuh|puluh|belas|ratus|ribu|juta|miliar|milyar|triliun";
/**
 * + angka cara Inggris yang cukup panjang (≥ 3 huruf: "tri", "for" — bukan "tu" / "fo" / "ten", yang sering terbentuk dari nama huruf:
 * "efo" = F O, "zeten" = Z N)
 */
const NUM_ALT_EN = `${NUM_ALT}|${[...EN_NUM.keys()].filter((k) => k.length >= 3 && k !== "ten").sort((a, b) => b.length - a.length).join("|")}`;
const NUM_PIECE = new RegExp(`(${NUM_ALT_EN})`, "g");
const NUM_HEAD = new RegExp(`^(?:${NUM_ALT_EN})+`);
const NUM_TAIL = new RegExp(`(?:${NUM_ALT_EN})+$`);
/** kata bilangan besar / satuan yang menempel di mana pun ("sepuluhribu", "limapersen") */
const UNIT_PIECE = /(puluh|belas|ratus|ribu|juta|miliar|milyar|triliun|koma|persen|rupiah|kali)/g;
/** ada kata bilangan Indonesia, juga yang menempel di kata lain ("empeempat", "emduabelas") */
const NUM_ANY = new RegExp(NUM_ALT);
/**
 * Angka yang ditulis LEKAT dengan huruf di ejaan ("MP3" → "empetiga", "5G" → "limaji", "Web3" → "webtri", "H2O" → "haduao",
 * "10rb" → "sepuluhribu") dipisah jadi kata sendiri ("empe tiga", "lima ji", "web tri", "sepuluh ribu"), supaya dicek seperti ejaan
 * berspasi — gaya ejaan lekat dipakai kamus bawaan sendiri ("PPT" → "pepete"). Bacaan tiap deret angka tulisan dicari berurutan:
 * utuh ("11" → "sebelas", "45" → "empat puluh lima") atau per digit (Indonesia dulu, lalu cara Inggris EN_NUM: "3" → "tiga" / "tri");
 * kata bilangan / satuan lain yang ikut menempel ("puluh", "ribu", "rupiah", "kali" …) juga dipisah, jadi angka yang berubah tetap
 * ketahuan ("Web3" → "webtigapuluh" → "web tiga puluh"). Ada deret yang bacaannya tidak ketemu → null (angkanya memang tidak terucap:
 * "Q3" → "kuartal", "M2" → "em").
 */
function unglue(from: string, to: string): string | null {
  const s = to.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const cuts: { at: number; end: number; rep: string }[] = [];
  let pos = 0;
  // bacaan di posisi i memotong kata bilangan lain ("tu" di "tujuh" / "satu", "eit" di "keitujuh") → bukan bacaan digit itu
  const splits = (i: number, a: string) =>
    NUM_PIECES.some((w) => {
      for (let j = Math.max(0, i - w.length + 1); j < i + a.length; j++) if (s.startsWith(w, j) && (j < i || j + w.length > i + a.length)) return true;
      return false;
    });
  // angka cara Inggris (pendek, bisa terbentuk dari potongan nama huruf: "eit" di "jeijeiti" = J J T) hanya di awal / akhir kata,
  // atau sesudah nama-nama huruf utuh sejak awal kata / angka sebelumnya ("webtri", "forkei", "bitubi", "zeteitfaif")
  const edge = (i: number, a: string) => {
    if (!/[a-z]/.test(s[i + a.length] ?? "")) return true;
    const left = s.slice(Math.max(cuts.at(-1)?.end ?? 0, s.lastIndexOf(" ", i - 1) + 1), i);
    return !left || namesOnly(left);
  };
  const find = (alts: readonly string[], rep?: string) =>
    alts.some((a) => {
      for (let at = a ? s.indexOf(a, pos) : -1; at >= 0; at = s.indexOf(a, at + 1)) {
        if (splits(at, a) || (EN_NUM.has(a) && !edge(at, a))) continue;
        cuts.push({ at, end: (pos = at + a.length), rep: rep ?? a });
        return true;
      }
      return false;
    });
  for (const run of from.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const whole = numbersToWords(run).trim();
    if (find([whole.replace(/\s+/g, "")], whole)) continue;
    const ok = [...run.replace(/\D/g, "")].every((d) => {
      const id = numbersToWords(d).trim();
      const en = [...EN_NUM].filter(([, v]) => v === id).map(([k]) => k).sort((a, b) => b.length - a.length);
      return find([id, ...(d === "0" ? ["kosong"] : []), ...en]);
    });
    if (!ok) return null;
  }
  if (!cuts.length) return null;
  // potongan di antara bacaan angka: kata bilangan yang menempel tepat di sebelah angka ("empesatu|tiga" = MP13, "empat|tigaviel" =
  // 43VL) dan kata bilangan / satuan di mana pun ("tiga|puluh", "sepuluh|ribu") dipisah, jadi ikut dibandingkan sebagai angka
  const words = (t: string) => t.replace(NUM_PIECE, " $1 ");
  const piece = (t: string, after: boolean, before: boolean) => {
    const head = after ? (NUM_HEAD.exec(t)?.[0] ?? "") : "";
    const tail = before ? (NUM_TAIL.exec(t.slice(head.length))?.[0] ?? "") : "";
    return ` ${words(head)} ${t.slice(head.length, t.length - tail.length).replace(UNIT_PIECE, " $1 ")} ${words(tail)} `;
  };
  let out = "";
  let last = 0;
  cuts.forEach((c, i) => {
    out += `${piece(s.slice(last, c.at), i > 0, true)} ${c.rep} `;
    last = c.end;
  });
  return (out + piece(s.slice(last), true, false)).replace(/\s+/g, " ").trim();
}

/** nama huruf lain yang lazim ditulis (selain LETTER / LETTER_EN): V cara Indonesia "fe" / "fi", X "ek", Z "set" … */
const LETTER_ALT: ReadonlyMap<string, readonly string[]> = new Map(Object.entries({
  a: ["e", "ey"], c: ["ce", "ci"], h: ["eich", "eitch", "eits", "ech"], i: ["ay"], j: ["jey"], k: ["ke", "kay", "key"], o: ["ou", "ow"],
  q: ["kyu"], u: ["you"], v: ["fe", "fi"], x: ["ex", "iks", "ek"], y: ["way", "ey"], z: ["zed", "zi", "set"],
}));
const ALPHA = [..."abcdefghijklmnopqrstuvwxyz"];
/** teks ini hanya rangkaian nama huruf (apa adanya, tanpa disamakan: "zet", "elses" = L S S, bukan "jeij")? */
function namesOnly(t: string): boolean {
  const ok = [true];
  for (let i = 1; i <= t.length; i++) ok[i] = RAW_NAMES.some((n) => n.length <= i && ok[i - n.length] && t.startsWith(n, i - n.length));
  return !!ok[t.length];
}
/** ejaan nama huruf disamakan dulu: huruf kembar satu, ph / v = f, ch = c, x = ks, h di ujung dibuang ("vii" = "fi", "ex" = "eks", "beh" = "be") */
function nameNorm(s: string): string {
  const t = squash(s.toLowerCase().replace(/[^a-z]/g, "").replace(/ph/g, "f").replace(/ch/g, "c").replace(/x/g, "ks").replace(/v/g, "f"));
  return t.length > 1 ? t.replace(/h$/, "") : t;
}
/** nama-nama tiap huruf (sudah lewat nameNorm) */
const NAMES: ReadonlyMap<string, readonly string[]> = new Map(
  ALPHA.map((ch) => [ch, [...new Set([LETTER.get(ch), LETTER_EN.get(ch), ...(LETTER_ALT.get(ch) ?? [])].filter((n): n is string => !!n).map(nameNorm))]]),
);
/** nama-nama huruf apa adanya (untuk namesOnly) */
const RAW_NAMES: readonly string[] = [...new Set(ALPHA.flatMap((ch) => [LETTER.get(ch), LETTER_EN.get(ch), ...(LETTER_ALT.get(ch) ?? [])].filter((n): n is string => !!n)))];
/** kerangka nama huruf: huruf matinya + tanda "-" kalau diawali huruf hidup ("es" → "-s" ≠ "se" → "s", "ef" → "-f" ≠ "fe" → "f") */
const nameKey = (n: string) => (/^[aeiou]/.test(n) ? "-" : "") + n.replace(/[aeiou]/g, "");
/** kerangka → huruf pemiliknya. Kerangka milik dua huruf (G "ji" / J "je" → "j", K "ka" / Q "ki" → "k", W "we" / Y "wai" → "w") tidak dipakai */
const KEY_OWNERS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, string[]>();
  NAMES.forEach((ns, ch) =>
    ns.forEach((n) => {
      const o = m.get(nameKey(n)) ?? [];
      if (!o.includes(ch)) m.set(nameKey(n), [...o, ch]);
    }),
  );
  return m;
})();
/**
 * satu kata ucapan = nama huruf / angka ini? Huruf: salah satu namanya (Indonesia / Inggris / ejaan lazim; ejaan disamakan dulu,
 * lihat nameNorm: "fi" = "vi", "ex" = "eks"). Nama huruf LAIN = bukan ("es" untuk C, "ka" untuk Q, "ji" untuk J, "ei" untuk E).
 * Huruf mati juga boleh beda huruf hidupnya ("bee" = "be", "gi" = "ge") asal kerangkanya hanya milik huruf itu — "en" untuk R,
 * "se" untuk S, "ko" untuk K (K / Q) tidak. Angka: kata bilangannya.
 */
function letterOk(c: string, word: string): boolean {
  // tanda aksen jadi huruf dasarnya ("kéi" = "kei", "yú" = "yu"), bukan dibuang
  const raw = word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/\d/.test(c)) return raw === c || (EN_NUM.get(raw) ?? raw) === numbersToWords(c).trim();
  const ch = c.toLowerCase();
  if (raw === ch) return true;
  const names = NAMES.get(ch);
  const t = nameNorm(raw);
  if (!names || !t) return false;
  if (names.includes(t)) return true;
  if (ALPHA.some((o) => o !== ch && NAMES.get(o)?.includes(t)) || /[aeiou]/.test(ch)) return false;
  const k = nameKey(t);
  const own = KEY_OWNERS.get(k);
  return k.replace("-", "") !== "" && !!own && own.length === 1 && own[0] === ch;
}
/** kata ucapan ini angka / kata bilangan? */
const isNumWord = (w: string) => /\d/.test(w) || numWords(w).length > 0;

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
 * Inggris ("IHSG" → "i ha es ge", "GPU" → "ji pi yu", "ChatGPT" → "cet ji pi ti"), kode uang ("IDR" → "rupiah"), singkatan tanpa
 * huruf hidup ("dll" → "dan lain lain", "yg" → "yang"), angka jadi kata yang sama ("MP3" → "em pe tiga", "11%" → "sebelas persen",
 * "10rb" → "sepuluh ribu", "Q3" → "kuartal tiga", "LQ45" → "el kyu empat puluh lima"; juga ditulis lekat: "MP3" → "empetiga",
 * lihat unglue), nama huruf cara Indonesia ("TV" → "ti fi", "XL" → "ek el", "BZ" → "be set").
 * Risiko juga: angka yang diucapkan beda ("11%" → "satu persen") atau satuan / angkanya tidak terucap ("10rb" → "sepuluh", "Q3" →
 * "kuartal", "Rp10rb" → "sepuluh ribu"), huruf singkatan diganti ("BBRI" → "be be en i"), dan kepanjangan singkatan ("OJK" →
 * "omong jual kosong") — kepanjangan tidak bisa dicek dari hurufnya, jadi tidak dicentang otomatis (kecuali mirip ejaan yang sudah
 * dipercaya).
 * `known` = ejaan lain yang sudah dipercaya untuk tulisan yang sama (mis. kamus bawaan Studio) — ejaan yang mirip itu aman.
 * null = aman.
 */
export function lexiconRisk(from: string, to: string, known?: string | null): LexRisk | null {
  // angka tidak terucap sebagai kata terpisah: mungkin ditulis lekat ("MP3" → "empetiga") — dicek versi berspasinya, pesan tetap
  // menyebut ejaan aslinya
  const glued = /\d/.test(from) && !numSeq(to);
  const spaced = glued ? unglue(from, to) : null;
  // bacaan angkanya tidak ketemu, tapi ada kata bilangan lain yang menempel ("MP3" → "empeempat") → angkanya beda, bukan tidak terucap
  if (glued && !spaced && NUM_ANY.test(to.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()))
    return { kind: "number", text: `Angka “${from}” diucapkan “${to}” — angkanya beda dari tulisannya. Subtitle tetap “${from}”.` };
  return riskOf(from, spaced ?? to, known, to);
}
function riskOf(from: string, to: string, known: string | null | undefined, shown: string): LexRisk | null {
  // ejaan yang cuma menandai bunyi huruf e (bareng → barêng / barəng / bar'ng, sekarang → skarang) = kata yang sama
  if (isPepetSpelling(from, to)) return null;
  const words = from.split(/[\s-]+/).filter(Boolean);
  const target = soundKey(to);
  if (!words.length || !target) return null;
  const acro = (w: string) => isAcronym(w) || (/^[\p{L}\d]+$/u.test(w) && !/[aeiouy]/i.test(w.replace(/\d/g, "")) && /\p{L}/u.test(w));
  const hasAcro = words.some(acro);
  const one = words.length === 1 ? words[0] : "";
  const toWords = to.toLowerCase().split(/[\s-]+/).filter(Boolean);
  // kata umum: bunyinya berubah sedikit pun (selain ragam lisan nggak = gak) → kata lain ("halal" → "haram", "naik" → "anjlok")
  if (one && COMMON.has(one.toLowerCase()) && soundKey(one) !== target && soundKey(enReading(one)) !== target)
    return { kind: "common", text: `Kata umum “${from}” diucapkan “${shown}” — artinya bisa berubah. Subtitle tetap “${from}”.` };
  // kode uang dibaca nama uangnya
  if (one && (CURRENCY.get(one.toLowerCase()) ?? []).includes(toWords.join(" "))) return null;
  // kata ucapan (huruf kecil) tanpa tanda baca ("sepuluh," → "sepuluh")
  const tw = toWords.map((w) => w.replace(/[^\p{L}\d]/gu, "")).filter(Boolean);
  // angka: ucapan harus membaca angka yang sama — utuh ("11%" → "sebelas persen", "LQ45" → "el kyu empat puluh lima"), per digit
  // ("MP3" → "em pe tiga"), atau angka + satuannya ("10rb" → "sepuluh ribu"). Mengubah isinya walau bunyinya mirip: angka lain
  // ("11%" → "satu persen", "10rb" → "sepuluh juta"), satuan dibuang ("10rb" → "sepuluh"), angka dibuang ("Q3" → "kuartal").
  if (/\d/.test(from)) {
    const no = (why: string): LexRisk => ({ kind: "number", text: `Angka “${from}” diucapkan “${shown}” — ${why}. Subtitle tetap “${from}”.` });
    const said = numSeq(to);
    if (!said) return no("angkanya tidak terucap");
    // satuan sesudah angka ("10rb", "5 jt", "2M", "1,5x"); yang berupa kata bilangan ("10 ribu") sudah terbaca bersama angkanya,
    // "kali" (bukan kata bilangan) dicari di ucapan
    const unitTxt = /^(?:rp\.?\s*)?\d[\d.,]*\s*(\p{L}+)$/iu.exec(from.trim())?.[1] ?? "";
    const unit = NUM_UNIT.get(unitTxt.toLowerCase()) ?? [];
    let unitSaid = !unit.length || numWords(unitTxt).length > 0 || unit.some((u) => !NUM_WORDS.has(u) && tw.includes(u));
    // "Rp" yang ikut ditulis di ejaan dibaca "rupiah" ("Rp10rb" → "Rp 10 ribu")
    const rupiah = tw.includes("rupiah") || tw.includes("rp");
    let same = false;
    // tulisan apa adanya, per digit, dan angka utuh dipisah dari huruf di kiri / kanannya ("10rb" → "10 rb", "LQ45" → "LQ 45")
    for (const r of [from, from.replace(/(\d)/g, " $1 "), from.replace(/(\d)(?=\p{L})/gu, "$1 ").replace(/(\p{L})(?=\d)/gu, "$1 ")]) {
      const c = numSeq(r);
      if (!c) continue;
      if (c === said) same = true;
      else if (unit.some((u) => said === `${c} ${u}`)) same = unitSaid = true;
    }
    if (!same) return no("angkanya beda dari tulisannya");
    // satuan tidak terucap sebagai kata: boleh dieja per huruf ("4K" → "for kei"), selain itu nilainya berubah ("10rb" → "sepuluh")
    // satuan huruf kecil m / t / k juga satuan ukuran / waktu ("5m" → "lima meter", "30m" → "tiga puluh menit", "1t" → "satu ton",
    // "10k" → "sepuluh kilo"): satu kata, dari daftar MEASURE
    if (!unitSaid) {
      const rest = tw.filter((w) => !isNumWord(w) && w !== "rupiah" && w !== "rp");
      const ls = [...unitTxt];
      const measure = rest.length === 1 && !!MEASURE.get(unitTxt)?.includes(rest[0]);
      if (!measure && (rest.length !== ls.length || !ls.every((c, i) => letterOk(c, rest[i])))) return no(`satuannya (“${unitTxt}”) tidak terucap, nilainya beda dari tulisannya`);
    }
    if (/^rp\.?\s*\d/i.test(from.trim()) && !rupiah) return no("mata uangnya (rupiah) tidak terucap");
    // isinya hanya angka (+ Rp / % / satuan / "Q" = kuartal) dan angkanya sama → aman
    const bare = from.toLowerCase().replace(/^rp\.?\s*(?=\d)/, "").replace(/[\d.,:/%\s]/g, "");
    if (!bare || unit.length || (bare === "q" && /^(kuartal|kwartal|kuarter|quarter)$/.test(tw[0] ?? ""))) return null;
  }
  const knownKey = known ? soundKey(known) : "";
  const nearKnown = !!knownKey && editDistance(knownKey, target) / Math.max(knownKey.length, target.length) <= 0.34;
  // singkatan dieja per huruf: tiap kata ucapan = nama huruf yang sama (Indonesia / Inggris), angka di tempatnya (sudah dicek di
  // atas: "LQ45" → "el kyu" + "empat puluh lima"). Huruf yang diganti ("BBRI" → "be be en i") atau kepanjangan ("OJK" → "omong
  // jual kosong", tidak bisa dicek dari hurufnya) = risiko, kecuali mirip ejaan tepercaya.
  if (one && acro(one)) {
    const chars = [...one].filter((c) => /[\p{L}\d]/u.test(c));
    // urutan huruf / angka harus sama (deret angka dihitung satu: "LQ45" = "aa9" = "el kyu empat puluh lima")
    const shape = (xs: readonly string[], num: (x: string) => boolean) => xs.map((x) => (num(x) ? "9" : "a")).join("").replace(/9+/g, "9");
    if (shape(chars, (c) => /\d/.test(c)) === shape(tw, isNumWord)) {
      const ls = chars.filter((c) => !/\d/.test(c));
      const ws = tw.filter((w) => !isNumWord(w));
      if (ls.every((c, i) => letterOk(c, ws[i]))) return null;
      if (isAcronym(one) && !nearKnown) {
        // kata ucapan yang nama huruf LAIN ("BBRI" → "be be en i") = huruf diganti, walau huruf depannya kebetulan sama ("SK" → "se ka")
        const swapped = ls.some((c, i) => !letterOk(c, ws[i]) && ALPHA.some((o) => o !== c.toLowerCase() && letterOk(o, ws[i])));
        return !swapped && ws.every((x, i) => x[0] === ls[i].toLowerCase())
          ? { kind: "acronym", text: `Singkatan “${from}” diucapkan kepanjangannya “${shown}” — pastikan kepanjangannya benar. Subtitle tetap “${from}”.` }
          : { kind: "acronym", text: `Singkatan “${from}” diucapkan “${shown}” — hurufnya beda dari tulisannya. Subtitle tetap “${from}”.` };
      }
    }
  }
  // bacaan yang wajar untuk tulisan ini: apa adanya, cara baca Inggris, singkatan per huruf (Indonesia / Inggris), angka jadi kata
  // (per digit, atau utuh: "2026" → "dua ribu dua puluh enam")
  const reading = (letters: ReadonlyMap<string, string> | null, en = false, whole = false, ws: readonly string[] = words) =>
    soundKey(
      ws
        .map((w) => {
          const n = /\d/.test(w) ? numbersToWords(whole ? w : w.replace(/(\d)/g, " $1 ")) : w;
          if (letters && acro(w)) return [...n].map((c) => (/[a-z]/i.test(c) ? letters.get(c.toLowerCase()) ?? c : c)).join(" ");
          return en && !acro(w) && !/\d/.test(w) ? enReading(w) : n;
        })
        .join(" "),
    );
  // nama gabungan berhuruf besar di tengah ("ChatGPT" → "Chat" + "GPT" → "cet ji pi ti"): tiap bagian dibaca sendiri
  const parts = words.flatMap((w) => w.replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2").split(" "));
  const camel = parts.length > words.length && parts.some(acro) ? [reading(LETTER, true, false, parts), reading(LETTER_EN, true, false, parts)] : [];
  const cands = [reading(null), reading(null, true), ...(/\d/.test(from) ? [reading(null, false, true)] : []), ...(hasAcro ? [reading(LETTER), reading(LETTER_EN)] : []), ...camel].filter(Boolean);
  // angka cara baca Inggris / lisan di ejaan dibandingkan sebagai angka Indonesia ("GPT-4" → "ji pi ti for" ≈ "ji pi ti empat",
  // "2-0" → "dua kosong" = "dua nol")
  const said = /\d/.test(from) ? soundKey(toWords.map((x) => (x === "kosong" ? "nol" : (EN_NUM.get(x) ?? x))).join(" ")) : target;
  const ratio = Math.min(...cands.map((c) => editDistance(c, said) / Math.max(c.length, said.length)));
  // singkatan tanpa huruf hidup ("dll", "yg", "tdk"): huruf-hurufnya muncul berurutan di ejaannya, huruf pertama sama
  const abbrev = !!one && !isAcronym(one) && acro(one) && target[0] === soundKey(one)[0] && isSubsequence(soundKey(one), target);
  if (nearKnown || abbrev || ratio <= (hasAcro ? 0.34 : 0.5)) return null;
  return hasAcro && one
    ? { kind: "acronym", text: `Singkatan “${from}” diucapkan “${shown}” — bunyinya beda dari hurufnya. Subtitle tetap “${from}”.` }
    : { kind: "word", text: `“${from}” diucapkan “${shown}” — bunyinya jauh dari tulisannya, bisa jadi kata lain. Subtitle tetap “${from}”.` };
}
