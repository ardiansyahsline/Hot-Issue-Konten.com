/**
 * Deteksi chart pattern otomatis dari candle (mirip indikator "Auto Chart Patterns"): wedge, triangle, channel,
 * rectangle, broadening, double top/bottom, head & shoulders (+ inverse), bull/bear flag.
 * Dipakai di server (data untuk AI) dan di browser (digambar di chart). Waktu = unix detik.
 */
export type Bar = { time: number; open: number; high: number; low: number; close: number };
export type Pt = [number, number]; // [waktu, harga]
export type DetectedPattern = {
  name: string;
  bias: "bullish" | "bearish" | "netral";
  /** makin tinggi makin meyakinkan (jumlah sentuhan, kerapian garis) */
  score: number;
  /** garis pola (mis. garis atas & bawah wedge, neckline) — tiap garis 2 titik */
  lines: [Pt, Pt][];
  /** titik penting (puncak / lembah) */
  points: Pt[];
  note: string;
};

type Piv = { i: number; p: number };

const atrOf = (c: Bar[], n = 14) => {
  const s = c.slice(-n - 1);
  let sum = 0;
  for (let i = 1; i < s.length; i++) sum += Math.max(s[i].high - s[i].low, Math.abs(s[i].high - s[i - 1].close), Math.abs(s[i].low - s[i - 1].close));
  return sum / Math.max(1, s.length - 1) || (c[c.length - 1]?.close ?? 1) * 0.01;
};

function pivots(c: Bar[], k: number): { hi: Piv[]; lo: Piv[] } {
  const hi: Piv[] = [];
  const lo: Piv[] = [];
  for (let i = k; i < c.length - k; i++) {
    let isH = true;
    let isL = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (c[j].high > c[i].high) isH = false;
      if (c[j].low < c[i].low) isL = false;
    }
    if (isH) hi.push({ i, p: c[i].high });
    if (isL) lo.push({ i, p: c[i].low });
  }
  return { hi, lo };
}

/** garis lurus terbaik (least squares) lewat titik-titik pivot: harga = a + b·i */
function fit(ps: Piv[]): { a: number; b: number; err: number } {
  const n = ps.length;
  const mx = ps.reduce((s, x) => s + x.i, 0) / n;
  const my = ps.reduce((s, x) => s + x.p, 0) / n;
  let num = 0;
  let den = 0;
  for (const x of ps) {
    num += (x.i - mx) * (x.p - my);
    den += (x.i - mx) ** 2;
  }
  const b = den ? num / den : 0;
  const a = my - b * mx;
  const err = Math.sqrt(ps.reduce((s, x) => s + (x.p - (a + b * x.i)) ** 2, 0) / n);
  return { a, b, err };
}

