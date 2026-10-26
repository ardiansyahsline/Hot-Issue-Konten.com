/**
 * UCAPAN VO bahasa Indonesia: teks yang dikirim ke mesin suara (Edge cadangan / bank suara di laptop) dibentuk DI SINI,
 * di browser, supaya hasilnya sama untuk semua mesin dan tidak butuh update laptop (voice-worker cukup membaca `spell`).
 *
 * Urutan: ejaan khusus adegan (`vo.spell`, kalau ada) atau teks VO → kamus ejaan (bawaan + milik proyek, per kata utuh,
 * tidak peka huruf besar) → angka jadi kata (16.800 → enam belas ribu delapan ratus, 2,5% → dua koma lima persen)
 * → tanda hubung di antara huruf jadi spasi (strip sering dibaca aneh / jadi jeda oleh mesin suara).
 * Teks subtitle (`vo.text`) TIDAK pernah diubah.
 *
 * Ejaan khusus adegan tetap menang: kata yang sengaja dieja ulang di `vo.spell` (tidak ada di teks VO) tidak disentuh kamus;
 * hasil kamus yang sudah tertulis (mis. "ei ai") juga tidak dieja dua kali.
 * Modul ini tanpa import supaya aman dipakai timeline.ts, server, maupun browser.
 */

export type LexEntry = { from: string; to: string };

/** batas kamus milik proyek (disimpan di timeline.voice.lexicon) */
export const MAX_LEXICON = 60;
export const LEX_FROM_MAX = 40;
export const LEX_TO_MAX = 80;
/**
 * batas teks ucapan akhir (`spell` yang dikirim ke /api/studio/tts & job bank suara). Angka jadi kata bisa memanjangkan VO
 * maksimal (400 huruf) sampai ±3.300 huruf (deret "7.777.777.777.777"), jadi 4.000 cukup untuk semua angka + kamus bawaan;
 * yang lewat hanya kamus proyek yang mengeja kata pendek jadi sangat panjang → ditolak dengan pesan jelas (tidak dipotong diam-diam).
 * Sama dengan SPELL_MAX di voice-worker/studio_worker/jobs_tts.py.
 */
export const SPELL_MAX = 4000;

