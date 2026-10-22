/**
 * Support & resistance otomatis dari candle asli (dipakai di chart trade plan dan di data untuk AI,
 * supaya garis di chart sama dengan level yang disebut AI). Tanpa AI, tanpa menebak.
 *
 * Cara hitung: cari titik balik (puncak/lembah lokal), kelompokkan yang harganya berdekatan,
 * lalu ambil 2 level terdekat di atas harga terakhir (resistance) dan 2 di bawahnya (support).
 * Makin sering harga mantul di satu level, makin kuat (jumlah "sentuh").
 */
export type Bar = { time: number; open: number; high: number; low: number; close: number };
export type Level = { price: number; touches: number; kind: "support" | "resistance"; name: string };

export function autoLevels(candlesIn: Bar[], max = 2): Level[] {
  const c = candlesIn.slice(-150);
  if (c.length < 12) return [];
  const last = c[c.length - 1].close;
  const k = c.length >= 60 ? 3 : 2;
  const avgRange = c.reduce((a, b) => a + (b.high - b.low), 0) / c.length;
  const tol = Math.max(avgRange * 0.6, last * 0.002);

  // titik balik: puncak (high tertinggi di sekitarnya) & lembah (low terendah di sekitarnya)
  const piv: { p: number; i: number }[] = [];
  for (let i = k; i < c.length - k; i++) {
    let top = true;
    let bot = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (c[j].high > c[i].high) top = false;
      if (c[j].low < c[i].low) bot = false;
    }
    if (top) piv.push({ p: c[i].high, i });
    if (bot) piv.push({ p: c[i].low, i });
  }
  // titik tertinggi & terendah dalam rentang juga dianggap level
  let hiI = 0;
  let loI = 0;
  c.forEach((b, i) => {
    if (b.high > c[hiI].high) hiI = i;
    if (b.low < c[loI].low) loI = i;
  });
  piv.push({ p: c[hiI].high, i: hiI }, { p: c[loI].low, i: loI });

  // kelompokkan harga yang berdekatan (dalam batas toleransi)
  piv.sort((a, b) => a.p - b.p);
  const groups: { sum: number; n: number; lastI: number; idx: Set<number> }[] = [];
  for (const x of piv) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(x.p - g.sum / g.n) <= tol) {
      if (!g.idx.has(x.i)) {
        g.sum += x.p;
        g.n++;
        g.idx.add(x.i);
      }
      g.lastI = Math.max(g.lastI, x.i);
    } else groups.push({ sum: x.p, n: 1, lastI: x.i, idx: new Set([x.i]) });
  }
  // harga level dibulatkan wajar (4.013 bukan 4.013,1; 0,004612 bukan 0,0046123)
  const nice = (p: number) => (p >= 1000 ? Math.round(p) : Number(p.toPrecision(4)));
  const lv = groups.map((g) => ({ price: nice(g.sum / g.n), touches: g.n, lastI: g.lastI }));

  // level terdekat dari harga terakhir; level yang lebih sering disentuh didahulukan kalau jaraknya mirip
  const pick = (side: "above" | "below") =>
    lv
      .filter((l) => (side === "above" ? l.price > last + tol * 0.3 : l.price < last - tol * 0.3))
      .map((l) => ({ ...l, score: Math.abs(l.price - last) / tol - Math.min(l.touches, 4) * 0.8 - (l.lastI > c.length - 30 ? 0.5 : 0) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, max)
      .sort((a, b) => Math.abs(a.price - last) - Math.abs(b.price - last));

  const res = pick("above").map((l, i): Level => ({ price: l.price, touches: l.touches, kind: "resistance", name: `R${i + 1}` }));
  const sup = pick("below").map((l, i): Level => ({ price: l.price, touches: l.touches, kind: "support", name: `S${i + 1}` }));
  return [...res, ...sup];
}

/** satu baris ringkas untuk data AI: "S1 3.995 (3x sentuh) · S2 3.870 · R1 4.120 · R2 4.165 (2x)" */
export function levelsLine(levels: Level[], fmt: (n: number) => string): string {
  if (!levels.length) return "";
  const t = (l: Level) => `${l.name} ${fmt(l.price)}${l.touches >= 2 ? ` (${l.touches}x sentuh)` : ""}`;
  const sup = levels.filter((l) => l.kind === "support").map(t);
  const res = levels.filter((l) => l.kind === "resistance").map(t);
  return `- Support/resistance otomatis dari titik balik candle (SAMA dengan garis yang digambar di chart website): support ${sup.join(", ") || "-"} · resistance ${res.join(", ") || "-"}. Pakai level ini saat menyebut support/resistance.`;
}
