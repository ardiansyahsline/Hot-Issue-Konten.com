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
import { personaOf } from "@/lib/aiPersona";

export type AiConv = { id: string; title: string; model: string | null; updated_at: string };
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
  /** model diganti otomatis (mis. karena ada gambar) */
  switched?: boolean;
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
}: {
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
  const ready0 = opts.filter((o) => o.status === 0 && match(o));
  const untried = opts.filter((o) => o.status === 1 && match(o));
  const off = opts.filter((o) => o.status === 2 && match(o));
  const current = value === SMART ? SMART_HERO : heroName(value);
  const pick = (m: string) => {
    onChange(m);
    setOpen(false);
    setQ("");
  };
  const Row = ({ o }: { o: HeroOpt }) => (
    <button
      type="button"
      onClick={() => pick(o.model)}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left ${current === o.hero && value !== SMART ? "bg-orange-500/10" : "hover:bg-zinc-800"} ${o.status === 2 ? "opacity-60" : ""}`}
    >
      <HeroAvatar hero={o.hero} />
      <span className="min-w-0 flex-1">
        <span className={`block text-[13px] font-semibold ${current === o.hero && value !== SMART ? "text-orange-400" : "text-zinc-200"}`}>
          {o.hero}
          {heroRole(o.hero) && <span className="ml-1.5 text-[10.5px] font-medium text-zinc-500">{heroRole(o.hero)}</span>}
        </span>
        <span className="block text-[11.5px] leading-snug text-zinc-400">{heroDesc(o.model)}</span>
      </span>
      {o.vision && (
        <span className="shrink-0 rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-400" title="Bisa lihat gambar">
          👁
        </span>
      )}
    </button>
  );
  const Group = ({ title, list }: { title: string; list: HeroOpt[] }) =>
    list.length ? (
      <div>
        <div className="px-2 pb-1 pt-2 text-[10.5px] font-bold uppercase tracking-wider text-zinc-500">{title}</div>
        {list.map((o) => (
          <Row key={o.hero} o={o} />
        ))}
      </div>
    ) : null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex max-w-[210px] items-center gap-1.5 rounded-full border border-zinc-800 py-0.5 pl-0.5 pr-2.5 text-[12px] font-semibold text-zinc-300 hover:border-zinc-600"
        title={`${current}: ${heroDesc(value)}`}
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
                {(vision.text || vision.image) && (
                  <span className="block text-[10.5px] text-zinc-500">
                    sekarang: chat {vision.text ? heroName(vision.text) : "-"} · gambar {vision.image ? heroName(vision.image) : "belum ada"}
                  </span>
                )}
              </span>
            </button>
            <Group title="Siap dipakai" list={ready0} />
            <Group title="Belum dicoba" list={untried} />
            {off.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowOff((v) => !v)} className="w-full px-2 pb-1 pt-2 text-left text-[11.5px] font-semibold text-zinc-500 hover:text-zinc-300">
                  {showOff ? "▾" : "▸"} {off.length} hero belum tersambung / lagi gagal
                </button>
                {showOff && off.map((o) => <Row key={o.hero} o={o} />)}
              </div>
            )}
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
            Kalau hero pilihan lagi gagal / kuota habis, otomatis dijawab hero lain yang siap.
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
}: {
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
  const [msgs, setMsgs] = useState<AiMsg[]>(initialMsgs);
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
  const [pending, setPending] = useState<Pending[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoom, setZoom] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | number | null>(null);
  const [drag, setDrag] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hero = (id: string | null | undefined) => (id ? heroName(id) : SMART_HERO);

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
  const pickModel = (m: string) => {
    setModel(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
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
      let r = await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data, persona").eq("conversation_id", id).order("id");
      if (r.error) r = (await supabase.from("ai_messages").select("id, role, content, model, error, created_at, images, used_data").eq("conversation_id", id).order("id")) as typeof r;
      if (r.error) r = (await supabase.from("ai_messages").select("id, role, content, model, error, created_at").eq("conversation_id", id).order("id")) as typeof r;
      setMsgs((r.data ?? []) as AiMsg[]);
      setLoadingMsgs(false);
    },
    [supabase, busy]
  );

  const newChat = () => {
    if (busy) abortRef.current?.abort();
    setActiveId(null);
    setMsgs([]);
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
      return [...base, { id: tempId, role: "assistant", content: "", model: model === SMART ? null : model }];
    });
    const ac = new AbortController();
    abortRef.current = ac;
    let convId = activeId;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, content, model, regenerate, images, data: dataMode, web: webMode }),
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
      const used = decodeURIComponent(res.headers.get("x-ai-model") ?? "");
      const usedData = res.headers.get("x-ai-data") === "1";
      const usedWeb = res.headers.get("x-ai-web") === "1";
      const persona = decodeURIComponent(res.headers.get("x-ai-persona") ?? "") || null;
      const chart = decodeURIComponent(res.headers.get("x-ai-chart") ?? "") || null;
      const switched = !!used && ((model !== SMART && used !== model) || res.headers.get("x-ai-fallback") === "1");
      setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, model: used || x.model, used_data: usedData, used_web: usedWeb, persona, chart, switched } : x)));
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        const t = text;
        setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, content: t } : x)));
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

  const send = () => {
    const t = input.trim();
    const imgs = pending.filter((p) => p.status === "done" && p.path).map((p) => p.path!);
    if ((!t && !imgs.length) || busy || uploading) return;
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
          📊 Data CS Tracker: {dataMode === "auto" ? "Otomatis" : "Off"}
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
            🌐 Internet: {webMode === "auto" ? "Otomatis" : "Off"}
          </button>
        )}
        <ModelPicker value={model} onChange={pickModel} models={models} ready={ready} vision={best} status={status} visionList={visionList} loadError={loadError} onReload={() => loadModels(false)} />
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
    <div className="card card-plain relative flex h-[calc(100dvh-220px)] min-h-[460px] overflow-hidden p-0 md:h-[calc(100dvh-150px)]">
      {/* daftar percakapan: desktop di kiri, HP lewat tombol ☰ */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800/80 md:block">{sidebar}</aside>
      {sideOpen && (
        <div className="absolute inset-0 z-30 flex md:hidden">
          <div className="w-[82%] max-w-[300px] border-r border-zinc-800 bg-zinc-900">{sidebar}</div>
          <button type="button" className="flex-1 bg-black/30" onClick={() => setSideOpen(false)} aria-label="Tutup daftar" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-3">
          <button type="button" onClick={() => setSideOpen(true)} className="rounded-lg px-2 py-1 text-zinc-400 hover:bg-zinc-800 md:hidden" aria-label="Daftar percakapan">
            ☰
          </button>
          <span className="flex shrink-0 rounded-full border border-zinc-800 p-0.5 text-[12px] font-semibold">
            {(["chat", "chars"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-full px-2.5 py-1 ${view === v ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`}
                aria-pressed={view === v}
              >
                {v === "chat" ? "💬 Chat" : "🎭 Karakter"}
              </button>
            ))}
          </span>
          <span className="truncate font-semibold">{view === "chars" ? "Karakter AI" : (active?.title ?? "Chat baru")}</span>
          {active && view === "chat" && (
            <span className="ml-auto flex shrink-0 gap-3 text-[12px] text-zinc-500">
              <button type="button" onClick={() => { setSideOpen(true); setEditing(active.id); }} className="hover:text-zinc-200">
                ✎ Ganti nama
              </button>
              <button type="button" onClick={() => { setSideOpen(true); setConfirmDel(active.id); }} className="hover:text-red-400">
                🗑 Hapus
              </button>
            </span>
          )}
        </header>

        {setupError && <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-[12.5px] text-amber-400">{setupError}</div>}
        {err && <div className="border-b border-red-500/20 bg-red-500/10 px-4 py-2 text-[12.5px] text-red-400">{err}</div>}

        {view === "chars" ? (
          <HeroGallery
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
        ) : msgs.length === 0 && !loadingMsgs ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <HeroArt hero={hero(model)} size={92} title={hero(model)} />
            <h2 className="mt-2 font-display text-[22px] font-bold">Halo {firstName}, mau ngobrol apa?</h2>
            <button type="button" onClick={() => setView("chars")} className="mt-1 text-[12px] font-semibold text-orange-400 hover:underline">
              {hero(model)} · {personaOf(hero(model)).type} {personaOf(hero(model)).label} — ganti karakter 🎭
            </button>
            <p className="mt-1 text-[13px] text-zinc-500">Tanya bebas, kirim screenshot / chart trading, atau tanya isi CS Tracker.</p>
            <div className="mt-5 grid w-full max-w-[600px] grid-cols-1 gap-2 text-left text-[13px] sm:grid-cols-2">
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
                    m.role === "user" ? (
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
                          {m.used_data && (
                            <span className="mb-1.5 mr-1.5 inline-block rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">📊 pakai data CS Tracker</span>
                          )}
                          {(m.used_web || (!m.error && m.content?.includes("🌐 **Sumber:**"))) && (
                            <span className="mb-1.5 inline-block rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-400">🌐 pakai internet</span>
                          )}
                          {m.content ? (
                            m.error ? (
                              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{m.content.replace(/^⚠️\s*/, "⚠️ ")}</div>
                            ) : (
                              (() => {
                                const sc = splitChart(m.content);
                                const chart = sc.chart || m.chart;
                                return (
                                  <>
                                    {chart && <TradingChart symbol={chart} />}
                                    <Markdown text={sc.text} />
                                  </>
                                );
                              })()
                            )
                          ) : (
                            <span className="inline-flex gap-1 py-2" aria-label="AI sedang mengetik">
                              {[0, 1, 2].map((i) => (
                                <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-orange-400" style={{ animationDelay: `${i * 0.15}s` }} />
                              ))}
                            </span>
                          )}
                          {m.content && !(busy && m.id === lastAssistant?.id) && (
                            <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-zinc-500">
                              {!m.error && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    navigator.clipboard?.writeText(splitChart(m.content).text).then(() => {
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
                                const pp = personaOf(ph);
                                return (
                                  <span>
                                    · ⚔️ {ph} <span className="text-zinc-600">({pp.type} {pp.label})</span>
                                    {engine !== ph && (
                                      <span className="text-zinc-500" title={`${ph} lagi gagal / kuota habis, jadi jawaban ini dibantu ${engine} — gaya jawab tetap ${ph}.`}>
                                        {" "}· ↪ dibantu {engine}
                                      </span>
                                    )}
                                  </span>
                                );
                              })()}
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

      {zoom && (
        <button type="button" onClick={() => setZoom(null)} className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" aria-label="Tutup gambar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="Gambar" className="max-h-full max-w-full rounded-xl" />
        </button>
      )}
    </div>
  );
}