/** kamus bawaan: istilah asing / singkatan yang sering salah dibaca mesin suara Indonesia → cara baca orang Indonesia */
export const DEFAULT_LEXICON: readonly LexEntry[] = [
  { from: "CS Tracker", to: "si es treker" },
  { from: "Konten.com", to: "konten dot kom" },
  { from: "hot issue", to: "hot isyu" },
  { from: "issue", to: "isyu" },
  { from: "real-time", to: "ril taim" },
  { from: "review", to: "riviu" },
  { from: "ranking", to: "rengking" },
  { from: "download", to: "daunlod" },
  { from: "upload", to: "aplod" },
  { from: "update", to: "apdet" },
  { from: "upgrade", to: "apgred" },
  { from: "PPT", to: "pepete" },
  { from: "AI", to: "ei ai" },
  { from: "CS", to: "si es" },
  { from: "tracker", to: "treker" },
  { from: "TikTok", to: "tiktok" },
  { from: "YouTube", to: "yutub" },
  { from: "WhatsApp", to: "wasap" },
  { from: "WA", to: "we a" },
  { from: "IG", to: "i ge" },
  { from: "TWS", to: "te we es" },
  { from: "MSCI", to: "em es si ai" },
  { from: "IHSG", to: "i ha es ge" },
  { from: "MBTI", to: "em be te i" },
  { from: "PDF", to: "pe de ef" },
  { from: "HP", to: "ha pe" },
  { from: "CEO", to: "si i o" },
  { from: "VO", to: "vi o" },
  { from: "SFX", to: "es ef eks" },
  { from: "OK", to: "oke" },
  { from: "e-mail", to: "imel" },
  { from: "online", to: "onlain" },
  { from: "offline", to: "oflain" },
  { from: "website", to: "websait" },
  { from: "dashboard", to: "desbor" },
  { from: "chat", to: "cet" },
  { from: "feedback", to: "fidbek" },
  { from: "deadline", to: "dedlain" },
  { from: "meeting", to: "miting" },
  { from: "share", to: "syer" },
  { from: "follow", to: "folo" },
  { from: "like", to: "laik" },
  { from: "reels", to: "rils" },
  { from: "shorts", to: "syorts" },
  { from: "trailer", to: "treler" },
  { from: "teaser", to: "tiser" },
  { from: "template", to: "templet" },
  { from: "team", to: "tim" },
  { from: "content", to: "konten" },
  { from: "creator", to: "kreator" },
  { from: "insight", to: "insait" },
  { from: "brand", to: "brend" },
  { from: "event", to: "ivent" },
  { from: "crypto", to: "kripto" },
  { from: "Bitcoin", to: "bitkoin" },
  { from: "trading", to: "treding" },
  { from: "trader", to: "treder" },
  { from: "software", to: "sofwer" },
  { from: "podcast", to: "podkes" },
  { from: "SVG", to: "es ve ge" },
  { from: "PNG", to: "pe en ge" },
  { from: "JPG", to: "je pe ge" },
  { from: "MP3", to: "em pe tiga" },
  { from: "MP4", to: "em pe empat" },
  { from: "BPM", to: "be pe em" },
  // API hanya kalau ditulis kapital (lihat CAPS_ONLY: "api" = api unggun). UI sengaja tidak ada: "ui" = seruan, UI = Universitas
  // Indonesia ("u i") — kalau maksudnya user interface, tambahkan sendiri di 📖 Kamus ejaan proyek.
  { from: "API", to: "a pe i" },
  { from: "UX", to: "yu eks" },
  { from: "KPI", to: "ka pe i" },
  { from: "SEO", to: "es i o" },
  { from: "ROI", to: "er o i" },
  { from: "OJK", to: "o je ka" },
  { from: "IPO", to: "i pe o" },
  { from: "GPU", to: "ji pi yu" },
  { from: "CPU", to: "si pi yu" },
  { from: "DM", to: "di em" },
  { from: "voice over", to: "vois over" },
  { from: "live", to: "laif" },
  { from: "streaming", to: "striming" },
  { from: "story", to: "stori" },
  { from: "caption", to: "kepsyen" },
  { from: "thumbnail", to: "tambnel" },
  { from: "slide", to: "slaid" },
  { from: "preview", to: "priviu" },
  { from: "subtitle", to: "sabtaitel" },
  { from: "workflow", to: "werkflo" },
  { from: "followers", to: "folowers" },
  { from: "viewers", to: "viuwers" },
  { from: "vs", to: "versus" },
  { from: "dll", to: "dan lain lain" },
  { from: "dsb", to: "dan sebagainya" },
];

/**
 * Ejaan teaser CS Tracker versi lama (pakai tanda hubung) → versi baru tanpa strip. Dipakai normalizeTimeline supaya proyek
 * teaser yang tersimpan sebelum perbaikan ikut memakai ejaan baru (hanya kalau kalimatnya persis sama dengan versi lama).
 */