/** pola garis tren: wedge, triangle, channel, rectangle, broadening */
function trendPattern(c: Bar[], hi: Piv[], lo: Piv[], atr: number): DetectedPattern | null {
  const end = c.length - 1;
  const H = hi.filter((x) => x.i >= end - 70).slice(-4);
  const L = lo.filter((x) => x.i >= end - 70).slice(-4);
  if (H.length < 2 || L.length < 2) return null;
  const i0 = Math.min(H[0].i, L[0].i);
  if (end - i0 < 10) return null;
  const u = fit(H);
  const l = fit(L);
  const U = (i: number) => u.a + u.b * i;
  const Lo = (i: number) => l.a + l.b * i;
  const w0 = U(i0) - Lo(i0);
  const w1 = U(end) - Lo(end);
  if (w0 <= 0 || w1 <= 0) return null;
  // harga terakhir sudah jauh keluar dari pola -> bukan pola yang sedang berjalan
  const last = c[end].close;
  if (last > U(end) + 1.5 * atr || last < Lo(end) - 1.5 * atr) return null;
  const flat = 0.06 * atr; // garis dianggap datar kalau geraknya < 6% ATR per candle
  const dir = (b: number) => (b > flat ? 1 : b < -flat ? -1 : 0);
  const du = dir(u.b);
  const dl = dir(l.b);
  const conv = w1 < w0 * 0.72;
  const div = w1 > w0 * 1.35;
  let name = "";
  let bias: DetectedPattern["bias"] = "netral";
  if (conv && du === 1 && dl === 1) [name, bias] = ["Rising Wedge", "bearish"];
  else if (conv && du === -1 && dl === -1) [name, bias] = ["Falling Wedge", "bullish"];
  else if (conv && du === 0 && dl === 1) [name, bias] = ["Ascending Triangle", "bullish"];
  else if (conv && du === -1 && dl === 0) [name, bias] = ["Descending Triangle", "bearish"];
  else if (conv && du === -1 && dl === 1) [name, bias] = ["Symmetrical Triangle", "netral"];
  else if (div && du >= 0 && dl <= 0) [name, bias] = ["Broadening Formation", "netral"];
  else if (!conv && !div && du === 1 && dl === 1) [name, bias] = ["Ascending Channel", "bullish"];
  else if (!conv && !div && du === -1 && dl === -1) [name, bias] = ["Descending Channel", "bearish"];
  else if (!conv && !div && du === 0 && dl === 0) [name, bias] = ["Rectangle (Range)", "netral"];
  if (!name) return null;
  const tol = 0.35 * atr;
  const touches = H.filter((x) => Math.abs(x.p - U(x.i)) < tol).length + L.filter((x) => Math.abs(x.p - Lo(x.i)) < tol).length;
  if (touches < 4) return null;
  const t = (i: number) => c[Math.min(i, end)].time;
  const notes: Record<string, string> = {
    "Rising Wedge": "dua garis naik menyempit — rawan patah ke bawah",
    "Falling Wedge": "dua garis turun menyempit — sering breakout ke atas",
    "Ascending Triangle": "atap datar, lantai naik — tekanan beli menumpuk",
    "Descending Triangle": "lantai datar, atap turun — tekanan jual menumpuk",
    "Symmetrical Triangle": "menyempit simetris — tunggu arah breakout",
    "Broadening Formation": "ayunan makin lebar — pasar labil",
    "Ascending Channel": "naik dalam jalur sejajar",
    "Descending Channel": "turun dalam jalur sejajar",
    "Rectangle (Range)": "bolak-balik di antara atap & lantai datar",
  };
  return {
    name,
    bias,
    score: touches + Math.max(0, 3 - (u.err + l.err) / atr),
    lines: [
      [
        [t(i0), U(i0)],
        [t(end), U(end)],
      ],
      [
        [t(i0), Lo(i0)],
        [t(end), Lo(end)],
      ],
    ],
    points: [...H, ...L].sort((a, b) => a.i - b.i).map((x) => [t(x.i), x.p] as Pt),
    note: notes[name],
  };
}

/** double top / double bottom */
function doublePattern(c: Bar[], hi: Piv[], lo: Piv[], atr: number): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const end = c.length - 1;
  const t = (i: number) => c[i].time;
  const scan = (ps: Piv[], top: boolean) => {
    const rec = ps.filter((x) => x.i >= end - 60);
    for (let a = rec.length - 2; a >= 0; a--) {
      const p1 = rec[a];
      const p2 = rec[rec.length - 1];
      if (p2.i - p1.i < 5 || Math.abs(p1.p - p2.p) > 0.6 * atr) continue;
      const mid = c.slice(p1.i, p2.i + 1);
      const trough = top ? Math.min(...mid.map((x) => x.low)) : Math.max(...mid.map((x) => x.high));
      const ti = p1.i + mid.findIndex((x) => (top ? x.low : x.high) === trough);
      const depth = top ? Math.max(p1.p, p2.p) - trough : trough - Math.min(p1.p, p2.p);
      if (depth < 2 * atr) continue;
      // puncak/lembah kedua harus jadi ekstrem di antara keduanya
      if (top ? mid.some((x) => x.high > Math.max(p1.p, p2.p) + 0.2 * atr) : mid.some((x) => x.low < Math.min(p1.p, p2.p) - 0.2 * atr)) continue;
      out.push({
        name: top ? "Double Top" : "Double Bottom",
        bias: top ? "bearish" : "bullish",
        score: 5 + depth / atr / 2,
        lines: [
          [
            [t(p1.i), p1.p],
            [t(p2.i), p2.p],
          ],
          [
            [t(p1.i), trough],
            [t(end), trough],
          ],
        ],
        points: [
          [t(p1.i), p1.p],
          [t(ti), trough],
          [t(p2.i), p2.p],
        ],
        note: top ? "dua puncak sejajar — konfirmasi kalau tembus neckline ke bawah" : "dua lembah sejajar — konfirmasi kalau tembus neckline ke atas",
      });
      return;
    }
  };
  scan(hi, true);
  scan(lo, false);
  return out;
}

