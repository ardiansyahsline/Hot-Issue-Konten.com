/**
 * Standar desain Konten.com (dari skill "konten-report-designer"): token warna, rumus campaign,
 * aturan untuk AI, dan spesifikasi halaman report (Campaign Performance & Portfolio one-pager).
 * Dipakai untuk SEMUA hasil desain AI: kartu report PNG, PowerPoint, dll.
 */

export const KD = {
  bg: "#0a0a0a",
  panel: "#141414",
  panel2: "#101010",
  heroBg: "#0d0d0d",
  border: "#242424",
  muted: "#8a8a8a",
  muted2: "#6a6a6a",
  soft: "#cfcfcf",
  green: "#2fe34a",
  greenLine: "#54ff6e",
  greenBorder: "#1c5c28",
  orange: "#ff6a00",
  orangeA: "#ff5a00",
  orangeB: "#ff8a00",
  red: "#ff3b30",
  violet: "#a78bfa",
  tiktok: "#33c9d6",
  instagram: "#ff8a00",
  youtube: "#ff1a1a",
  threads: "#b0b0b0",
  zero: "#8a8a8a",
};
export const ACCENTS = ["#ff6a00", "#2fe34a", "#a78bfa", "#33c9d6", "#ff3b5c", "#ffd166"];

/** aturan desain + data untuk AI (disuntikkan saat user minta desain / laporan / PPT / report) */
export const DESIGN_RULES = [
  "STANDAR DESAIN KONTEN.COM (WAJIB untuk semua desain: report, PPT, slide, poster, one-pager, kartu ringkasan):",
  "- Gaya: latar hitam #0a0a0a, panel #101010/#141414 dengan garis #242424, font Neue Montreal, logo Konten.com kiri atas + judul besar huruf kapital kanan atas (mis. CAMPAIGN PERFORMANCE / LAPORAN DIVISI).",
  "- Angka utama (hero) HIJAU #2fe34a. SATU kartu sorotan per halaman/slide berwarna ORANYE (#ff5a00→#ff8a00), mis. Effective CPM. Merah #ff3b30 hanya untuk masalah. Teks pendukung abu-abu #8a8a8a.",
  "- Warna platform tetap: TikTok #33c9d6 · Instagram #ff8a00 · YouTube #ff1a1a · Threads #b0b0b0. Nilai 0 tampil abu-abu.",
  "- Badge status: Active (hijau) / Completed (abu-abu) di samping nama campaign. Nama platform TIDAK ditempel di nama campaign (taruh di kolom platform).",
  "ATURAN DATA (non-negotiable):",
  "- JANGAN nebak angka. Semua angka dari data user / file / screenshot dashboard. Kalau ada yang tidak terbaca, tanya atau sebut jelas sebagai asumsi + asalnya.",
  "- Rumus campaign: net spend = spent × 0,89 (fee 11%). eCPM = net spend ÷ views × 1.000. value = spent × (CPM ÷ eCPM). Bonus = value − spent (negatif → Rp 0, kartu netral). Multiplier = CPM ÷ eCPM. Spent Rp 0 → eCPM/bonus tampil 'Rp —' (bukan Rp 0 hijau).",
  "- Cek basis: kalau kartu Submissions = jumlah Approved, itu basis Approved walau user bilang All — sebut buktinya sebelum lanjut. Kalau CPM yang disebut user beda dengan dashboard, sajikan dua opsi dengan angkanya.",
  "- Basis All = proyeksi (pre-verifikasi); Approved = sudah tervalidasi. Multiplier tinggi dari basis kecil itu artefak — bilang terus terang.",
  "- Playbook anomali (laporkan kalau kena): views turun antar snapshot · approved turun tapi spent naik · approved+pending ≠ submissions · eCPM tidak cocok dengan views · views 5 digit tapi engagement 0% · rejection > 5% (normal 1–3%) · data identik antar snapshot · views_all × CPM > budget (budget tidak cukup) · spent ≪ budget padahal Active · ada approved tapi spent Rp 0.",
  "- Bar progress budget = % TERPAKAI (dashboard Konten.com menampilkan % sisa — sebut sekali kalau relevan).",
  "",
  "OUTPUT HALAMAN REPORT (PNG siap kirim ke klien) — pakai blok ```report berisi JSON:",
  '  Campaign Performance: {"kind":"campaign","client":"Teh Pucuk × PRJ","status":"Active","basis":"All","platform":"TikTok","date":"21 August 2026","views":19779045,"videos":16758,"spent":19583359,"budget":20000000,"cpm":3000,"platforms":{"tiktok":{"videos":12017,"views":5800000},"instagram":{"videos":1961,"views":898000},"youtube":{"videos":2780,"views":13100000},"threads":{"videos":0,"views":0}},"dashboard":{"ecpm":881,"bonus":47102313}}',
  "    angka MENTAH (integer, tanpa titik/Rp). eCPM, bonus, multiplier, % budget DIHITUNG WEBSITE — jangan diisi sendiri kecuali di \"dashboard\" (angka yang tertulis di dashboard, untuk cek silang). platform & dashboard opsional.",
  '  Portfolio one-pager: {"kind":"portfolio","title":"Track Record UGC Campaign","sub":"Campaign yang sudah berjalan di Konten.com","date":"29 July 2026","summary":[{"lbl":"Total Campaign","v":"4","n":"3 Completed · 1 Active"},{"lbl":"Total Views","v":"101.6M","n":"Akumulasi 4 campaign","hi":true}],"campaigns":[{"name":"UGC Konten.com","brand":"konten.com","status":"Completed","cells":[["Kategori","Entertainment"],["Platform","TikTok · Instagram · YouTube"],["Rate","Rp 7.500 /1K"],["Total Views","79.3M"]]}]}',
  "    'Total Creator Join' itu akumulasi, bukan unique → labeli 'Total Partisipasi'. Jumlah kolom cells sama di semua campaign.",
  "  Dua basis (All & Approved) = dua blok ```report terpisah. Setelah blok, tulis: 1 kalimat apa yang dibuat, tabel ringkas angka kunci, anomali/asumsi (sebut angkanya), saran tindakan.",
  "PPT / PRESENTASI: blok ```deck mengikuti warna & aturan di atas (tone green = angka utama, orange = 1 sorotan per slide).",
].join("\n");