const LEGACY_TEASER_SPELL: ReadonlyMap<string, string> = new Map(Object.entries({
  "Hot isyu numpuk… chat tim berantakan…": "Hot isyu numpuk… cet tim berantakan…",
  "Kenalin. Si-es Treker.": "Kenalin. Si es treker.",
  "Semua hot isyu langsung ke-renking otomatis. Yang paling panas, paling atas.": "Semua hot isyu langsung kerengking otomatis. Yang paling panas, paling atas.",
  "Ngobrol bareng tim, ril-taim. Satu tempat, nggak ada yang kelewat.": "Ngobrol bareng tim, ril taim. Satu tempat, nggak ada yang kelewat.",
  "Tanya E-ai soal hot isyu, saham, sampai kripto. Dia mikir dulu… bahkan nanya balik, biar jawabannya pas.":
    "Tanya ei ai soal hot isyu, saham, sampai kripto. Dia mikir dulu… bahkan nanya balik, biar jawabannya pas.",
  "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal daun-lod.": "Butuh konten berita? Sekali ketik… langsung jadi. Tinggal daunlod.",
  "Mau E-ai yang ngerti gaya kamu? Latih versimu sendiri.": "Mau ei ai yang ngerti gaya kamu? Latih versimu sendiri.",
  "Plus musik, laporan, sampai pe-pe-te.": "Plus musik, laporan, sampai pepete.",
  "Si-es Treker. Kerja lebih cepat… bareng-bareng.": "Si es treker. Kerja lebih cepat… bareng bareng.",
}));
/** Map (bukan objek biasa): ejaan "constructor" / "__proto__" / "toString" dari data proyek / AI tetap teks apa adanya */
export const upgradeTeaserSpell = (spell: string): string => LEGACY_TEASER_SPELL.get(spell) ?? spell;

