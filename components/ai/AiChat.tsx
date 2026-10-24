"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteConversation, renameConversation } from "@/app/(app)/ai/actions";
import { ATTACH_BUCKET } from "@/lib/attachments";
import { SMART, SMART_HERO, heroColor, heroDesc, heroName, heroRole, isVisionModel, variantScore } from "@/lib/aiModels";
import Markdown from "./Markdown";
import HeroArt from "./HeroArt";
import HeroGallery from "./HeroGallery";
import TradingChart, { splitChart } from "./TradingChart";
import TradePlanChart from "./TradePlanChart";
import ThinkingSteps from "./ThinkingSteps";
import { tidyAnswer } from "@/lib/aiText";
import AnalysisCard from "./AnalysisCard";
import AskCard from "./AskCard";
import ChoiceCard from "./ChoiceCard";
import HelperLine from "./HelperLine";
import AnsweredCard, { parseCardAnswer } from "./AnsweredCard";
import { splitChoice } from "@/lib/choiceCard";
import { analysisText, splitAnalysis, splitAsk } from "@/lib/analysisCard";
import { splitPlan } from "@/lib/tradePlan";
import { GROUPS, personaOf, registerCustom, splitVia, type Group as PGroup } from "@/lib/aiPersona";
import { CHAR_PREFIX, isCharModel, registerChar, type CustomChar, type MemoryKind } from "@/lib/customChar";
import CharacterWizard from "./CharacterWizard";
import CharacterBrain from "./CharacterBrain";
import FilePlanCard from "./FilePlanCard";
import DeckCard from "./DeckCard";
import ReportCard from "./ReportCard";
import { splitReports } from "@/lib/kontenDesign";
import { splitDeck } from "@/lib/deck";
import { splitMusic } from "@/lib/musicCmd";
import MusicCmdCard from "./MusicCmdCard";
import { findDuplicates, folderSupported, listingText, pickFolder, readContents, scanFolder, scanFromFiles, splitFilePlan, type Scan } from "@/lib/localFolder";

export type AiConv = { id: string; title: string; model: string | null; updated_at: string };
export type AiStep = { id: string; k: string; s: "run" | "done" | "skip"; q?: string; n?: number; sym?: string; src?: string; to?: string; plan?: boolean };

export type AiMsg = {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  error?: boolean;
  created_at?: string;
  images?: string[] | null;
  used_data?: boolean | null;
  used_web?: boolean;
  persona?: string | null;
  chart?: string | null;
  steps?: AiStep[];
  startedAt?: number;
  doneAt?: number;
  /** model diganti otomatis (mis. karena ada gambar) */
  switched?: boolean;
  /** jawaban dari karakter buatan sendiri (untuk 👍 / koreksi / ingat ini) */
  character_id?: string | null;
  /** hero penjawab dipilihkan oleh Layla (mode otomatis) */
  via?: string | null;
};
/** buang penanda [[via:Layla]] dari isi jawaban tersimpan -> jadi kolom via */
const normMsg = (m: AiMsg): AiMsg => {
  if (m.role !== "assistant" || !m.content) return m;
  const v = splitVia(m.content);
  return v.via ? { ...m, content: v.content, via: v.via } : m;
};
type Pending = { key: string; preview: string; status: "uploading" | "done" | "error"; path?: string };

const TRADING_PROMPT = "Analisa chart trading ini: tren, support/resistance, pola candlestick, indikator yang terlihat, dan skenario bullish/bearish.";
const SUGGEST: { icon: string; label: string; prompt: string; pick?: boolean; send?: boolean }[] = [
  { icon: "📈", label: "Analisa chart trading", prompt: TRADING_PROMPT, pick: true },
  { icon: "📊", label: "Rangkum Hot Issue minggu ini", prompt: "Rangkum Hot Issue minggu ini: topik paling banyak laporan, yang masih open, dan siapa PIC-nya.", send: true },
  { icon: "🎬", label: "Kasus Video Review terbanyak", prompt: "Kategori kasus Video Review apa yang paling banyak 7 hari terakhir? Bandingkan dengan 30 hari terakhir.", send: true },
  { icon: "🖼️", label: "Jelaskan isi screenshot", prompt: "Tolong jelaskan isi screenshot ini.", pick: true },
  { icon: "✍️", label: "Bikin caption campaign", prompt: "Bikinin 3 ide caption TikTok yang santai untuk campaign film, kasih hashtag juga", send: true },
  { icon: "🌐", label: "Terjemahin teks", prompt: "Terjemahkan teks berikut ke bahasa Inggris yang natural:\n\n" },
];

const MODEL_KEY = "cs-ai-model-v2";
// chibi mini di tombol "Buat Karakter AI"
const BTN_CHIBI = "__tombol_buat_karakter__";
registerCustom(BTN_CHIBI, { type: "ENFP", hair: 3, skin: "#f5c9a8", hc: "#3b2a1e", prop: "orb" });
const DATA_KEY = "cs-ai-data";
const WEB_KEY = "cs-ai-web";
const MAX_IMAGES = 4;

function group(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff < 1) return "Hari ini";
  if (diff < 2) return "Kemarin";
  if (diff < 7) return "7 hari terakhir";
  if (diff < 30) return "30 hari terakhir";
  return "Lebih lama";
}

/** Kecilkan gambar (maks 1600px, JPEG) supaya cepat dikirim ke AI */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

type HeroOpt = { hero: string; model: string; status: number; vision: boolean };

function HeroAvatar({ hero, size = 28 }: { hero: string; size?: number }) {
  return (
    <span className="flex shrink-0 items-end justify-center overflow-hidden rounded-lg" style={{ width: size, height: size, background: `${heroColor(hero)}22` }} aria-hidden>
      <HeroArt hero={hero} size={size * 1.15} still />
    </span>
  );
}

/** satu pilihan per hero (varian terbaik), dikelompokkan: siap dipakai / belum dicoba / belum tersambung */
function heroOptions(models: string[], status: Record<string, number>, visionList: string[]): HeroOpt[] {
  const best = new Map<string, HeroOpt>();
  for (const m of models) {
    const hero = heroName(m);
    const opt = { hero, model: m, status: status[m] ?? 1, vision: visionList.includes(m) || isVisionModel(m) };
    const cur = best.get(hero);
    // models sudah urut dari server (siap dulu, lalu urutan katalog) -> yang pertama per hero dipakai, kecuali ada yang statusnya lebih baik
    if (!cur || opt.status < cur.status || (opt.status === cur.status && variantScore(m) > variantScore(cur.model))) best.set(hero, opt);
  }
  return [...best.values()];
}