/** head & shoulders / inverse head & shoulders */
function headShoulders(c: Bar[], hi: Piv[], lo: Piv[], atr: number): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  const end = c.length - 1;
  const t = (i: number) => c[i].time;
  const scan = (ps: Piv[], other: Piv[], top: boolean) => {
    const rec = ps.filter((x) => x.i >= end - 80).slice(-3);
    if (rec.length < 3) return;
    const [l, h, r] = rec;
    const higher = (a: number, b: number) => (top ? a > b : a < b);
    if (!higher(h.p, l.p + (top ? 0.5 : -0.5) * atr) || !higher(h.p, r.p + (top ? 0.5 : -0.5) * atr)) return;
    if (Math.abs(l.p - r.p) > 1.2 * atr) return;
    const n1 = other.filter((x) => x.i > l.i && x.i < h.i);
    const n2 = other.filter((x) => x.i > h.i && x.i < r.i);
    if (!n1.length || !n2.length) return;
    const a = top ? n1.reduce((m, x) => (x.p < m.p ? x : m)) : n1.reduce((m, x) => (x.p > m.p ? x : m));
    const b = top ? n2.reduce((m, x) => (x.p < m.p ? x : m)) : n2.reduce((m, x) => (x.p > m.p ? x : m));
    const slope = (b.p - a.p) / (b.i - a.i || 1);
    const neckEnd = b.p + slope * (end - b.i);
    out.push({
      name: top ? "Head & Shoulders" : "Inverse Head & Shoulders",
      bias: top ? "bearish" : "bullish",
      score: 9 + Math.abs(h.p - (l.p + r.p) / 2) / atr / 3,
      lines: [
        [
          [t(a.i), a.p],
          [t(end), neckEnd],
        ],
      ],
      points: [l, a, h, b, r].map((x) => [t(x.i), x.p] as Pt),
      note: top ? "bahu-kepala-bahu — waspada tembus neckline ke bawah" : "kepala terbalik — peluang naik kalau tembus neckline",
    });
  };
  scan(hi, lo, true);
  scan(lo, hi, false);
  return out;
}

/** bull / bear flag: dorongan kuat lalu konsolidasi kecil berlawanan arah */
function flag(c: Bar[], atr: number): DetectedPattern | null {
  const end = c.length - 1;
  for (let len = 4; len <= 18; len++) {
    const s = end - len; // awal konsolidasi = akhir dorongan
    const p0 = s - 8;
    if (p0 < 0) break;
    const move = c[s].close - c[p0].close;
    if (Math.abs(move) < 3.5 * atr) continue;
    const cons = c.slice(s, end + 1);
    const hiC = Math.max(...cons.map((x) => x.high));
    const loC = Math.min(...cons.map((x) => x.low));
    if (hiC - loC > Math.abs(move) * 0.5) continue; // koreksi maksimal separuh dorongan
    const up = move > 0;
    const hs = fit(cons.map((x, k) => ({ i: s + k, p: x.high })));
    const ls = fit(cons.map((x, k) => ({ i: s + k, p: x.low })));
    if (up ? hs.b > 0.05 * atr : hs.b < -0.05 * atr) continue; // bendera miring melawan arah dorongan / datar
    const t = (i: number) => c[i].time;
    return {
      name: up ? "Bull Flag" : "Bear Flag",
      bias: up ? "bullish" : "bearish",
      score: 6 + Math.abs(move) / atr / 3,
      lines: [
        [
          [t(s), hs.a + hs.b * s],
          [t(end), hs.a + hs.b * end],
        ],
        [
          [t(s), ls.a + ls.b * s],
          [t(end), ls.a + ls.b * end],
        ],
      ],
      points: [
        [t(p0), c[p0].close],
        [t(s), c[s].close],
      ],
      note: up ? "tiang naik kuat + bendera konsolidasi — lanjut naik kalau tembus atas" : "tiang turun kuat + bendera — lanjut turun kalau jebol bawah",
    };
  }
  return null;
}

/** semua pola yang terdeteksi di candle terakhir, urut dari yang paling meyakinkan (maks 3, nama tidak kembar) */
export function detectPatterns(all: Bar[]): DetectedPattern[] {
  const c = all.slice(-120);
  if (c.length < 30) return [];
  const atr = atrOf(c);
  const found: DetectedPattern[] = [];
  for (const k of [2, 3, 5]) {
    const { hi, lo } = pivots(c, k);
    const tp = trendPattern(c, hi, lo, atr);
    if (tp) found.push(tp);
    found.push(...doublePattern(c, hi, lo, atr), ...headShoulders(c, hi, lo, atr));
  }
  const f = flag(c, atr);
  if (f) found.push(f);
  const seen = new Set<string>();
  return found
    .sort((a, b) => b.score - a.score)
    .filter((p) => !seen.has(p.name) && seen.add(p.name))
    .slice(0, 3);
}