// ---------------------------------------------------------------------------------------------
// util
// ---------------------------------------------------------------------------------------------
const tidy = (s: unknown) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "");
// \p{…} lewat new RegExp (target TS ES2017 tidak mengizinkan property escape di literal regex)
const W = "\\p{L}\\p{N}";
const SPLIT = new RegExp(`[^${W}]+`, "u");
/** batas kata untuk kamus: huruf, angka & apostrof ("Wa'alaikum" bukan kata "WA") */
const B = `${W}'’`;
const tokens = (s: string) => s.toLowerCase().split(SPLIT).filter(Boolean);
/** kunci pencocokan: huruf kecil, spasi & strip diabaikan ("Real time" = "real-time" = "realtime") */
const keyOf = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** penanda (Private Use Area) bagian teks hasil kamus / angka — dilindungi dari bunyi luncur mesin bank, dibuang sebelum dikirim */
const MK0 = "\uE000";
const MK1 = "\uE001";
const MKS = /[\uE000\uE001]/g;
/** FNV-1a 32 bit → 8 hex (kunci pendek teks ucapan, disimpan di VoLine.say) */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** bersihkan kamus milik proyek: {from,to} terisi, tanpa karakter aneh, dibatasi panjang & jumlahnya, kata dobel → yang pertama */
export function normLexicon(raw: unknown): LexEntry[] {
  const clean = (v: unknown, max: number) =>
    tidy(typeof v === "string" ? v : typeof v === "number" ? String(v) : "")
      .replace(/[<>{}\\`\u0000-\u001f]/g, "")
      .slice(0, max)
      .trim();
  const seen = new Set<string>();
  const out: LexEntry[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const from = clean(o.from, LEX_FROM_MAX);
    const to = clean(o.to, LEX_TO_MAX);
    const k = keyOf(from);
    if (!from || !to || !tokens(from).length || !tokens(to).length || seen.has(k)) continue;
    seen.add(k);
    out.push({ from, to });
    if (out.length >= MAX_LEXICON) break;
  }
  return out;
}

/** kamus yang dipakai: bawaan + milik proyek (kata yang sama di kamus proyek mengganti ejaan bawaan) */
export function lexiconOf(user?: readonly LexEntry[] | null): LexEntry[] {
  const mine = normLexicon(user ?? []);
  const own = new Set(mine.map((e) => keyOf(e.from)));
  return [...DEFAULT_LEXICON.filter((e) => !own.has(keyOf(e.from))), ...mine];
}

/**
 * singkatan yang huruf kecilnya kata Indonesia biasa: entri kamus yang ditulis kapital ("API", "ROI") hanya mengganti kata yang
 * juga ditulis kapital — "api unggun", "berapi-api", "Api kecil" tetap dibaca biasa (Edge maupun bank).
 */
const CAPS_ONLY: ReadonlySet<string> = new Set(["api", "roi"]);
const allCaps = (s: string) => {
  const l = s.replace(/[^\p{L}]/gu, "");
  return l.length >= 2 && l === l.toUpperCase() && l !== l.toLowerCase();
};

// ---------------------------------------------------------------------------------------------
// kamus ejaan
// ---------------------------------------------------------------------------------------------
/** imbuhan yang sering ditempel pakai strip ke kata asing: "di-upload", "ke-ranking", "AI-nya" → disambung tanpa strip */
const PRE = "ke|di|se|ter|ber|me|pe|nge|ng";
const SUF = "nya|in|an|kan|lah|kah|pun|ku|mu";
/**
 * imbuhan yang juga lazim ditulis TANPA strip: "diupload", "PPTnya", "AInya", "HPku". Hanya untuk kata kamus yang ditulis sebagai
 * singkatan kapital ("PPT", "AI") atau kata kamus ≥ 4 huruf ("upload") — "ainya" / "wanya" huruf kecil tidak dianggap singkatan.
 */
const PRE2 = "di|ke";
const SUF2 = "nya|mu|ku";
/** kata kamus boleh ditempeli imbuhan tanpa strip: ditulis kapital semua (≥ 2 huruf) atau panjangnya ≥ 4 huruf */
const glueOk = (core: string) => {
  const k = keyOf(core);
  return k.length >= 4 || (k.length >= 2 && core === core.toUpperCase() && core !== core.toLowerCase());
};

type Compiled = { re: RegExp; map: Map<string, string | null>; caps: Set<string> };
const cache = new Map<string, Compiled | null>();

function compile(entries: readonly LexEntry[]): Compiled | null {
  const sig = JSON.stringify(entries);
  if (cache.has(sig)) return cache.get(sig) ?? null;
  // kunci → ejaan pengganti; null = hasil ejaan yang sudah tertulis (dibiarkan, supaya tidak dieja dua kali)
  const map = new Map<string, string | null>();
  for (const e of entries) map.set(keyOf(e.from), e.to);
  for (const e of entries) if (!map.has(keyOf(e.to))) map.set(keyOf(e.to), null);
  const caps = new Set(entries.filter((e) => CAPS_ONLY.has(keyOf(e.from)) && allCaps(e.from)).map((e) => keyOf(e.from)));
  const pats = new Map<string, number>();
  for (const s of entries.flatMap((e) => [e.from, e.to])) {
    const parts = s.split(/[\s-]+/).filter(Boolean);
    if (!parts.length) continue;
    const p = parts.map(esc).join("[\\s-]*");
    pats.set(p, Math.max(pats.get(p) ?? 0, s.length));
  }
  // yang terpanjang dicoba dulu ("CS Tracker" sebelum "CS", "ei ai" sebelum "ai"); awalan dicoba paling akhir (`??`) supaya
  // kata kamus utuh yang kebetulan berawalan di/ke tetap cocok utuh
  const alts = [...pats.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).map(([p]) => p);
  const out = alts.length
    ? { re: new RegExp(`(^|[^${B}])(?:(${PRE})-|(${PRE2}))??(${alts.join("|")})(?:-(${SUF})|(${SUF2}))?(?![${B}])`, "giu"), map, caps }
    : null;
  cache.set(sig, out);
  if (cache.size > 20) cache.delete(cache.keys().next().value as string);
  return out;
}

/**
 * Ganti kata/frasa sesuai kamus: per kata utuh, tidak peka huruf besar, sekali jalan (hasil ejaan tidak diganti lagi).
 * `keep` = kata (huruf kecil) yang tidak boleh disentuh (ejaan khusus adegan). Tanda baca, angka & kata lain tetap.
 */
export function applyLexicon(text: string, entries: readonly LexEntry[], keep?: ReadonlySet<string>, mark = false): string {
  const c = compile(entries);
  if (!c || !text) return text;
  const [m0, m1] = mark ? [MK0, MK1] : ["", ""];
  return text.replace(c.re, (m: string, b: string, preDash: string | undefined, preGlue: string | undefined, core: string, sufDash: string | undefined, sufGlue: string | undefined) => {
    const to = c.map.get(keyOf(core));
    // hasil ejaan yang sudah tertulis (mis. "ei ai") juga dilindungi dari bunyi luncur mesin bank
    if (!to) return mark ? `${b}${m0}${m.slice(b.length)}${m1}` : m;
    // "api" (bukan "API") → kata biasa, bukan singkatan
    if (c.caps.has(keyOf(core)) && !allCaps(core)) return m;
    if (keep?.size && tokens(core).some((t) => keep.has(t))) return m;
    // imbuhan tanpa strip hanya untuk singkatan kapital / kata kamus panjang (lihat glueOk) — selain itu kata utuhnya dibiarkan
    if ((preGlue || sufGlue) && !glueOk(core)) return m;
    const pre = preDash ?? preGlue;
    const suf = sufDash ?? sufGlue;
    // "Hot issue" → "Hot isyu" (huruf besar di awal ikut); singkatan kapital ("AI") tetap ejaan apa adanya
    const cap = !pre && core[0] !== core[0].toLowerCase() && core !== core.toUpperCase();
    return `${b}${m0}${pre ?? ""}${cap ? to[0].toUpperCase() + to.slice(1) : to}${suf ?? ""}${m1}`;
  });
}

// ---------------------------------------------------------------------------------------------
// angka → kata
// ---------------------------------------------------------------------------------------------
const SAT = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];

/** 0..999 triliun → kata bahasa Indonesia (sama dengan terbilang di voice-worker/studio_worker/text.py) */
export function terbilang(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  n = Math.floor(n);
  if (n < 0) return `minus ${terbilang(-n)}`;
  if (n < 12) return SAT[n];
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh${n % 10 ? ` ${terbilang(n % 10)}` : ""}`;
  if (n < 200) return `seratus${n > 100 ? ` ${terbilang(n - 100)}` : ""}`;
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus${n % 100 ? ` ${terbilang(n % 100)}` : ""}`;
  if (n < 2000) return `seribu${n > 1000 ? ` ${terbilang(n - 1000)}` : ""}`;
  for (const [div, name] of [
    [1e12, "triliun"],
    [1e9, "miliar"],
    [1e6, "juta"],
    [1e3, "ribu"],
  ] as const)
    if (n >= div) return `${terbilang(Math.floor(n / div))} ${name}${n % div ? ` ${terbilang(n % div)}` : ""}`;
  return String(n);
}

const digits = (s: string) => [...s].map((d) => SAT[Number(d)] ?? d).join(" ");
/** bilangan bulat: nomor berawalan 0 (0812…) / sangat panjang dibaca per angka */
const readInt = (s: string) => (s.length > 15 || (s.length > 1 && s[0] === "0") ? digits(s) : terbilang(Number(s)));

// jam "10:30" / "pukul 10.30" (titik tanpa pukul/jam dibiarkan: bisa desimal gaya Inggris)
const TIME = new RegExp(`(^|[^${W}.,:])((?:pukul|jam)\\s+)?(\\d{1,2})([:.])(\\d{2})(?![${W}]|[.,:]\\d)`, "giu");
// bilangan berdiri sendiri (tidak menempel huruf: "5G", "MSCI2" dibiarkan): 16.800 · 2,5 · 2025 · Rp16.800 · 30% · ke-3
const NUM = new RegExp(`(^|[^${W}.,])(ke-)?(rp\\.?\\s?)?(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)(\\s?%)?(?![${W}]|[.,]\\d)`, "giu");

/** angka di teks ucapan → kata bahasa Indonesia; angka yang menempel huruf, kode, & format ragu-ragu dibiarkan */
export function numbersToWords(text: string, mark = false): string {
  if (!/\d/.test(text)) return text;
  const [m0, m1] = mark ? [MK0, MK1] : ["", ""];
  const t = text.replace(TIME, (m: string, b: string, pk: string | undefined, h: string, sep: string, mm: string) => {
    const H = Number(h);
    const M = Number(mm);
    if ((sep === "." && !pk) || H > 24 || M > 59) return m;
    return `${b}${pk ?? ""}${m0}${terbilang(H)}${M ? ` ${M < 10 ? "lewat " : ""}${terbilang(M)}` : ""}${m1}`;
  });
  return t.replace(NUM, (m: string, b: string, ord: string | undefined, rp: string | undefined, num: string, pct: string | undefined) => {
    const [int, dec] = num.split(",");
    const intDigits = int.replace(/\./g, "");
    if (intDigits.length > 15 && !dec) return `${b}${m0}${ord ?? ""}${rp ?? ""}${digits(intDigits)}${pct ? " persen" : ""}${m1}`;
    let w = readInt(intDigits) + (dec ? ` koma ${digits(dec)}` : "");
    if (ord) w = `${ord.slice(0, 2)}${w}`;
    if (pct) w += " persen";
    if (rp) w += " rupiah";
    return `${b}${m0}${w}${m1}`;
  });
}

// ---------------------------------------------------------------------------------------------
// bunyi luncur (khusus mesin bank / Chatterbox)
// ---------------------------------------------------------------------------------------------
/**
 * Mesin bank (Chatterbox, dasar bahasa Inggris) sering melebur / memecah deret vokal Indonesia ("soal" → "su ul" / "soul").
 * Orang Indonesia mengucapkannya dengan bunyi luncur, jadi ditulis eksplisit: u/o + vokal → w (soal → sowal, buat → buwat,
 * uang → uwang), i + vokal → y (dia → diya, biar → biyar, Indonesia → Indonesiya).
 * Tidak diubah: diftong ai / au / oi / ei (pantai, pulau, amboi, survei — termasuk u/i yang jadi bagian diftong), vokal kembar
 * (maaf, koordinasi), "ou" & "qu", kata berangka, singkatan kapital (OJK), kata bergaya Inggris (th/sh/ch/ph/ck, akhiran -tion/-sion, x/q…).
 */
const VOW = "aeiou";
const ENGLISH = /th|sh|ch|ph|ck|[ts]ions?$|[xq]|w[^aeiouy]|[^aeiou]y$/i;
export function glideWord(w: string): string {
  if (w.length < 2 || /\d/.test(w) || ENGLISH.test(w)) return w;
  const letters = w.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return w;
  // nama merek berhuruf besar di tengah (iOS, eSport, camelCase) dibiarkan
  if (/\p{Ll}\p{Lu}/u.test(w)) return w;
  const lo = w.toLowerCase();
  let out = "";
  for (let i = 0; i < w.length; i++) {
    out += w[i];
    const c = lo[i];
    const n = lo[i + 1];
    const p = lo[i - 1];
    if (!n || !VOW.includes(n) || c === n) continue;
    const up = w[i + 1] !== n;
    if (c === "u" || c === "o") {
      // diftong oi, "ou", u bagian diftong au ("kauan"), "qu"
      if ((c === "o" && (n === "i" || n === "u")) || (c === "u" && (p === "a" || p === "q"))) continue;
      out += up ? "W" : "w";
    } else if (c === "i") {
      // i bagian diftong ai / ei / oi ("pantaian")
      if (p === "a" || p === "e" || p === "o") continue;
      out += up ? "Y" : "y";
    }
  }
  return out;
}
const WORD = new RegExp(`[${W}]+`, "gu");
/** bunyi luncur untuk semua kata di luar bagian bertanda (hasil kamus / angka) & kata `skip` (ejaan khusus adegan) */
function glideText(s: string, skip?: ReadonlySet<string>): string {
  let out = "";
  let depth = 0;
  let buf = "";
  const flush = () => {
    out += depth ? buf : buf.replace(WORD, (m) => (skip?.has(m.toLowerCase()) ? m : glideWord(m)));
    buf = "";
  };
  for (const ch of s) {
    if (ch === MK0 || ch === MK1) {
      flush();
      depth = Math.max(0, depth + (ch === MK0 ? 1 : -1));
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------
// teks ucapan akhir
// ---------------------------------------------------------------------------------------------
// penanda bagian kamus / angka (mesin bank) boleh menempel di kiri / kanan strip
const HYPHEN = new RegExp(`(\\p{L}[\\uE000\\uE001]*)-(?=[\\uE000\\uE001]*\\p{L})`, "gu");
/** mesin suara tujuan: "bank" = Chatterbox di laptop (pakai bunyi luncur); selain itu (Edge / premium) teks ucapan biasa */
export type SpeechEngine = "bank" | "edge" | "elevenlabs";

/**
 * Teks yang dibaca mesin suara untuk satu kalimat VO: `spell` (kalau ada) atau `text`, lalu kamus ejaan (bawaan + `lexicon`
 * proyek), angka → kata, dan strip di antara huruf → spasi. Kata yang sengaja dieja ulang di `spell` tidak disentuh kamus.
 * `engine` "bank" → ditambah bunyi luncur (glideWord) di kata biasa; hasil kamus, angka & ejaan khusus adegan tidak disentuh.
 */
export function speakText(text: string, spell?: string | null, lexicon?: readonly LexEntry[] | null, engine?: SpeechEngine): string {
  const t = tidy(text);
  const sp = tidy(spell);
  const base = sp || t;
  if (!base) return "";
  let keep: Set<string> | undefined;
  if (sp) {
    const inText = new Set(tokens(t));
    keep = new Set(tokens(sp).filter((x) => !inText.has(x)));
  }
  const bank = engine === "bank";
  let s = applyLexicon(base, lexiconOf(lexicon), keep, bank);
  s = numbersToWords(s, bank);
  s = s.replace(HYPHEN, "$1 ");
  if (bank) s = glideText(s, keep).replace(MKS, "");
  return tidy(s);
}

type VoLike = { text: string; spell?: string | null } | null | undefined;

/**
 * Isi yang dikirim ke mesin suara untuk VO adegan: `text` (subtitle, apa adanya) + `spell` = teks ucapan akhir
 * (null kalau sama dengan teks). Dipakai Edge (/api/studio/tts) & job bank suara (laptop, `engine` "bank" = + bunyi luncur),
 * juga untuk cek naskah berubah.
 */
export function voSpeech(vo: VoLike, lexicon?: readonly LexEntry[] | null, engine?: SpeechEngine): { text: string; spell: string | null } | null {
  if (!vo?.text) return null;
  const say = speakText(vo.text, vo.spell, lexicon, engine);
  return { text: vo.text, spell: say && say !== vo.text ? say : null };
}

/**
 * kunci VoLine.say untuk suara yang dibuat SEBELUM ada teks ucapan (kamus ejaan, baris tanpa `say`): mesin suara dulu menerima
 * `spell || text` apa adanya. Sama dengan voSayKey kalau teks ucapan sekarang sama persis dengan yang dulu dikirim.
 */
export function legacySayKey(text: string, spell?: string | null): string {
  const t = typeof text === "string" ? text : "";
  if (!t) return "";
  const raw = tidy(spell) || t;
  return fnv(`${t}\u0001${raw === t ? "" : raw}`);
}

/** kunci pendek (8 hex) dari teks + teks ucapan akhir — VoLine.say; beda = suara dibuat dari naskah / ejaan lama */
export function voSayKey(vo: VoLike, lexicon?: readonly LexEntry[] | null): string {
  const p = voSpeech(vo, lexicon);
  return p ? fnv(`${p.text}\u0001${p.spell ?? ""}`) : "";
}

/** isi yang dikirim sama persis (teks & teks ucapan) */
export const sameSpeech = (a: { text: string; spell?: string | null } | null | undefined, b: { text: string; spell?: string | null } | null | undefined): boolean =>
  !!a && !!b && a.text === b.text && (a.spell || "") === (b.spell || "");
