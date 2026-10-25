/**
 * Dokumen "Naskah + storyboard" (HTML mandiri, rapi dicetak A4 / disimpan jadi PDF dari menu Cetak).
 * Bahasa awam: judul, konsep, hook, info video, naskah VO per adegan, storyboard per adegan, dan cue sheet audio.
 * Semua teks dari timeline di-escape (datanya dari AI / user, bukan kode).
 */
import { sfxById, type SfxMeta } from "./sfxMeta";
import {
  FORMATS,
  MUSIC_LEVEL_DB,
  sceneStartSecs,
  totalFrames,
  type BgKind,
  type Camera,
  type Dir,
  type Layout,
  type LayoutKind,
  type MusicLevel,
  type Scene,
  type ScreenKind,
  type Timeline,
  type TransitionKind,
} from "./timeline";
import { storagePathOf } from "./urls";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const HEX = /^#[0-9a-f]{3,8}$/i;
const hex = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v.trim()) ? v.trim() : d);

/** 2.5 -> "2,5" */
const num = (n: number, d = 2) => String(Number(n.toFixed(d))).replace(".", ",");
/** detik -> "0:02,5" */
const clock = (t: number) => {
  const d = Math.max(0, Math.round(t * 10) / 10);
  const m = Math.floor(d / 60);
  const s = d - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0").replace(".", ",")}`;
};

const LAYOUT_LABEL: Record<LayoutKind, string> = {
  kinetic: "Teks bergerak",
  title: "Judul besar",
  lowerThird: "Nama + peran di bawah",
  counter: "Angka berjalan",
  chart: "Grafik",
  phone: "Mockup HP",
  laptop: "Mockup laptop",
  logo: "Logo muncul",
  split: "Layar dibagi dua",
  features: "Kartu fitur",
  cta: "Ajakan penutup (CTA)",
  media: "Video / foto upload",
  quote: "Kutipan",
};
const TR_LABEL: Record<TransitionKind, string> = { cut: "Potong langsung", fade: "Memudar", slide: "Geser", zoom: "Zoom", mask: "Sapuan bentuk", whip: "Kibas cepat", glitch: "Glitch" };
const DIR_LABEL: Record<Dir, string> = { left: "ke kiri", right: "ke kanan", up: "ke atas", down: "ke bawah" };
const CAM_LABEL: Record<Camera, string> = { none: "Diam", push: "Maju pelan", pull: "Mundur pelan", pan: "Geser ke samping", tilt: "Geser atas-bawah" };
const MUSIC_LABEL: Record<MusicLevel, string> = { silent: "hening", low: "pelan", mid: "sedang", high: "keras", drop: "puncak (drop)" };
const BG_LABEL: Record<BgKind, string> = { gradient: "Gradasi warna", particles: "Partikel", solid: "Warna polos", grid: "Grid", media: "Video / foto" };
const SCREEN_LABEL: Record<ScreenKind, string> = {
  dashboard: "Dashboard",
  hotIssue: "Hot Issue",
  videoReview: "Video Review",
  chat: "Chat",
  ai: "AI",
  design: "Desain",
  trainAi: "Train your AI",
  studio: "Studio",
  music: "Musik",
  report: "Laporan",
  website: "Website",
  media: "Media",
};
const SFX_CAT: Record<string, string> = {
  whoosh: "Whoosh",
  transisi: "Transisi",
  ui: "Klik / UI",
  koin: "Koin",
  magic: "Magis",
  boom: "Boom",
  braam: "Braam",
  "bass-drop": "Bass drop",
  impact: "Hantaman",
  riser: "Riser",
  glitch: "Glitch",
  "trailer-pulse": "Denyut trailer",
  ambience: "Suasana",
  foley: "Foley",
};