function ModelPicker({
  value,
  onChange,
  models,
  ready,
  vision,
  status,
  visionList,
  loadError,
  onReload,
  owner,
  chars,
}: {
  owner: boolean;
  chars: CustomChar[];
  value: string;
  onChange: (m: string) => void;
  models: string[];
  ready: boolean;
  vision: { text: string | null; image: string | null };
  status: Record<string, number>;
  visionList: string[];
  loadError: string | null;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [showOff, setShowOff] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const opts = useMemo(() => heroOptions(models, status, visionList), [models, status, visionList]);
  const s = q.trim().toLowerCase();
  const match = (o: HeroOpt) => !s || o.hero.toLowerCase().includes(s) || heroRole(o.hero).toLowerCase().includes(s) || heroDesc(o.model).toLowerCase().includes(s);
  // pemilik melihat status (siap / belum dicoba / gagal); user lain melihat semua hero sebagai satu daftar siap pakai
  const ready0 = opts.filter((o) => (owner ? o.status === 0 : true) && match(o)).sort((a, b) => (owner ? 0 : a.hero.localeCompare(b.hero)));
  const untried = owner ? opts.filter((o) => o.status === 1 && match(o)) : [];
  const off = owner ? opts.filter((o) => o.status === 2 && match(o)) : [];
  const current = value === SMART ? SMART_HERO : isCharModel(value) ? (chars.find((c) => `${CHAR_PREFIX}${c.id}` === value)?.name ?? "Karakter") : heroName(value);
  const mine = chars.filter((c) => !s || c.name.toLowerCase().includes(s) || (c.profile.role ?? "").toLowerCase().includes(s));
  const pick = (m: string) => {
    onChange(m);
    setOpen(false);
    setQ("");
  };
  const STATUS_DOT = ["#22c55e", "#a1a1aa", "#f59e0b"];
  const Row = ({ o }: { o: HeroOpt }) => {
    const p = personaOf(o.hero);
    const g = GROUPS[p.group];
    const on = current === o.hero && value !== SMART;
    return (
      <button
        type="button"
        onClick={() => pick(o.model)}
        title={`${o.hero} · ${p.type} ${p.label} — ${heroDesc(o.model)}`}
        className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${on ? "bg-orange-500/10" : "hover:bg-zinc-800"}`}
      >
        <span className="flex h-8 w-8 shrink-0 items-end justify-center overflow-hidden rounded-[10px] border" style={{ background: g.soft, borderColor: `${g.color}55` }} aria-hidden>
          <HeroArt hero={o.hero} size={36} still />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={`text-[13px] font-semibold ${on ? "text-orange-400" : "text-zinc-200"}`}>{o.hero}</span>
            <span className="rounded-full px-1.5 py-px text-[10.5px] font-bold" style={{ background: g.soft, color: g.color }}>
              {p.label}
            </span>
          </span>
          <span className="block truncate text-[11.5px] leading-snug text-zinc-400">{p.tag}</span>
        </span>
        {owner && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_DOT[o.status] ?? STATUS_DOT[1] }} title={["mesin siap", "belum dicoba", "pakai mesin cadangan"][o.status]} />}
        {o.vision && (
          <span className="shrink-0 text-[11px] opacity-60" title="Bisa lihat gambar">
            👁
          </span>
        )}
      </button>
    );
  };
  const byGroup = (Object.keys(GROUPS) as PGroup[])
    .map((g) => ({ g, list: opts.filter((o) => match(o) && personaOf(o.hero).group === g).sort((a, b) => a.hero.localeCompare(b.hero)) }))
    .filter((x) => x.list.length);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[210px] items-center gap-1.5 rounded-full border border-zinc-800 py-0.5 pl-0.5 pr-2.5 text-[12px] font-semibold text-zinc-300 hover:border-zinc-600"
        title={isCharModel(value) ? `${current}: karakter buatanmu` : `${current}: ${heroDesc(value)}`}
        aria-label="Pilih hero"
      >
        <HeroAvatar hero={current} size={22} />
        <span className="truncate">
          {current}
          {value === SMART ? " · otomatis" : ""}
        </span>
        ▾
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-40 mb-2 w-[360px] max-w-[88vw] rounded-2xl border border-zinc-800 bg-zinc-900 p-2 text-left"
          style={{ boxShadow: "var(--shadow-pop), 0 18px 40px -16px rgba(0,0,0,.35)" }}
          role="listbox"
          aria-label="Daftar hero"
        >
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari hero / role / keahlian…" className="input mb-1 py-1.5 text-[13px]" />
          <div className="max-h-[22rem] overflow-y-auto">
            <button
              type="button"
              onClick={() => pick(SMART)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${value === SMART ? "bg-orange-500/10" : "hover:bg-zinc-800"}`}
            >
              <HeroAvatar hero={SMART_HERO} />
              <span className="min-w-0 flex-1">
                <span className={`block text-[13px] font-semibold ${value === SMART ? "text-orange-400" : "text-zinc-200"}`}>
                  Layla · otomatis <span className="ml-1 text-[10.5px] font-medium text-zinc-500">disarankan</span>
                </span>
                <span className="block text-[11.5px] leading-snug text-zinc-400">{heroDesc(SMART)}</span>
                {owner && (vision.text || vision.image) && (
                  <span className="block text-[10.5px] text-zinc-500">
                    sekarang: chat {vision.text ? heroName(vision.text) : "-"} · gambar {vision.image ? heroName(vision.image) : "belum ada"}
                  </span>
                )}
              </span>
            </button>
            {mine.length > 0 && (
              <div>
                <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">Karakter buatanmu</div>
                {mine.map((c) => {
                  const v = `${CHAR_PREFIX}${c.id}`;
                  const p = personaOf(c.name);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pick(v)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${value === v ? "bg-orange-500/10" : "hover:bg-zinc-800"}`}
                    >
                      <HeroAvatar hero={c.name} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] font-semibold ${value === v ? "text-orange-400" : "text-zinc-200"}`}>
                          {c.name}
                          <span className="ml-1.5 text-[10.5px] font-medium text-zinc-500">
                            {p.type} · {p.label}
                          </span>
                        </span>
                        <span className="block truncate text-[11.5px] leading-snug text-zinc-400">{c.profile.role || "Karakter buatanmu"}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[9.5px] font-extrabold text-orange-400">MILIKMU</span>
                    </button>
                  );
                })}
              </div>
            )}
            {byGroup.map(({ g, list }) => (
              <div key={g}>
                <div className="mx-1 mb-1 mt-2 rounded-lg px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wider" style={{ background: GROUPS[g].soft, color: GROUPS[g].color }}>
                  {GROUPS[g].icon} {GROUPS[g].name} <span className="font-medium normal-case tracking-normal opacity-80">· {GROUPS[g].desc}</span>
                </div>
                {list.map((o) => (
                  <Row key={o.hero} o={o} />
                ))}
              </div>
            ))}
            {!ready && <p className="px-2.5 py-2 text-[12px] text-zinc-500">Server AI belum tersambung.</p>}
            {ready && !opts.length && (
              <p className="px-2.5 py-2 text-[12px] text-zinc-500">
                {loadError === "loading" ? "Memuat daftar hero…" : `Daftar hero belum terbaca${loadError ? ` (${loadError})` : ""} — pakai Layla dulu.`}{" "}
                {loadError !== "loading" && (
                  <button type="button" onClick={onReload} className="font-semibold text-orange-400 hover:underline">
                    Muat ulang
                  </button>
                )}
              </p>
            )}
          </div>
          <p className="border-t border-zinc-800/80 px-2 pt-2 text-[10.5px] leading-snug text-zinc-500">
            {owner ? "Kalau hero pilihan lagi gagal / kuota habis, otomatis dijawab hero lain yang siap." : "Tiap hero punya karakter & gaya jawab sendiri — pilih yang paling cocok."}
          </p>
        </div>
      )}
    </div>
  );
}