export const DESIGN_INTENT = /\b(desain|design|ppt|pptx|powerpoint|slide|presentasi|deck|laporan|report|poster|infografis|infographic|one.?pager|portfolio|portofolio|track record|campaign performance|performa campaign|render|banner|kartu ringkas)\w*/i;

/* ---------- rumus campaign (sama persis dengan report_lib.py) ---------- */
export const FEE = 0.89;
export const ecpmOf = (spent: number, views: number) => Math.round((spent * FEE) / views * 1000);
export const idNum = (n: number) => Math.round(n).toLocaleString("id-ID");
export const rp = (n: number) => `Rp ${idNum(n)}`;
/** label views gaya dashboard: 19.8M / 898.0K / 950 */
export const viewsLabel = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(Math.round(n)));
const multTxt = (x: number) => `${x.toFixed(1).replace(".", ",")}x`;

export type Plat = { videos: number; views: number };
export type CampaignSpec = {
  kind: "campaign";
  client: string;
  status: "Active" | "Completed";
  basis: "All" | "Approved";
  platform?: string;
  date: string;
  views: number;
  videos: number;
  spent: number;
  budget: number;
  cpm: number;
  platforms: { tiktok: Plat; instagram: Plat; youtube: Plat; threads: Plat };
  dashboard?: { ecpm?: number; bonus?: number };
};
export type PortfolioSpec = {
  kind: "portfolio";
  title: string;
  sub: string;
  date: string;
  heading?: string;
  rsub?: string;
  section?: string;
  summary: { lbl: string; v: string; n: string; hi?: boolean }[];
  campaigns: { name: string; brand: string; status: string; cells: [string, string][]; accent?: string }[];
};
export type ReportSpec = CampaignSpec | PortfolioSpec;

export type CampaignView = {
  views: string;
  videos: string;
  spent: string;
  budget: string;
  cpm: string;
  ecpm: string;
  bonus: string;
  multNote: string;
  multBig: string;
  neutral: boolean;
  pctSpent: number;
  remain: string;
  plats: { key: keyof CampaignSpec["platforms"]; name: string; color: string; videos: string; views: string; raw: number }[];
  warnings: string[];
};