/** ringkasan isi tata letak dalam satu baris */
function layoutDetail(l: Layout): string {
  const parts: string[] = [];
  switch (l.kind) {
    case "title":
    case "cta":
    case "quote":
      if (l.kicker) parts.push(l.kicker);
      if (l.title) parts.push(`“${l.title}”`);
      if (l.subtitle) parts.push(l.subtitle);
      if (l.button) parts.push(`Tombol: ${l.button}`);
      if (l.by) parts.push(`— ${l.by}`);
      break;
    case "lowerThird":
      parts.push([l.name, l.role].filter(Boolean).join(" · "));
      break;
    case "counter":
      parts.push(`${l.prefix ?? ""}${l.from ?? 0} → ${l.prefix ?? ""}${l.to ?? 0}${l.suffix ?? ""}`);
      if (l.label) parts.push(l.label);
      break;
    case "chart":
      if (l.chart) parts.push(`Grafik ${l.chart.kind === "bar" ? "batang" : l.chart.kind === "area" ? "area" : "garis"} ${l.chart.up ? "naik" : "turun"} (${l.chart.values.length} titik${l.chart.unit ? `, ${l.chart.unit}` : ""})`);
      if (l.label) parts.push(l.label);
      break;
    case "phone":
    case "laptop":
      parts.push(`Layar: ${SCREEN_LABEL[l.screen ?? "dashboard"]}`);
      if (l.items?.length) parts.push(l.items.join(", "));
      break;
    case "logo":
      if (l.title) parts.push(l.title);
      if (l.tagline) parts.push(l.tagline);
      break;
    case "split":
      parts.push(`${l.left?.title ?? "Kiri"} vs ${l.right?.title ?? "Kanan"}`);
      break;
    case "features":
      if (l.cards?.length) parts.push(l.cards.map((c) => `${c.icon ? `${c.icon} ` : ""}${c.title}`).join(" · "));
      break;
    case "media":
      parts.push(l.src ? "File upload" : "Belum ada file");
      break;
    default:
      if (l.emphasis?.length) parts.push(`Disorot: ${l.emphasis.join(", ")}`);
  }
  return parts.filter(Boolean).join(" — ");
}

function voiceLabel(tl: Timeline): string {
  const v = tl.voice;
  if (v.mode === "none" || tl.muteVo) return "Tanpa VO";
  if (v.mode === "edge") return `Cadangan Edge · ${v.edgeVoice === "id-ID-GadisNeural" ? "Gadis (cewek)" : "Ardi (cowok)"} — layanan tidak resmi`;
  if (v.mode === "elevenlabs") return "Premium ElevenLabs";
  const tune = v.exaggeration !== undefined || v.cfg !== undefined ? ` (ekspresi ${num(v.exaggeration ?? 0.65)}, tempo ${num(v.cfg ?? 0.35)})` : "";
  return `Bank suara · ${v.voiceName || "Alif - Energik"}${tune}`;
}

function voStatus(tl: Timeline): string {
  if (tl.voice.mode === "none" || tl.muteVo) return "";
  if (!tl.vo?.lines.length) return "VO belum dibuat";
  return `${tl.vo.temp ? "VO sementara" : "VO jadi"}${tl.vo.label ? ` · ${tl.vo.label}` : ""}`;
}

function musicLabel(tl: Timeline): string {
  const m = tl.music;
  if (m.src === "none") return "Tanpa musik";
  if (m.src === "bed") return "Trailer bed bawaan (100 BPM)";
  const file = m.name || (storagePathOf(m.src) ?? m.src).split("/").pop()?.split("?")[0] || "Musik";
  let name = file;
  try {
    name = decodeURIComponent(file);
  } catch {
    /* nama file tidak ter-encode rapi: pakai apa adanya */
  }
  return `${name}${m.bpm ? ` · ${Math.round(m.bpm)} BPM` : ""}`;
}

type Cue = { t: number; kind: "Musik" | "SFX" | "VO" | "Selesai"; what: string; note: string };