export default function AiChat({
  meId,
  firstName,
  initialConvs,
  initialId,
  initialMsgs,
  setupError,
  defaultModel,
  owner = false,
}: {
  owner?: boolean;
  meId: string;
  firstName: string;
  initialConvs: AiConv[];
  initialId: string | null;
  initialMsgs: AiMsg[];
  setupError: string | null;
  defaultModel: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [convs, setConvs] = useState(initialConvs);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [msgs, setMsgs] = useState<AiMsg[]>(() => initialMsgs.map(normMsg));
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [model, setModel] = useState(defaultModel === "auto" ? SMART : defaultModel || SMART);
  const [models, setModels] = useState<string[]>([]);
  const [best, setBest] = useState<{ text: string | null; image: string | null }>({ text: null, image: null });
  const [status, setStatus] = useState<Record<string, number>>({});
  const [visionList, setVisionList] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const heroOpts = useMemo(() => heroOptions(models, status, visionList), [models, status, visionList]);
  const [ready, setReady] = useState(!setupError);
  const [dataMode, setDataMode] = useState<"auto" | "off">("auto");
  const [webMode, setWebMode] = useState<"auto" | "off">("auto");
  const [webReady, setWebReady] = useState(false);
  const [view, setView] = useState<"chat" | "chars">("chat");
  // mode Cowork: halaman sambutan khusus + kerja di folder laptop
  const [cowork, setCowork] = useState(false);
  // tiap chat baru: user memilih "teman ngobrol" (hero) dulu — boleh langsung ketik juga
  const [heroPicked, setHeroPicked] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  // mode fokus (layar penuh): navbar & daftar riwayat disembunyikan, chat memenuhi jendela. Diingat per browser.
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("cs-ai-focus") === "1") setFocus(true);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("cs-ai-focus", focus ? "1" : "0");
    } catch {}
    if (!focus) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog]")) setFocus(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [focus]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | number | null>(null);
  const [drag, setDrag] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // karakter buatan sendiri (pribadi)
  const [chars, setChars] = useState<CustomChar[]>([]);
  const [charsLoaded, setCharsLoaded] = useState(false);
  const [wizard, setWizard] = useState<"new" | CustomChar | null>(null);
  const [brain, setBrain] = useState<CustomChar | null>(null);
  const [teach, setTeach] = useState<{ id: AiMsg["id"]; kind: MemoryKind; text: string; saving?: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 2600);
  };
  useEffect(() => {
    supabase
      .from("ai_characters")
      .select("id, name, mbti, avatar, profile, created_at")
      .order("created_at")
      .then(({ data }) => {
        const list = (data ?? []) as CustomChar[];
        list.forEach(registerChar);
        setChars(list);
        setCharsLoaded(true);
      });
  }, [supabase]);
  const plainAnswer = (content: string) => {
    const sa = splitAnalysis(splitPlan(splitChart(splitAsk(content).text).text).text);
    return tidyAnswer((sa.card ? `${analysisText(sa.card)}\n\n` : "") + splitMusic(splitReports(splitDeck(splitFilePlan(sa.text).text).text).text).text)
      .replace(/\n---\n🌐[\s\S]*$/, "")
      .trim();
  };
  const questionBefore = (id: AiMsg["id"]) => {
    const i = msgs.findIndex((x) => x.id === id);
    for (let k = i - 1; k >= 0; k--) if (msgs[k].role === "user") return msgs[k].content;
    return "";
  };
  /** simpan ke otak karakter (contoh / koreksi / pengetahuan) dari tombol di bawah jawaban */
  const remember = async (charId: string, kind: MemoryKind, title: string, content: string) => {
    const c = charOf(charId);
    const { error } = await supabase
      .from("ai_character_memory")
      .insert({ character_id: charId, kind, title: title.replace(/\s+/g, " ").trim().slice(0, 200) || null, content: content.slice(0, 60000) });
    if (error) {
      setErr(/ai_character_memory|schema cache/i.test(error.message) ? "Fitur otak belum aktif — admin perlu menjalankan supabase/migration-19-karakter-sendiri.sql." : error.message);
      return false;
    }
    flash(`Tersimpan ke otak ${c?.name ?? "karakter"} ✓`);
    return true;
  };
  const charOf = (id: string | null | undefined) => (id ? chars.find((c) => c.id === id || `${CHAR_PREFIX}${c.id}` === id) : undefined);
  // kartu pertanyaan yang sudah dijawab: jawaban = pesan user "📌 …" tepat sesudahnya
  const cardAnswerAfter = (id: AiMsg["id"]) => {
    const i = msgs.findIndex((x) => x.id === id);
    const nx = i >= 0 ? msgs[i + 1] : undefined;
    return nx?.role === "user" ? parseCardAnswer(nx.content) : null;
  };
  // pesan user "📌 …" yang menjawab kartu tidak perlu ditampilkan lagi sebagai gelembung (sudah ada di kartu)
  const answersCard = (m: AiMsg) => {
    if (m.role !== "user" || !m.content.startsWith("📌") || !parseCardAnswer(m.content)) return false;
    const prev = msgs[msgs.findIndex((x) => x.id === m.id) - 1];
    return !!prev && prev.role === "assistant" && /\[\[ask:|```ask/.test(prev.content);
  };
  const hero = (id: string | null | undefined) => (!id ? SMART_HERO : isCharModel(id) ? (charOf(id)?.name ?? SMART_HERO) : heroName(id));

  // pilihan model & mode data tersimpan di browser
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODEL_KEY);
      if (m) setModel(m);
      if (localStorage.getItem(DATA_KEY) === "off") setDataMode("off");
      if (localStorage.getItem(WEB_KEY) === "off") setWebMode("off");
    } catch {}
    loadModels(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // daftar hero; kalau gagal terbaca (server AI lambat) dicoba sekali lagi otomatis
  const loadModels = (retry = false) => {
    setLoadError("loading");
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j) => {
        setModels(j.models ?? []);
        setBest({ text: j.bestText ?? null, image: j.bestVision ?? null });
        setStatus(j.status ?? {});
        setVisionList(j.visionList ?? []);
        setReady(!!j.ready);
        setLoadError(j.catalogError ?? null);
        setWebReady(!!j.web);
        if (retry && j.ready && !(j.models ?? []).length) setTimeout(() => loadModels(false), 4000);
      })
      .catch(() => setLoadError("koneksi"));
  };
  // karakter yang tersimpan sudah dihapus -> kembali ke Layla otomatis
  useEffect(() => {
    if (charsLoaded && isCharModel(model) && !charOf(model)) pickModel(SMART);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charsLoaded, chars, model]);
  const pickModel = (m: string) => {
    setModel(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {}
  };
  // folder laptop yang dihubungkan (File System Access API, hanya di browser ini — tidak disimpan di server)
  const [folder, setFolder] = useState<Scan | null>(null);
  const [folderBusy, setFolderBusy] = useState(false);
  const [canFolder, setCanFolder] = useState(false);
  useEffect(() => setCanFolder(folderSupported()), []);
  const pickFilesRef = useRef<HTMLInputElement>(null);
  const onPickedFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const first = files[0] as File & { webkitRelativePath?: string };
    const name = first.webkitRelativePath ? first.webkitRelativePath.split("/")[0] : files.length === 1 ? files[0].name : `${files.length} file dipilih`;
    const sc = scanFromFiles(files, name);
    setFolder(sc);
    flash(`💼 Cowork: ${sc.files.length.toLocaleString("id-ID")} file siap dibaca`);
  };
  const connectFolder = async () => {
    // HP / Safari / Firefox: pilih file (baca saja)
    if (!canFolder) return pickFilesRef.current?.click();
    const root = await pickFolder();
    if (!root) return;
    setFolderBusy(true);
    try {
      const sc = await scanFolder(root);
      setFolder(sc);
      flash(`💼 Cowork: ${root.name} terhubung · ${sc.files.length.toLocaleString("id-ID")} file`);
    } catch (e) {
      setErr(`Folder gagal dibaca: ${(e as Error).message}`);
    } finally {
      setFolderBusy(false);
    }
  };
  const rescanFolder = async () => {
    if (!folder) return;
    if (folder.root.readonly) return pickFilesRef.current?.click();
    try {
      setFolder(await scanFolder(folder.root));
    } catch {}
  };
  const toggleWeb = () => {
    const next = webMode === "auto" ? "off" : "auto";
    setWebMode(next);
    try {
      localStorage.setItem(WEB_KEY, next);
    } catch {}
  };
  const toggleData = () => {
    const next = dataMode === "auto" ? "off" : "auto";
    setDataMode(next);
    try {
      localStorage.setItem(DATA_KEY, next);
    } catch {}
  };

  // link sementara untuk gambar di percakapan (bucket privat)
  useEffect(() => {
    const need = [...new Set(msgs.flatMap((m) => m.images ?? []))].filter((p) => !urls[p]);
    if (!need.length) return;
    supabase.storage
      .from(ATTACH_BUCKET)
      .createSignedUrls(need, 3600)
      .then(({ data }) => {
        const add: Record<string, string> = {};
        for (const d of data ?? []) if (d.path && d.signedUrl) add[d.path] = d.signedUrl;
        if (Object.keys(add).length) setUrls((u) => ({ ...u, ...add }));
      });
  }, [msgs, urls, supabase]);

  // gulir ke bawah saat ada isi baru (kecuali user sedang menggulir ke atas)
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // tinggi kolom ketik menyesuaikan isi
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [input]);

  // ---- gambar ----
  const addFiles = useCallback(
    async (files: File[]) => {
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (!imgs.length) return;
      const room = MAX_IMAGES - pending.length;
      if (room <= 0) return setErr(`Maksimal ${MAX_IMAGES} gambar per pesan.`);
      setErr(null);
      for (const f of imgs.slice(0, room)) {
        const key = crypto.randomUUID();
        const preview = URL.createObjectURL(f);
        setPending((p) => [...p, { key, preview, status: "uploading" }]);
        const blob = await shrink(f);
        const path = `${meId}/ai/${key}.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : blob.type === "image/gif" ? "gif" : "jpg"}`;
        // kirim sebagai ArrayBuffer + contentType (sama seperti upload lampiran lain)
        const { error } = await supabase.storage.from(ATTACH_BUCKET).upload(path, await blob.arrayBuffer(), { contentType: blob.type || "image/jpeg", upsert: false });
        setPending((p) => p.map((x) => (x.key === key ? { ...x, status: error ? "error" : "done", path: error ? undefined : path } : x)));
        if (error) setErr(`Gambar gagal di-upload: ${error.message}`);
        else setUrls((u) => ({ ...u, [path]: preview }));
      }
    },
    [pending.length, meId, supabase]
  );
  const uploading = pending.some((p) => p.status === "uploading");

  const setUrl = (id: string | null) => window.history.replaceState(null, "", id ? `/ai?c=${id}` : "/ai");

  const openConv = useCallback(
    async (id: string) => {
      if (busy) abortRef.current?.abort();
      setActiveId(id);
      setUrl(id);
      setSideOpen(false);
      setErr(null);
      setLoadingMsgs(true);
      stick.current = true;
      let r = await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data, persona, character_id").eq("conversation_id", id).order("id");
      if (r.error) r = (await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data, persona").eq("conversation_id", id).order("id")) as typeof r;
      if (r.error) r = (await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data").eq("conversation_id", id).order("id")) as typeof r;
      if (r.error) r = (await supabase.from("ai_messages").select("id, role, content, model, error, created_at").eq("conversation_id", id).order("id")) as typeof r;
      setMsgs(((r.data ?? []) as AiMsg[]).map(normMsg));
      setLoadingMsgs(false);
    },
    [supabase, busy]
  );

  const newChat = () => {
    if (busy) abortRef.current?.abort();
    setActiveId(null);
    setMsgs([]);
    setHeroPicked(false);
    setUrl(null);
    setSideOpen(false);
    setErr(null);
    setTimeout(() => ta.current?.focus(), 50);
  };

  const run = async (content: string, regenerate = false, images: string[] = []) => {
    if (busy || setupError) return;
    setErr(null);
    setBusy(true);
    stick.current = true;
    const tempId = `t${Date.now()}`;
    setMsgs((m) => {
      let base = m;
      if (regenerate) {
        const last = base[base.length - 1];
        if (last?.role === "assistant") base = base.slice(0, -1);
      } else base = [...base, { id: `u${Date.now()}`, role: "user", content, images }];
      return [...base, { id: tempId, role: "assistant", content: "", model: model === SMART ? null : model, character_id: isCharModel(model) ? model.slice(CHAR_PREFIX.length) : null }];
    });
    const ac = new AbortController();
    abortRef.current = ac;
    let convId = activeId;
    try {
      // folder laptop: pindai ulang (selalu terbaru) + baca isi file kalau pertanyaannya butuh
      let folderBody: { name: string; listing: string; contents: string } | null = null;
      if (folder) {
        const prevAsk = [...msgs].reverse().find((x) => x.role === "user" && !x.content.startsWith("📌"))?.content || "";
        // jawaban kartu pertanyaan ("📌 …") -> gabung dengan permintaan aslinya supaya file yang perlu tetap dibaca
        const ask = content.startsWith("📌") ? `${prevAsk}\n${content}` : content || prevAsk;
        let sc = folder.root.readonly ? folder : await scanFolder(folder.root);
        if (/duplikat|kembar|dobel|double|sama persis|ganda/i.test(ask)) sc = { ...sc, dups: await findDuplicates(sc) };
        setFolder(sc);
        const needRead = /\b(isi|baca|rangkum|ringkas|data|laporan|report|ppt|pptx|powerpoint|presentasi|slide|deck|analisa|analisis|hitung|total|grafik|chart|tabel|cek)\w*/i.test(ask);
        folderBody = { name: sc.root.name, listing: listingText(sc), contents: needRead ? await readContents(sc, ask) : "" };
      }
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, content, model, regenerate, images, data: dataMode, web: webMode, folder: folderBody }),
        signal: ac.signal,
      });
      const newId = res.headers.get("x-conversation-id");
      if (newId && newId !== activeId) {
        convId = newId;
        setActiveId(newId);
        setUrl(newId);
        setConvs((cs) => [{ id: newId, title: (content || "Gambar").replace(/\s+/g, " ").slice(0, 60), model, updated_at: new Date().toISOString() }, ...cs]);
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Gagal (${res.status})`);
      }
      // aliran jawaban = teks biasa + bingkai kontrol "\u001e{json}\n" (langkah proses, info hero/model, error)
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      let buf = "";
      let failMsg = "";
      const patch = (f: (x: AiMsg) => AiMsg) => setMsgs((m) => m.map((x) => (x.id === tempId ? f(x) : x)));
      patch((x) => ({ ...x, steps: [], startedAt: Date.now() }));
      const onFrame = (f: Record<string, unknown>) => {
        if (f.t === "step") {
          const st = f as unknown as AiStep & { id?: string };
          const id = st.id || st.k;
          patch((x) => {
            const steps = [...(x.steps ?? [])];
            const i = steps.findIndex((y) => y.id === id);
            const next = { ...(i >= 0 ? steps[i] : {}), ...st, id } as AiStep;
            if (i >= 0) steps[i] = next;
            else steps.push(next);
            // hero yang (akan) menjawab -> kalimat proses & avatar ikut karakternya
            const h = (f as { hero?: unknown }).hero;
            return { ...x, steps, ...(typeof h === "string" && h ? { persona: h } : {}) };
          });
        } else if (f.t === "meta") {
          const used = String(f.model ?? "");
          const switched = !!used && ((model !== SMART && used !== model) || !!f.fallback);
          patch((x) => ({
            ...x,
            model: used || x.model,
            used_data: !!f.data,
            used_web: !!f.web,
            persona: (f.persona as string) || null,
            via: (f.via as string) || null,
            chart: (f.chart as string) || null,
            switched,
            doneAt: Date.now(),
          }));
        } else if (f.t === "error") failMsg = String(f.message ?? "Gagal");
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // pisahkan bingkai kontrol dari teks jawaban
        for (;;) {
          const i = buf.indexOf("\u001e");
          if (i < 0) {
            text += buf;
            buf = "";
            break;
          }
          text += buf.slice(0, i);
          const nl = buf.indexOf("\n", i);
          if (nl < 0) {
            buf = buf.slice(i);
            break;
          }
          try {
            onFrame(JSON.parse(buf.slice(i + 1, nl)));
          } catch {}
          buf = buf.slice(nl + 1);
        }
        const t = text;
        patch((x) => ({ ...x, content: t }));
      }
      if (failMsg) {
        patch((x) => ({ ...x, content: `⚠️ ${failMsg}`, error: true }));
        return;
      }
      if (!text.trim()) setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, content: "Tidak ada jawaban dari model. Coba hero/model lain atau ulangi.", error: true } : x)));
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "Gagal menghubungi AI";
        setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, content: `⚠️ ${msg}`, error: true } : x)));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
      if (convId) {
        const id = convId;
        setConvs((cs) => {
          const c = cs.find((x) => x.id === id);
          return c ? [{ ...c, updated_at: new Date().toISOString() }, ...cs.filter((x) => x.id !== id)] : cs;
        });
      }
    }
  };

  // pesan pertama di chat baru -> popup pilih hero dulu, lalu pesan langsung terkirim dengan hero itu
  const [askHero, setAskHero] = useState<{ text: string; imgs: string[] } | null>(null);
  const [queued, setQueued] = useState<{ text: string; imgs: string[] } | null>(null);
  useEffect(() => {
    if (!queued || busy) return;
    const q = queued;
    setQueued(null);
    run(q.text, false, q.imgs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, model]);
  const chooseHero = (m: string) => {
    if (!askHero) return;
    pickModel(m);
    setHeroPicked(true);
    setQueued(askHero);
    setAskHero(null);
  };
  const send = () => {
    const t = input.trim();
    const imgs = pending.filter((p) => p.status === "done" && p.path).map((p) => p.path!);
    if ((!t && !imgs.length) || busy || uploading) return;
    if (!heroPicked && !activeId && msgs.length === 0 && !cowork) {
      setInput("");
      setPending([]);
      setAskHero({ text: t, imgs });
      return;
    }
    setHeroPicked(true);
    setInput("");
    setPending([]);
    run(t, false, imgs);
  };

  const rename = async (id: string, title: string) => {
    setEditing(null);
    const t = title.trim();
    if (!t) return;
    setConvs((cs) => cs.map((c) => (c.id === id ? { ...c, title: t } : c)));
    const r = await renameConversation(id, t);
    if (r.error) setErr(r.error);
  };
  const remove = async (id: string) => {
    setConfirmDel(null);
    setConvs((cs) => cs.filter((c) => c.id !== id));
    if (id === activeId) newChat();
    const r = await deleteConversation(id);
    if (r.error) setErr(r.error);
  };

  const filtered = convs.filter((c) => !search.trim() || c.title.toLowerCase().includes(search.trim().toLowerCase()));
  const groups: [string, AiConv[]][] = [];
  for (const c of filtered) {
    const g = group(c.updated_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(c);
    else groups.push([g, [c]]);
  }
  const active = convs.find((c) => c.id === activeId);
  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");

  const sidebar = (
    <div className="flex h-full flex-col p-3">
      <button type="button" onClick={newChat} className="btn-primary justify-center">
        + Chat baru
      </button>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari percakapan…" className="input mt-3 py-2 text-[13px]" />
      <div className="mt-3 flex-1 space-y-3 overflow-y-auto pr-1">
        {groups.length === 0 && <p className="px-2 text-[12.5px] text-zinc-500">{search ? "Tidak ketemu." : "Belum ada percakapan."}</p>}
        {groups.map(([g, items]) => (
          <div key={g}>
            <div className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">{g}</div>
            {items.map((c) => (
              <div key={c.id} className={`group flex items-center gap-1 rounded-lg ${c.id === activeId ? "bg-orange-500/10" : "hover:bg-zinc-800/60"}`}>
                {editing === c.id ? (
                  <input
                    autoFocus
                    defaultValue={c.title}
                    onBlur={(e) => rename(c.id, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(c.id, (e.target as HTMLInputElement).value);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="input m-0.5 py-1 text-[13px]"
                    aria-label="Judul percakapan"
                  />
                ) : confirmDel === c.id ? (
                  <div className="flex w-full items-center gap-2 px-2 py-1.5 text-[12.5px]">
                    <span className="flex-1 truncate text-red-400">Hapus “{c.title}”?</span>
                    <button type="button" onClick={() => remove(c.id)} className="font-semibold text-red-400 hover:underline">
                      Hapus
                    </button>
                    <button type="button" onClick={() => setConfirmDel(null)} className="text-zinc-500 hover:underline">
                      Batal
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => openConv(c.id)}
                      className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-[13px] ${c.id === activeId ? "font-semibold text-orange-400" : "text-zinc-300"}`}
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    <button type="button" onClick={() => setEditing(c.id)} className="hidden px-1 text-[12px] text-zinc-500 hover:text-zinc-200 group-hover:block" aria-label="Ganti nama" title="Ganti nama">
                      ✎
                    </button>
                    <button type="button" onClick={() => setConfirmDel(c.id)} className="hidden pr-2 text-[12px] text-zinc-500 hover:text-red-400 group-hover:block" aria-label="Hapus percakapan" title="Hapus">
                      🗑
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-zinc-800/80 pt-2 text-[11.5px] text-zinc-500">🔒 Percakapan & gambar hanya bisa dilihat kamu sendiri</div>
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
      className={`rounded-2xl border bg-zinc-900 p-2.5 transition ${drag ? "border-orange-500" : "border-zinc-800"}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {pending.map((p) => (
            <span key={p.key} className="relative h-16 w-16 overflow-hidden rounded-lg ring-1 ring-zinc-800">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt="Lampiran" className={`h-full w-full object-cover ${p.status !== "done" ? "opacity-50" : ""}`} />
              {p.status === "uploading" && <span className="absolute inset-0 m-auto h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-orange-500" />}
              {p.status === "error" && <span className="absolute inset-x-0 bottom-0 bg-red-600/90 text-center text-[9px] font-semibold text-white">gagal</span>}
              <button
                type="button"
                onClick={() => setPending((x) => x.filter((y) => y.key !== p.key))}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-zinc-950/85 text-[10px] text-white"
                aria-label="Hapus gambar"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={ta}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files ?? []).filter((f) => f.type.startsWith("image/"));
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder={setupError ? "AI belum tersambung" : "Tanya apa aja… (Ctrl+V buat tempel screenshot)"}
        disabled={!!setupError}
        className="block max-h-[220px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-500"
        aria-label="Tulis pesan ke AI"
      />
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!setupError}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-800 text-[15px] hover:border-zinc-600 disabled:opacity-40"
          title="Lampirkan gambar (maks 4)"
          aria-label="Lampirkan gambar"
        >
          📎
        </button>
        <button
          type="button"
          onClick={toggleData}
          className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
            dataMode === "auto" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-zinc-800 text-zinc-500"
          }`}
          title={dataMode === "auto" ? "AI otomatis membaca data CS Tracker kalau pertanyaannya soal issue / laporan / video review / catatan. Klik untuk mematikan." : "AI tidak membaca data CS Tracker. Klik untuk menyalakan."}
          aria-pressed={dataMode === "auto"}
        >
          <span className="sm:hidden">📊 Data{dataMode === "auto" ? "" : " off"}</span>
          <span className="hidden sm:inline">📊 Data CS Tracker: {dataMode === "auto" ? "Otomatis" : "Off"}</span>
        </button>
        {webReady && (
          <button
            type="button"
            onClick={toggleWeb}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
              webMode === "auto" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-zinc-800 text-zinc-500"
            }`}
            title={
              webMode === "auto"
                ? "AI otomatis cari di internet kalau pertanyaannya soal hal terbaru (hari ini, harga, berita, dll) atau ada link yang ditempel. Klik untuk mematikan."
                : "AI tidak mencari di internet. Klik untuk menyalakan."
            }
            aria-pressed={webMode === "auto"}
          >
            <span className="sm:hidden">🌐 Internet{webMode === "auto" ? "" : " off"}</span>
            <span className="hidden sm:inline">🌐 Internet: {webMode === "auto" ? "Otomatis" : "Off"}</span>
          </button>
        )}
        <ModelPicker owner={owner} chars={chars} value={model} onChange={pickModel} models={models} ready={ready} vision={best} status={status} visionList={visionList} loadError={loadError} onReload={() => loadModels(false)} />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="ml-auto flex h-9 items-center gap-1.5 rounded-xl border border-zinc-700 px-3 text-[13px] font-semibold" aria-label="Berhenti">
            ■ Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={(!input.trim() && !pending.some((p) => p.status === "done")) || uploading || !!setupError}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl text-white disabled:opacity-40"
            style={{ backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)" }}
            aria-label="Kirim"
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 19V5M5 12l7-7 7 7" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div
      className={
        focus
          ? "fixed inset-0 z-[60] flex overflow-hidden bg-zinc-900"
          : "card card-plain relative flex h-[calc(100dvh-200px)] min-h-[460px] overflow-hidden p-0 max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 md:h-[calc(100dvh-150px)]"
      }
    >
      {/* daftar percakapan: desktop di kiri, HP (dan mode fokus) lewat tombol ☰ */}
      {!focus && <aside className="hidden w-64 shrink-0 border-r border-zinc-800/80 md:block">{sidebar}</aside>}
      {sideOpen && (
        <div className={`absolute inset-0 z-30 flex ${focus ? "" : "md:hidden"}`}>
          <div className="w-[82%] max-w-[300px] border-r border-zinc-800 bg-zinc-900">{sidebar}</div>
          <button type="button" className="flex-1 bg-black/30" onClick={() => setSideOpen(false)} aria-label="Tutup daftar" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
          <button type="button" onClick={() => setSideOpen(true)} className={`rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800 ${focus ? "" : "md:hidden"}`} aria-label="Daftar percakapan">
            ☰
          </button>
          <span className="flex shrink-0 rounded-full border border-zinc-800 p-0.5 text-[12px] font-semibold">
            <button type="button" onClick={() => { setView("chat"); setCowork(false); }} className={`rounded-full px-2.5 py-1 ${view === "chat" && !cowork ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`} aria-pressed={view === "chat" && !cowork}>
              💬 Chat
            </button>
            {(
              <span className="group relative flex items-center">
                <input ref={pickFilesRef} type="file" multiple className="hidden" accept=".csv,.tsv,.xlsx,.txt,.md,.json,.srt,.html,text/*,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { onPickedFiles(e.target.files); e.target.value = ""; }} />
                <button
                  type="button"
                  onClick={() => {
                    setView("chat");
                    if (!cowork) {
                      newChat();
                      setCowork(true);
                    } else if (folder) rescanFolder();
                    else connectFolder();
                  }}
                  disabled={folderBusy || !!setupError}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${cowork && view === "chat" ? "bg-violet-500/15 text-violet-400" : folder ? "text-violet-400" : "text-zinc-500 hover:text-zinc-300"}`}
                  aria-label="Cowork: AI kerja langsung di folder laptop kamu"
                >
                  {folderBusy ? "⏳" : "💼"}
                  <span className="hidden max-w-[110px] truncate sm:inline">{folder ? folder.root.name : "Cowork"}</span>
                  <span className="sm:hidden">{folder ? "" : "Cowork"}</span>
                </button>
                {folder && (
                  <button type="button" onClick={() => setFolder(null)} className="-ml-1 rounded-full px-1.5 py-1 text-violet-400 hover:text-red-400" aria-label="Putuskan folder" title="Putuskan folder">
                    ✕
                  </button>
                )}
                <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden w-[230px] -translate-x-1/2 rounded-xl bg-zinc-100 px-3 py-2 text-[11.5px] font-medium leading-snug text-zinc-900 shadow-lg sm:group-hover:block">
                  <b>💼 Cowork</b> — AI bantu kerja langsung di folder laptop kamu: rapihin file, ganti nama, cari duplikat, baca Excel/CSV & bikin laporan PPT.
                  <span className="mt-1 block text-zinc-500">
                    {folder ? `Terhubung: ${folder.root.name} · ${folder.files.length.toLocaleString("id-ID")} file. Klik untuk baca ulang.` : canFolder ? "Klik untuk pilih folder." : "Di HP: pilih file Excel / CSV / teks untuk dibaca & dibikin laporan."}
                  </span>
                </span>
              </span>
            )}
            <button type="button" onClick={() => setView("chars")} className={`rounded-full px-2.5 py-1 ${view === "chars" ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`} aria-pressed={view === "chars"}>
              🎭<span className="hidden sm:inline"> Karakter</span>
            </button>
          </span>
          <button type="button" onClick={() => setWizard("new")} disabled={!!setupError} className="mkchar disabled:opacity-50" title="Bikin karakter AI versimu sendiri" aria-label="Buat karakter AI">
            <span className="mkchar-shine" aria-hidden />
            <span className="mkchar-av" aria-hidden>
              <HeroArt hero={BTN_CHIBI} size={30} still />
            </span>
            <span>
              <span className="hidden sm:inline">✨ Buat Karakter AI</span>
              <span className="sm:hidden">＋</span>
            </span>
            <span className="mkchar-new hidden sm:inline">BARU</span>
          </button>
          <span className="mkchar-tip hidden lg:inline">Bikin AI versimu! 👀</span>
          <span className="hidden truncate font-semibold md:inline">{view === "chars" ? "Karakter AI" : (active?.title ?? "Chat baru")}</span>
          <span className="ml-auto flex shrink-0 items-center gap-3 text-[12px] text-zinc-500">
            {active && view === "chat" && (
              <>
                <button type="button" onClick={() => { setSideOpen(true); setEditing(active.id); }} className="hover:text-zinc-200">
                  ✎<span className="hidden sm:inline"> Ganti nama</span>
                </button>
                <button type="button" onClick={() => { setSideOpen(true); setConfirmDel(active.id); }} className="hover:text-red-400">
                  🗑<span className="hidden sm:inline"> Hapus</span>
                </button>
              </>
            )}
            {owner && (
              <a href="/ai/usage" className="rounded-lg border border-zinc-800 px-2 py-1 font-semibold hover:border-zinc-600 hover:text-zinc-200" title="Pemakaian AI (khusus pemilik)">
                📊<span className="hidden sm:inline"> Usage</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setFocus((v) => !v)}
              title={focus ? "Keluar dari layar penuh (Esc)" : "Layar penuh"}
              aria-pressed={focus}
              className={`rounded-lg border px-2 py-1 font-semibold ${focus ? "border-orange-500/40 bg-orange-500/10 text-orange-400" : "border-zinc-800 hover:border-zinc-600 hover:text-zinc-200"}`}
            >
              {focus ? "✕" : "⛶"}
              <span className="hidden sm:inline">{focus ? " Keluar" : " Layar penuh"}</span>
            </button>
          </span>
        </header>

        {setupError && <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12.5px] text-amber-400">{setupError}</div>}
        {err && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-[12.5px] text-red-400">{err}</div>}

        {view === "chars" ? (
          <HeroGallery
            owner={owner}
            chars={chars}
            onNewChar={() => setWizard("new")}
            onEditChar={(c) => setWizard(c)}
            onBrain={(c) => setBrain(c)}
            onDeleteChar={async (c) => {
              setChars((x) => x.filter((y) => y.id !== c.id));
              const { error } = await supabase.from("ai_characters").delete().eq("id", c.id);
              if (error) {
                setErr(error.message);
                setChars((x) => [...x, c]);
              } else flash(`${c.name} dihapus`);
            }}
            opts={heroOpts}
            value={model}
            ready={ready}
            onChecked={() => loadModels(false)}
            onPick={(m) => {
              pickModel(m);
              setView("chat");
              setTimeout(() => ta.current?.focus(), 50);
            }}
          />
        ) : msgs.length === 0 && !loadingMsgs && cowork ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <div className="relative">
              <HeroArt hero={hero(model)} size={104} title={hero(model)} />
              <span className="absolute -right-3 top-2 animate-bounce text-[26px]">💼</span>
            </div>
            <h2 className="mt-2 font-display text-[22px] font-bold">Selamat datang di Cowork, {firstName}! 👋</h2>
            <p className="mt-1 max-w-[560px] text-[13.5px] text-zinc-400">
              {canFolder
                ? `Di sini ${hero(model)} bisa ikut kerja langsung di folder laptop kamu. Semua perubahan kamu cek dulu sebelum dijalankan, dan file tetap di laptop kamu.`
                : `Pilih file Excel / CSV / teks dari HP, ${hero(model)} bantu rangkum & bikin laporan PPT atau report. Rapihin folder cukup dari laptop (Chrome / Edge).`}
            </p>
            {folder ? (
              <p className="mt-3 rounded-full bg-violet-500/10 px-3 py-1 text-[12.5px] font-semibold text-violet-400">
                💼 {folder.root.readonly ? "File siap" : "Folder terhubung"}: {folder.root.name} · {folder.files.length.toLocaleString("id-ID")} file
              </p>
            ) : (
              <button type="button" onClick={connectFolder} disabled={folderBusy} className="mt-3 rounded-xl bg-violet-600 px-4 py-2 text-[13px] font-bold text-white hover:bg-violet-500 disabled:opacity-60">
                {folderBusy ? "Membaca folder…" : canFolder ? "📁 Pilih folder dulu" : "📎 Pilih file"}
              </button>
            )}
            {!folder && canFolder && <p className="mt-1 text-[11px] text-zinc-500">Pilih subfolder (bukan Downloads/Documents/Desktop langsung)</p>}
            <div className="mt-5 grid w-full max-w-[640px] grid-cols-2 gap-2 text-left text-[12px] sm:text-[13px]">
              {[
                { icon: "📊", t: "Data mentah → PPT laporan rapi", d: "Excel/CSV per divisi jadi slide gaya Konten.com", p: "Bikinin PPT laporan dari data di folder ini, per divisi, lengkap grafik & kesimpulan" },
                { icon: "🖼️", t: "Report campaign siap kirim", d: "Halaman Campaign Performance (PNG)", p: "Bikinin report campaign dari data di folder ini" },
                { icon: "🗂️", lap: true, t: "Rapihin folder berantakan", d: "Pisah per jenis / bulan, otomatis", p: "Rapihin folder ini per jenis file, screenshot pisahin per bulan" },
                { icon: "🔁", lap: true, t: "Cari & beresin file dobel", d: "Duplikat dipindah ke _Duplikat", p: "Cari file duplikat di folder ini dan pindahin ke _Duplikat" },
                { icon: "✏️", lap: true, t: "Ganti nama massal", d: "Hapus (1), samakan format tanggal", p: "Rapihin nama file: hapus (1) (2), kasih format tanggal di depan" },
                { icon: "📈", t: "Rangkum isi Excel / CSV", d: "Total, rata-rata, temuan penting", p: "Rangkum isi file data di folder ini: total, tren, dan temuan penting" },
              ].map((x) => (
                <button
                  key={x.t}
                  type="button"
                  disabled={!canFolder && "lap" in x}
                  onClick={() => {
                    setInput(x.p);
                    if (!folder) connectFolder();
                    setTimeout(() => ta.current?.focus(), 30);
                  }}
                  className="rounded-xl border border-zinc-800 px-3 py-2.5 text-left transition hover:border-violet-500/50 hover:bg-violet-500/5 disabled:opacity-45"
                >
                  <span className="block font-semibold text-zinc-200">
                    {x.icon} {x.t}
                  </span>
                  <span className="block text-[11.5px] text-zinc-500">{!canFolder && "lap" in x ? "khusus laptop (Chrome / Edge)" : x.d}</span>
                </button>
              ))}
            </div>
            <div className="mt-6 w-full max-w-[680px]">{composer}</div>
          </div>
        ) : false ? (
          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto w-full max-w-[760px]">
              <h2 className="font-display text-[21px] font-bold sm:text-[24px]">Halo {firstName} 👋</h2>
              <p className="mt-0.5 text-[13px] text-zinc-500">Mau ditemani siapa hari ini? Tiap hero punya gaya ngobrol sendiri — atau langsung ketik aja di bawah.</p>
              <button
                type="button"
                onClick={() => {
                  pickModel(SMART);
                  setHeroPicked(true);
                }}
                className={`mt-3 flex w-full items-center gap-3 rounded-2xl border-[1.5px] px-3 py-2 text-left transition ${model === SMART ? "border-orange-500 bg-orange-500/10" : "border-orange-500/40 hover:bg-orange-500/5"}`}
              >
                <span className="flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden">
                  <HeroArt hero={SMART_HERO} size={52} />
                </span>
                <span>
                  <b className="block text-[14px]">Layla · pilihkan otomatis</b>
                  <span className="text-[12px] text-zinc-500">Aku pilih hero yang paling cocok untuk tiap pertanyaan</span>
                </span>
              </button>
              <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {[
                  ...chars.map((c) => ({ hero: c.name, model: `${CHAR_PREFIX}${c.id}`, mine: true })),
                  ...[...heroOpts].sort((a, b) => a.status - b.status || a.hero.localeCompare(b.hero)).map((o) => ({ hero: o.hero, model: o.model, mine: false })),
                ]
                  .slice(0, 11)
                  .map((o) => {
                    const p = personaOf(o.hero);
                    const g = GROUPS[p.group];
                    const on = model === o.model;
                    return (
                      <button
                        key={o.model}
                        type="button"
                        onClick={() => {
                          pickModel(o.model);
                          setHeroPicked(true);
                          setTimeout(() => ta.current?.focus(), 50);
                        }}
                        className="flex flex-col rounded-2xl border px-2.5 pb-2.5 pt-1.5 text-left transition hover:-translate-y-0.5"
                        style={{ background: g.soft, borderColor: on ? "#f97316" : `${g.color}44` }}
                      >
                        <span className="flex h-[66px] items-end justify-center">
                          <HeroArt hero={o.hero} size={68} />
                        </span>
                        <b className="text-[13.5px] leading-tight">
                          {o.hero}
                          {o.mine && <span className="ml-1 text-[9.5px] font-extrabold text-orange-400">MILIKMU</span>}
                        </b>
                        <span className="text-[12px] font-extrabold" style={{ color: g.color }}>
                          {p.label}
                        </span>
                        <span className="line-clamp-2 text-[11px] leading-snug text-zinc-500">{p.tag}</span>
                      </button>
                    );
                  })}
              </div>
              <button type="button" onClick={() => setView("chars")} className="mt-3 w-full text-center text-[12.5px] font-bold text-orange-400 hover:underline">
                Lihat semua hero & kepribadiannya ›
              </button>
            </div>
            <div className="mx-auto mt-4 w-full max-w-[760px]">{composer}</div>
          </div>
        ) : msgs.length === 0 && !loadingMsgs ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <HeroArt hero={hero(model)} size={92} title={hero(model)} />
            <h2 className="mt-2 font-display text-[22px] font-bold">Halo {firstName}, mau ngobrol apa?</h2>
            <button type="button" onClick={() => setView("chars")} className="mt-1 text-[12px] font-semibold text-orange-400 hover:underline">
              {hero(model)} · {personaOf(hero(model)).type} {personaOf(hero(model)).label} — ganti karakter 🎭
            </button>
            <p className="mt-1 text-[13px] text-zinc-500">Tanya bebas, kirim screenshot / chart trading, atau tanya isi CS Tracker.</p>
            <div className="mt-5 grid w-full max-w-[600px] grid-cols-2 gap-2 text-left text-[12px] sm:text-[13px]">
              {SUGGEST.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  disabled={!!setupError}
                  onClick={() => {
                    if (s.send) return run(s.prompt);
                    setInput(s.prompt);
                    if (s.pick) fileRef.current?.click();
                    setTimeout(() => ta.current?.focus(), 30);
                  }}
                  className="rounded-xl border border-zinc-800 px-3 py-2.5 text-left text-zinc-300 transition hover:border-orange-500/50 hover:bg-orange-500/5 disabled:opacity-50"
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
            <div className="mt-6 w-full max-w-[680px]">{composer}</div>
          </div>
        ) : (
          <>
            <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
              {loadingMsgs ? (
                <p className="text-center text-[13px] text-zinc-500">Memuat…</p>
              ) : (
                <div className="mx-auto max-w-[720px] space-y-6">
                  {msgs.map((m) =>
                    answersCard(m) ? null : m.role === "user" ? (
                      <div key={m.id} className="flex flex-col items-end gap-1.5">
                        {(m.images?.length ?? 0) > 0 && (
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {m.images!.map((p) =>
                              urls[p] ? (
                                <button key={p} type="button" onClick={() => setZoom(urls[p])} className="overflow-hidden rounded-2xl ring-1 ring-zinc-800">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={urls[p]} alt="Gambar terkirim" className="h-32 w-auto max-w-[240px] object-cover" />
                                </button>
                              ) : (
                                <span key={p} className="flex h-32 w-40 items-center justify-center rounded-2xl bg-zinc-800 text-[12px] text-zinc-500">
                                  🖼️ gambar
                                </span>
                              )
                            )}
                          </div>
                        )}
                        {m.content && (
                          <div
                            className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-white"
                            style={{ backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)" }}
                          >
                            {m.content}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div key={m.id} className="flex gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-full bg-orange-500/10">
                          <HeroArt hero={m.persona || hero(m.model ?? model)} size={42} talk={busy && m.id === lastAssistant?.id} still={!(busy && m.id === lastAssistant?.id)} />
                        </span>
                        <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-zinc-200">
                          {/* keterangan penjawab (hero per jawaban — ganti hero di tengah chat tidak mengubah jawaban lama) + badge sumber data */}
                          {(m.persona || m.model) && !m.error && <HelperLine hero={m.persona || hero(m.model)} via={m.via} />}
                          {(m.used_data || m.used_web || m.content?.includes("🌐 **Sumber:**")) && !m.error && (
                            <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                              {m.used_data && <span className="inline-block shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">📊 pakai data CS Tracker</span>}
                              {(m.used_web || m.content?.includes("🌐 **Sumber:**")) && (
                                <span className="inline-block shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-400">🌐 pakai internet</span>
                              )}
                            </div>
                          )}
                          {m.content ? (
                            m.error ? (
                              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{m.content.replace(/^⚠️\s*/, "⚠️ ")}</div>
                            ) : (
                              (() => {
                                const streaming = busy && m.id === lastAssistant?.id;
                                // kotak pertanyaan pendekatan analisa
                                const sk = splitAsk(m.content);
                                if (sk.ask) {
                                  return (
                                    <>
                                      {!!m.steps?.length && (
                                        <ThinkingSteps hero={m.persona || hero(m.model ?? model)} steps={m.steps} live={false} startedAt={m.startedAt} doneAt={m.doneAt} />
                                      )}
                                      {(() => {
                                        const ans = cardAnswerAfter(m.id);
                                        return ans ? <AnsweredCard title={sk.text} answer={ans} /> : <AskCard title={sk.text} info={sk.ask} disabled={busy || m.id !== lastAssistant?.id} onSubmit={(t) => run(t)} />;
                                      })()}
                                    </>
                                  );
                                }
                                const sc = splitChart(m.content);
                                const chart = sc.chart || m.chart;
                                const sp = splitPlan(sc.text);
                                const sa0 = splitAnalysis(sp.text);
                                const fp = splitFilePlan(sa0.text);
                                const dk0 = splitDeck(fp.text);
                                const rp = splitReports(dk0.text);
                                const mu = splitMusic(rp.text);
                                // kartu pertanyaan balik dari AI (```ask)
                                const ch = splitChoice(mu.text);
                                const dk = { ...dk0, partial: dk0.partial || rp.partial };
                                const sa = { ...sa0, text: ch.text };
                                const short = sa.text.replace(/\n---\n🌐[\s\S]*$/, "").length < 700;
                                return (
                                  <>
                                    {!!m.steps?.length && (
                                      <ThinkingSteps hero={m.persona || hero(m.model ?? model)} steps={m.steps} live={false} startedAt={m.startedAt} doneAt={m.doneAt} />
                                    )}
                                    {/* chart dulu, tabel/kartu analisa di bawahnya */}
                                    {chart && sp.plan && !streaming ? (
                                      <TradePlanChart symbol={chart} plan={sp.plan} persona={m.persona || hero(m.model)} />
                                    ) : chart ? (
                                      <TradingChart symbol={chart} />
                                    ) : null}
                                    {sa.card && (
                                      <AnalysisCard
                                        card={sa.card}
                                        onDetail={
                                          short && !streaming
                                            ? () => run(`📌 Detail lengkap analisa ${sa.card?.symbol ?? (chart ?? "").replace(/^[A-Z_]+:/, "")} · TF ${sa.card?.timeframe ?? sp.plan?.timeframe ?? "1D"}`)
                                            : undefined
                                        }
                                      />
                                    )}
                                    <Markdown text={tidyAnswer(sa.text)} />
                                    {(fp.partial || dk.partial) && streaming && <p className="mt-2 text-[12.5px] text-zinc-500">⏳ Menyusun {fp.partial ? "rencana file" : rp.partial ? "halaman report" : "slide laporan"}…</p>}
                                    {fp.plan && !streaming && <FilePlanCard plan={fp.plan} scan={folder} onConnect={connectFolder} onChanged={rescanFolder} />}
                                    {dk.deck && !streaming && <DeckCard deck={dk.deck} root={folder?.root ?? null} />}
                                    {!streaming && rp.reports.map((r, ri) => <ReportCard key={ri} report={r} root={folder?.root ?? null} />)}
                                    {ch.partial && streaming && <p className="mt-2 text-[12.5px] text-zinc-500">⏳ Menyiapkan pilihan…</p>}
                                    {ch.choice &&
                                      !streaming &&
                                      (() => {
                                        const ans = cardAnswerAfter(m.id);
                                        return ans ? <AnsweredCard title={ch.choice.title} answer={ans} /> : <ChoiceCard choice={ch.choice} disabled={busy || m.id !== lastAssistant?.id} onSubmit={(t) => run(t)} />;
                                      })()}
                                    {mu.cmd && !streaming && <MusicCmdCard id={String(m.id)} cmd={mu.cmd} fresh={m.id === lastAssistant?.id && !!m.doneAt && Date.now() - m.doneAt < 90000} />}
                                  </>
                                );
                              })()
                            )
                          ) : (
                            <ThinkingSteps hero={m.persona || hero(m.model ?? model)} steps={m.steps ?? []} live startedAt={m.startedAt} />
                          )}
                          {m.content && !(busy && m.id === lastAssistant?.id) && (
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-zinc-500">
                              {!m.error && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigator.clipboard?.writeText(
                                      (() => {
                                        const sa = splitAnalysis(splitPlan(splitChart(splitAsk(m.content).text).text).text);
                                        return tidyAnswer((sa.card ? `${analysisText(sa.card)}\n\n` : "") + splitChoice(splitMusic(splitReports(splitDeck(splitFilePlan(sa.text).text).text).text).text).text);
                                      })()
                                    ).then(() => {
                                      setCopied(m.id);
                                      setTimeout(() => setCopied(null), 1500);
                                    })
                                  }
                                  className="hover:text-zinc-200"
                                >
                                  {copied === m.id ? "✓ Tersalin" : "⧉ Salin"}
                                </button>
                              )}
                              {m.id === lastAssistant?.id && !busy && (
                                <button type="button" onClick={() => run("", true)} className="hover:text-zinc-200">
                                  ↻ Ulangi
                                </button>
                              )}
                              {m.model && (() => {
                                const ph = m.persona || hero(m.model);
                                const engine = hero(m.model);
                                // nama & tipe hero sudah tampil di atas jawaban — di sini cuma info mesin untuk pemilik
                                if (!owner || engine === ph) return null;
                                return (
                                  <span>
                                    {personaOf(ph).custom && <span className="text-zinc-500">· mesin {engine}</span>}
                                    {owner && engine !== ph && !personaOf(ph).custom && (
                                      <span className="text-zinc-500" title={`${ph} lagi gagal / kuota habis, jadi jawaban ini dibantu ${engine} — gaya jawab tetap ${ph}.`}>
                                        · ↪ dibantu {engine}
                                      </span>
                                    )}
                                  </span>
                                );
                              })()}
                              {!m.error && m.character_id && charOf(m.character_id) && (
                                <span className="flex items-center gap-2.5">
                                  <span className="text-zinc-700">|</span>
                                  <button
                                    type="button"
                                    title="Bagus — simpan sebagai contoh jawaban"
                                    className="hover:text-emerald-400"
                                    onClick={() => {
                                      const qx = questionBefore(m.id);
                                      remember(m.character_id!, "example", qx.slice(0, 120), `Pertanyaan: ${qx.slice(0, 2000)}\nJawaban ideal: ${plainAnswer(m.content).slice(0, 6000)}`);
                                    }}
                                  >
                                    👍
                                  </button>
                                  <button type="button" title="Kurang pas — kasih tahu apa yang salah" className="hover:text-red-400" onClick={() => setTeach({ id: m.id, kind: "correction", text: "" })}>
                                    👎
                                  </button>
                                  <button
                                    type="button"
                                    title="Simpan isi jawaban ini ke pengetahuan karakter"
                                    className="hover:text-zinc-200"
                                    onClick={() => setTeach({ id: m.id, kind: "knowledge", text: plainAnswer(m.content).slice(0, 8000) })}
                                  >
                                    🧠 Ingat ini
                                  </button>
                                  <button type="button" title="Koreksi jawaban ini" className="hover:text-zinc-200" onClick={() => setTeach({ id: m.id, kind: "correction", text: "" })}>
                                    ✎ Koreksi
                                  </button>
                                </span>
                              )}
                            </div>
                          )}
                          {teach && teach.id === m.id && m.character_id && (
                            <div className="mt-2 space-y-2 rounded-xl border border-zinc-800 p-2.5">
                              <div className="text-[12px] font-semibold text-zinc-300">
                                {teach.kind === "correction"
                                  ? `✎ Apa yang harus diperbaiki? ${charOf(m.character_id)?.name ?? "Karakter"} akan mengikuti koreksi ini di chat berikutnya.`
                                  : `🧠 Simpan ke pengetahuan ${charOf(m.character_id)?.name ?? "karakter"} (boleh diedit / dipersingkat dulu):`}
                              </div>
                              <textarea
                                autoFocus
                                value={teach.text}
                                onChange={(e) => setTeach({ ...teach, text: e.target.value })}
                                rows={teach.kind === "correction" ? 3 : 6}
                                placeholder={teach.kind === "correction" ? "mis. Payout cair 1–3 hari kerja, bukan hari itu juga. Jangan pakai kata 'pasti'." : ""}
                                className="input resize-y py-1.5 text-[13px]"
                              />
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setTeach(null)} className="rounded-lg border border-zinc-800 px-3 py-1.5 text-[12px] font-bold text-zinc-300">
                                  Batal
                                </button>
                                <button
                                  type="button"
                                  disabled={!teach.text.trim() || teach.saving}
                                  onClick={async () => {
                                    setTeach({ ...teach, saving: true });
                                    const qx = questionBefore(m.id);
                                    const ok =
                                      teach.kind === "correction"
                                        ? await remember(
                                            m.character_id!,
                                            "correction",
                                            qx.slice(0, 120),
                                            `Saat ditanya: "${qx.slice(0, 600)}"\nJawaban sebelumnya (kurang pas): ${plainAnswer(m.content).slice(0, 500)}…\nKOREKSI: ${teach.text.trim()}`
                                          )
                                        : await remember(m.character_id!, "knowledge", qx.slice(0, 120) || "Dari chat", teach.text.trim());
                                    setTeach(ok ? null : { ...teach, saving: false });
                                  }}
                                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                                >
                                  {teach.saving ? "Menyimpan…" : "Simpan ke otak"}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}
            </div>
            <div className="mx-auto w-full max-w-[760px] px-3 pb-3 sm:px-4 sm:pb-4">{composer}</div>
          </>
        )}
      </div>

      {askHero && (
        <div className="hp-back fixed inset-0 z-[75] flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Pilih teman ngobrol">
          <div className="hp-card flex max-h-[86dvh] w-full max-w-[460px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900" style={{ boxShadow: "var(--shadow-pop), 0 30px 60px -20px rgba(0,0,0,.35)" }}>
            <div className="border-b border-zinc-800/80 px-4 pb-3 pt-4">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[17px] font-bold">Hai {firstName} 👋 hari ini mau ditemani siapa?</div>
                  <div className="text-[12px] text-zinc-400">Pilih teman yang gayanya paling pas buat kamu — atau biar Layla yang pilihkan.</div>
                  <div className="mt-1 line-clamp-1 text-[11.5px] italic text-zinc-500">Pesanmu: “{askHero.text || "gambar"}”</div>
                </div>
                <button type="button" onClick={() => chooseHero(model)} className="shrink-0 rounded-lg px-2 py-1 text-[12px] font-semibold text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
                  Lewati ›
                </button>
              </div>
            </div>
            <div className="overflow-y-auto p-2">
              <button type="button" onClick={() => chooseHero(SMART)} className="flex w-full items-center gap-3 rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2.5 text-left hover:border-orange-500">
                <span className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-[10px] bg-orange-500/15">
                  <HeroArt hero={SMART_HERO} size={44} still />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-orange-400">Layla · pilihkan otomatis</span>
                  <span className="block text-[11.5px] leading-snug text-zinc-400">Layla bukan hero yang menjawab — dia yang memilihkan hero paling cocok untuk tiap pertanyaanmu.</span>
                </span>
              </button>
              {chars.length > 0 && (
                <div>
                  <div className="mx-1 mb-1 mt-2.5 text-[10.5px] font-extrabold uppercase tracking-wider text-zinc-500">Karakter buatanmu</div>
                  {chars.map((c) => {
                    const p = personaOf(c.name);
                    const g = GROUPS[p.group];
                    return (
                      <button key={c.id} type="button" onClick={() => chooseHero(`${CHAR_PREFIX}${c.id}`)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800">
                        <span className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-[10px] border" style={{ background: g.soft, borderColor: `${g.color}55` }}>
                          <HeroArt hero={c.name} size={40} still />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-[13px] font-semibold text-zinc-200">{c.name}</span>{" "}
                          <span className="rounded-full px-1.5 py-px text-[10.5px] font-bold" style={{ background: g.soft, color: g.color }}>{p.label}</span>
                          <span className="block truncate text-[11.5px] text-zinc-400">{c.profile.role || p.tag}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {(Object.keys(GROUPS) as PGroup[]).map((gk) => {
                const list = heroOpts.filter((o) => personaOf(o.hero).group === gk).sort((a, b) => a.hero.localeCompare(b.hero));
                if (!list.length) return null;
                const G = GROUPS[gk];
                return (
                  <div key={gk}>
                    <div className="mx-1 mb-1 mt-2.5 rounded-lg px-2 py-1 text-[10.5px] font-extrabold uppercase tracking-wider" style={{ background: G.soft, color: G.color }}>
                      {G.icon} {G.name} <span className="font-medium normal-case tracking-normal opacity-80">· {G.desc}</span>
                    </div>
                    {list.map((o) => {
                      const p = personaOf(o.hero);
                      return (
                        <button key={o.hero} type="button" onClick={() => chooseHero(o.model)} className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-zinc-800 ${model === o.model ? "bg-orange-500/10" : ""}`}>
                          <span className="flex h-9 w-9 shrink-0 items-end justify-center overflow-hidden rounded-[10px] border" style={{ background: G.soft, borderColor: `${G.color}55` }}>
                            <HeroArt hero={o.hero} size={40} still />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-[13px] font-semibold text-zinc-200">{o.hero}</span>{" "}
                            <span className="rounded-full px-1.5 py-px text-[10.5px] font-bold" style={{ background: G.soft, color: G.color }}>{p.label}</span>
                            <span className="block truncate text-[11.5px] text-zinc-400">{p.tag}</span>
                          </span>
                          {o.vision && <span className="shrink-0 text-[11px] opacity-60" title="Bisa lihat gambar">👁</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {wizard && (
        <CharacterWizard
          initial={wizard === "new" ? null : wizard}
          taken={chars.map((c) => c.name)}
          onClose={() => setWizard(null)}
          onSaved={(c) => {
            const isNew = wizard === "new";
            setChars((x) => (x.some((y) => y.id === c.id) ? x.map((y) => (y.id === c.id ? c : y)) : [...x, c]));
            setWizard(null);
            if (isNew) {
              pickModel(`${CHAR_PREFIX}${c.id}`);
              flash(`${c.name} siap ngobrol 🎉`);
            } else flash(`${c.name} diperbarui ✓`);
          }}
        />
      )}
      {brain && <CharacterBrain char={brain} onClose={() => setBrain(null)} />}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[80] -translate-x-1/2 rounded-full bg-zinc-100 px-4 py-2 text-[12.5px] font-semibold text-zinc-900 shadow-lg" role="status">
          {toast}
        </div>
      )}
      {zoom && (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" aria-label="Tutup gambar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Gambar" className="max-h-full max-w-full rounded-xl" />
        </button>
      )}
    </div>
  );
}