/** hitung semua angka turunan + cek silang (pengganti check() di report_lib) */
export function computeCampaign(c: CampaignSpec): CampaignView {
  const warnings: string[] = [];
  const hasSpend = c.spent > 0 && c.views > 0;
  const e = hasSpend ? ecpmOf(c.spent, c.views) : 0;
  const ecpmUsed = c.dashboard?.ecpm && c.dashboard.ecpm > 0 ? c.dashboard.ecpm : e;
  if (hasSpend && c.dashboard?.ecpm && Math.abs(e - c.dashboard.ecpm) > 2)
    warnings.push(`eCPM hitung ${rp(e)} ≠ dashboard ${rp(c.dashboard.ecpm)} — biasanya basis ketuker (All vs Approved) atau CPM salah. Jangan kirim dulu.`);
  const value = hasSpend && ecpmUsed > 0 ? (c.spent * c.cpm) / ecpmUsed : 0;
  const bonusRaw = Math.round(value - c.spent);
  const bonus = Math.max(0, bonusRaw);
  if (hasSpend && c.dashboard?.bonus != null && Math.abs(bonus - c.dashboard.bonus) > Math.max(2, Math.abs(c.dashboard.bonus) * 0.0001))
    warnings.push(`Bonus hitung ${rp(bonus)} ≠ dashboard ${rp(c.dashboard.bonus)} — cek CPM yang dipakai dashboard.`);
  const neutral = !hasSpend || bonusRaw <= 0;
  const mult = hasSpend && ecpmUsed > 0 ? c.cpm / ecpmUsed : 0;
  const pctSpent = c.budget > 0 ? Math.round((c.spent / c.budget) * 100) : 0;
  const remainRaw = c.budget - c.spent;
  const pctRemain = c.budget > 0 ? Math.round((remainRaw / c.budget) * 100) : 0;
  if (c.spent > c.budget) warnings.push(`Spent ${rp(c.spent)} melebihi budget ${rp(c.budget)}.`);
  if (!hasSpend && c.spent === 0) warnings.push("Spent Rp 0: eCPM/bonus belum terdefinisi (ditampilkan 'Rp —'). Kalau sudah ada video approved, payout mungkin belum diproses.");
  if (hasSpend && bonusRaw <= 0) warnings.push(`Under-deliver: eCPM ${rp(ecpmUsed)} di atas CPM ${rp(c.cpm)} → bonus Rp 0, kartu bonus netral.`);
  if (c.status === "Active" && c.budget > 0 && pctSpent < 20) warnings.push(`Budget baru terpakai ${pctSpent}% padahal campaign Active — risiko budget tidak terserap.`);
  const P = c.platforms;
  const sumViews = P.tiktok.views + P.instagram.views + P.youtube.views + P.threads.views;
  const sumVideos = P.tiktok.videos + P.instagram.videos + P.youtube.videos + P.threads.videos;
  if (sumViews > 0 && Math.abs(sumViews - c.views) / c.views > 0.02) warnings.push(`Total views per platform (${viewsLabel(sumViews)}) beda dengan total views (${viewsLabel(c.views)}).`);
  if (sumVideos > 0 && sumVideos !== c.videos) warnings.push(`Jumlah video per platform (${idNum(sumVideos)}) ≠ total video (${idNum(c.videos)}).`);
  if (c.basis === "All" && hasSpend) warnings.push("Basis All: eCPM, bonus & multiplier ini proyeksi (pre-verifikasi) — Approved = yang sudah tervalidasi.");
  const plat = (key: keyof CampaignSpec["platforms"], name: string, color: string) => ({
    key,
    name,
    color: P[key].views > 0 ? color : KD.zero,
    videos: idNum(P[key].videos),
    views: P[key].views > 0 ? viewsLabel(P[key].views) : "0",
    raw: P[key].views,
  });
  return {
    views: viewsLabel(c.views),
    videos: idNum(c.videos),
    spent: rp(c.spent),
    budget: rp(c.budget),
    cpm: rp(c.cpm),
    ecpm: hasSpend ? rp(ecpmUsed) : "Rp —",
    bonus: hasSpend ? rp(bonus) : "Rp —",
    multNote: hasSpend ? `Budget kamu bekerja ${multTxt(mult)}` : "Belum ada budget terpakai",
    multBig: hasSpend ? multTxt(mult).toUpperCase() : "—",
    neutral,
    pctSpent: Math.max(0, Math.min(100, pctSpent)),
    remain: `${rp(remainRaw)} Remaining (${pctRemain}%)`,
    plats: [plat("tiktok", "TikTok", KD.tiktok), plat("instagram", "Instagram", KD.instagram), plat("youtube", "Youtube", KD.youtube), ...(P.threads.views > 0 ? [plat("threads", "Threads", KD.threads)] : [])],
    warnings,
  };
}