function cueSheet(tl: Timeline, starts: number[], end: number, extra: SfxMeta[]): Cue[] {
  const cues: Cue[] = [];
  const music = tl.music.src !== "none";
  const voOn = tl.voice.mode !== "none" && !tl.muteVo;
  tl.scenes.forEach((sc, i) => {
    const t0 = starts[i];
    // musik naik / turun di awal adegan
    if (music) {
      const prev = i ? tl.scenes[i - 1].music : null;
      if (prev === null) cues.push({ t: t0, kind: "Musik", what: `Musik mulai — ${MUSIC_LABEL[sc.music]}`, note: musicLabel(tl) });
      else if (prev !== sc.music) {
        const up = MUSIC_LEVEL_DB[sc.music] > MUSIC_LEVEL_DB[prev];
        cues.push({ t: t0, kind: "Musik", what: `Musik ${up ? "naik" : "turun"} ke ${MUSIC_LABEL[sc.music]}`, note: `Adegan ${i + 1} · ${sc.name}` });
      }
    }
    if (voOn && sc.vo?.text) {
      const line = tl.vo?.lines.find((l) => l.sceneId === sc.id);
      const words = sc.vo.text.split(/\s+/).filter(Boolean);
      cues.push({
        t: t0 + (line?.at ?? 0.15),
        kind: "VO",
        what: `“${words.slice(0, 7).join(" ")}${words.length > 7 ? "…" : ""}”`,
        note: `${line ? `${num(line.dur, 1)} dtk` : "belum dibuat"} · musik turun saat VO bicara`,
      });
    }
    for (const c of sc.sfx) {
      if (!c.on) continue;
      const m = sfxById(c.id, extra);
      cues.push({
        t: t0 + c.at,
        kind: "SFX",
        what: c.id,
        note: [m ? SFX_CAT[m.cat] ?? m.cat : "", m?.use ?? "", c.gain ? `${c.gain > 0 ? "+" : ""}${num(c.gain, 1)} dB` : ""].filter(Boolean).join(" · "),
      });
    }
  });
  cues.push({ t: end, kind: "Selesai", what: "Video selesai", note: music ? "Musik berakhir di ketukan terdekat" : "" });
  return cues.sort((a, b) => a.t - b.t);
}

/** sketsa bingkai kecil (warna brand + teks layar) untuk storyboard */
function frameSketch(tl: Timeline, sc: Scene, accent: string): string {
  const f = FORMATS[tl.ratio] ?? FORMATS["9:16"];
  const bg = hex(sc.bg.colors?.[0], hex(tl.brand.bg, "#09090b"));
  const fg = hex(tl.brand.text, "#fafafa");
  const lines = sc.text.length ? sc.text : [sc.layout.title ?? sc.layout.tagline ?? sc.name];
  const emph = new Set((sc.layout.emphasis ?? []).flatMap((w) => w.toLowerCase().split(/\s+/)));
  const lineHtml = lines
    .slice(0, 4)
    .map((l) => `<div>${l.split(/\s+/).map((w) => (emph.has(w.toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]/g, "")) ? `<b style="color:${accent}">${esc(w)}</b>` : esc(w))).join(" ")}</div>`)
    .join("");
  return `<div class="frame" style="aspect-ratio:${f.w}/${f.h};width:${f.w >= f.h ? 58 : 34}mm;background:${bg};color:${fg}">
    <div class="frame-txt">${lineHtml}</div>
    <div class="frame-tag" style="background:${accent}">${esc(LAYOUT_LABEL[sc.layout.kind])}</div>
  </div>`;
}