/* ---------- parse blok ```report ---------- */
const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown, max = 200) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
const plat = (v: unknown): Plat => ({ videos: n((v as Record<string, unknown>)?.videos), views: n((v as Record<string, unknown>)?.views) });

export function parseReport(raw: unknown): ReportSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === "portfolio") {
    const camps = Array.isArray(r.campaigns) ? r.campaigns : [];
    const ncol = Math.min(6, Math.max(...camps.map((c: Record<string, unknown>) => (Array.isArray(c?.cells) ? c.cells.length : 0)), 0));
    return {
      kind: "portfolio",
      title: s(r.title, 80) || "Portfolio",
      sub: s(r.sub, 140),
      date: s(r.date, 40),
      heading: s(r.heading, 40) || undefined,
      rsub: s(r.rsub, 60) || undefined,
      section: s(r.section, 40) || undefined,
      summary: (Array.isArray(r.summary) ? r.summary : []).slice(0, 4).map((x: Record<string, unknown>) => ({ lbl: s(x?.lbl, 30), v: s(x?.v, 20), n: s(x?.n, 50), hi: !!x?.hi })),
      campaigns: camps.slice(0, 10).map((c: Record<string, unknown>, i: number) => ({
        name: s(c?.name, 80),
        brand: s(c?.brand, 60),
        status: s(c?.status, 20) || "Completed",
        accent: s(c?.accent, 10) || ACCENTS[i % ACCENTS.length],
        cells: Array.from({ length: ncol }, (_, j) => {
          const cell = Array.isArray(c?.cells) ? (c.cells as unknown[])[j] : null;
          return (Array.isArray(cell) ? [s(cell[0], 30), s(cell[1], 50)] : ["", ""]) as [string, string];
        }),
      })),
    };
  }
  const P = (r.platforms ?? {}) as Record<string, unknown>;
  const d = (r.dashboard ?? {}) as Record<string, unknown>;
  const c: CampaignSpec = {
    kind: "campaign",
    client: s(r.client, 60) || "Campaign",
    status: /complete/i.test(s(r.status)) ? "Completed" : "Active",
    basis: /approv/i.test(s(r.basis)) ? "Approved" : "All",
    platform: s(r.platform, 40) || undefined,
    date: s(r.date, 40),
    views: n(r.views),
    videos: n(r.videos),
    spent: n(r.spent),
    budget: n(r.budget),
    cpm: n(r.cpm),
    platforms: { tiktok: plat(P.tiktok), instagram: plat(P.instagram ?? P.ig), youtube: plat(P.youtube ?? P.yt), threads: plat(P.threads) },
    dashboard: d.ecpm != null || d.bonus != null ? { ecpm: d.ecpm != null ? n(d.ecpm) : undefined, bonus: d.bonus != null ? n(d.bonus) : undefined } : undefined,
  };
  if (!c.views || !c.cpm) return null;
  return c;
}

export function splitReports(text: string): { text: string; reports: ReportSpec[]; partial: boolean } {
  const reports: ReportSpec[] = [];
  let out = text.replace(/```report\s*\n([\s\S]*?)```/g, (_, body: string) => {
    try {
      const r = parseReport(JSON.parse(body));
      if (r) reports.push(r);
    } catch {}
    return "";
  });
  const i = out.indexOf("```report");
  const partial = i >= 0;
  if (partial) out = out.slice(0, i);
  return { text: out.replace(/\n{3,}/g, "\n\n").trim(), reports, partial };
}