/** dokumen HTML mandiri: naskah VO + storyboard per adegan + cue sheet audio. `extra` = SFX katalog non-bawaan */
export function storyboardHtml(tl: Timeline, extra: SfxMeta[] = []): string {
  const starts = sceneStartSecs(tl);
  const end = totalFrames(tl) / tl.fps;
  const f = FORMATS[tl.ratio] ?? FORMATS["9:16"];
  const accent = hex(tl.brand.primary, "#f97316");
  const accent2 = hex(tl.brand.accent, accent);
  const voOn = tl.voice.mode !== "none" && !tl.muteVo;
  const voScenes = tl.scenes.map((s, i) => ({ s, i })).filter(({ s }) => s.vo?.text);
  const date = new Date().toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const vs = voStatus(tl);

  const info: [string, string][] = [
    ["Platform", tl.platform || f.label],
    ["Rasio", `${tl.ratio} · ${f.w}×${f.h} px`],
    ["Durasi", `${num(end, 1)} detik · ${tl.scenes.length} adegan`],
    ["Mood", tl.mood || "—"],
    ["Tujuan", tl.goal || "—"],
    ["Brand", tl.brand.name],
    ["Suara", `${voiceLabel(tl)}${vs ? ` (${vs})` : ""}`],
    ["Musik", musicLabel(tl)],
  ];

  const voRows = voScenes.length
    ? voScenes
        .map(({ s, i }) => {
          const line = tl.vo?.lines.find((l) => l.sceneId === s.id);
          const t0 = starts[i] + (line?.at ?? 0.15);
          const t1 = line ? t0 + line.dur : starts[i] + s.dur;
          const spell = s.vo?.spell && s.vo.spell !== s.vo.text ? esc(s.vo.spell) : `<span class="muted">sama</span>`;
          return `<tr><td class="nowrap">${i + 1}. ${esc(s.name)}</td><td class="nowrap mono">${clock(t0)}–${clock(t1)}</td><td>${esc(s.vo?.text)}</td><td>${spell}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="4" class="muted">Belum ada naskah VO.</td></tr>`;

  const sceneCards = tl.scenes
    .map((s, i) => {
      const t0 = starts[i];
      const t1 = t0 + s.dur;
      const tr = i === 0 && s.transition.kind === "cut" ? "Langsung (awal video)" : `${TR_LABEL[s.transition.kind]}${s.transition.kind === "slide" || s.transition.kind === "whip" ? ` ${DIR_LABEL[s.transition.dir ?? "left"]}` : ""}${s.transition.kind !== "cut" ? ` · ${num(s.transition.dur ?? 0.4, 1)} dtk` : ""}`;
      const detail = layoutDetail(s.layout);
      const sfx = s.sfx.filter((c) => c.on);
      const rows: [string, string][] = [
        ["Visual", s.visual ? esc(s.visual) : `<span class="muted">—</span>`],
        ["Tata letak", `${esc(LAYOUT_LABEL[s.layout.kind])}${detail ? ` — ${esc(detail)}` : ""}`],
        ["Teks layar", s.text.length ? s.text.map((l) => `<div>“${esc(l)}”</div>`).join("") : `<span class="muted">—</span>`],
        ["VO", voOn && s.vo?.text ? esc(s.vo.text) : `<span class="muted">—</span>`],
        ["Gerak", `Kamera: ${esc(CAM_LABEL[s.camera])} · Transisi masuk: ${esc(tr)}`],
        ["Latar", esc(BG_LABEL[s.bg.kind])],
        ["Audio", `Musik ${esc(MUSIC_LABEL[s.music])}${sfx.length ? ` · SFX: ${sfx.map((c) => `${esc(c.id)} (${num(c.at, 2)} dtk)`).join(", ")}` : ""}`],
      ];
      return `<section class="scene">
        ${frameSketch(tl, s, accent)}
        <div class="scene-body">
          <div class="scene-head"><span class="no" style="background:${accent}">${i + 1}</span><strong>${esc(s.name)}</strong><span class="mono muted">${clock(t0)}–${clock(t1)} · ${num(s.dur)} dtk</span></div>
          <table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
        </div>
      </section>`;
    })
    .join("");

  const cues = cueSheet(tl, starts, end, extra)
    .map((c) => `<tr><td class="nowrap mono">${clock(c.t)}</td><td class="nowrap"><span class="tag tag-${c.kind.toLowerCase()}">${c.kind}</span></td><td>${esc(c.what)}</td><td class="muted">${esc(c.note)}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(tl.title)} — Naskah &amp; storyboard</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; padding: 24px; font: 13px/1.5 "Plus Jakarta Sans Variable", "Inter Variable", "Segoe UI", system-ui, -apple-system, sans-serif; color: #18181b; background: #fff; }
  .wrap { max-width: 186mm; margin: 0 auto; }
  h1 { font-size: 24px; line-height: 1.2; margin: 0 0 2px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 2px solid ${accent}; break-after: avoid; }
  .sub { color: #71717a; font-size: 12px; margin-bottom: 14px; }
  .bar { height: 5px; border-radius: 3px; background: linear-gradient(90deg, ${accent}, ${accent2}); margin-bottom: 16px; }
  .lead { display: grid; gap: 8px; margin-bottom: 6px; }
  .lead div { padding: 10px 12px; border-radius: 10px; background: #fafaf9; border: 1px solid #e7e5e4; }
  .lead b { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #a1a1aa; margin-bottom: 2px; }
  .info { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 14px; margin-top: 10px; }
  .info div { display: flex; gap: 8px; border-bottom: 1px dashed #e4e4e7; padding: 4px 0; }
  .info span { width: 70px; flex: none; color: #71717a; }
  .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-left: 4px; border: 1px solid rgb(0 0 0 / .1); }
  table { width: 100%; border-collapse: collapse; }
  .grid th, .grid td { border: 1px solid #e4e4e7; padding: 6px 8px; text-align: left; vertical-align: top; }
  .grid th { background: #f4f4f5; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #52525b; }
  .grid tr { break-inside: avoid; }
  .nowrap { white-space: nowrap; }
  .mono { font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 12px; }
  .muted { color: #a1a1aa; }
  .scene { display: flex; gap: 12px; padding: 10px; margin-bottom: 10px; border: 1px solid #e4e4e7; border-radius: 12px; break-inside: avoid; }
  .frame { position: relative; flex: none; border-radius: 8px; overflow: hidden; display: flex; align-items: center; justify-content: center; padding: 8px; text-align: center; box-shadow: inset 0 0 0 1px rgb(255 255 255 / .06); }
  .frame-txt { font-weight: 800; font-size: 10px; line-height: 1.2; }
  .frame-tag { position: absolute; left: 4px; bottom: 4px; padding: 1px 5px; border-radius: 4px; font-size: 7px; font-weight: 700; color: #fff; }
  .scene-body { flex: 1; min-width: 0; }
  .scene-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 6px; font-size: 14px; }
  .no { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; color: #fff; font-size: 12px; font-weight: 800; }
  .kv th { width: 76px; text-align: left; vertical-align: top; color: #71717a; font-weight: 600; padding: 2px 8px 2px 0; font-size: 12px; }
  .kv td { padding: 2px 0; }
  .tag { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 700; background: #f4f4f5; color: #52525b; }
  .tag-sfx { background: #e0f2fe; color: #075985; }
  .tag-musik { background: #ede9fe; color: #5b21b6; }
  .tag-vo { background: #ffedd5; color: #9a3412; }
  .tag-selesai { background: #dcfce7; color: #166534; }
  .foot { margin-top: 22px; color: #a1a1aa; font-size: 11px; text-align: center; }
  @media (max-width: 640px) { body { padding: 14px; } .info { grid-template-columns: 1fr; } .scene { flex-direction: column; } }
  @media print { body { padding: 0; } h2 { margin-top: 16px; } }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(tl.title)}</h1>
  <div class="sub">Naskah &amp; storyboard · ${esc(date)}</div>
  <div class="bar"></div>
  <div class="lead">
    ${tl.concept ? `<div><b>Konsep</b>${esc(tl.concept)}</div>` : ""}
    ${tl.hook ? `<div><b>Hook (1,5 detik pertama)</b>${esc(tl.hook)}</div>` : ""}
  </div>
  <div class="info">
    ${info.map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}${k === "Brand" ? `<i class="sw" style="background:${accent}"></i><i class="sw" style="background:${hex(tl.brand.bg, "#09090b")}"></i>` : ""}</strong></div>`).join("")}
  </div>

  <h2>Naskah voice over</h2>
  <table class="grid">
    <thead><tr><th>Adegan</th><th>Waktu</th><th>Teks VO</th><th>Ejaan mesin suara</th></tr></thead>
    <tbody>${voRows}</tbody>
  </table>

  <h2>Storyboard per adegan</h2>
  ${sceneCards}

  <h2>Cue sheet audio</h2>
  <table class="grid">
    <thead><tr><th>Waktu</th><th>Jenis</th><th>Isi</th><th>Catatan</th></tr></thead>
    <tbody>${cues}</tbody>
  </table>

  <div class="foot">Dibuat dengan Studio Pro · ${esc(tl.brand.name)}</div>
</div>
</body>
</html>`;
}
