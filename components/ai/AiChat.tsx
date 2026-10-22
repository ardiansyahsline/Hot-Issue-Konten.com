"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { deleteConversation, renameConversation } from "@/app/(app)/ai/actions";
import Markdown from "./Markdown";

export type AiConv = { id: string; title: string; model: string | null; updated_at: string };
export type AiMsg = { id: number | string; role: "user" | "assistant"; content: string; model?: string | null; error?: boolean; created_at?: string };

const SUGGEST = [
  ["✍️", "Bikin caption campaign", "Bikinin 3 ide caption TikTok yang santai untuk campaign film, kasih hashtag juga"],
  ["📊", "Bantu rumus Excel", "Gimana rumus Excel buat hitung total lembur per orang dari tabel jam masuk & jam pulang?"],
  ["🌐", "Terjemahin teks", "Terjemahkan teks berikut ke bahasa Inggris yang natural:\n\n"],
  ["💡", "Brainstorm ide konten", "Kasih 10 ide konten pendek yang lagi relevan buat clipper di Indonesia"],
] as const;

const MODEL_KEY = "cs-ai-model";

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

function ModelPicker({ value, onChange, models, ready }: { value: string; onChange: (m: string) => void; models: string[]; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  const list = useMemo(() => {
    const all = ["auto", ...models.filter((m) => m !== "auto")];
    const s = q.trim().toLowerCase();
    return (s ? all.filter((m) => m.toLowerCase().includes(s)) : all).slice(0, 80);
  }, [models, q]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="max-w-[220px] truncate rounded-full border border-zinc-800 px-3 py-1 text-[12px] font-semibold text-zinc-300 hover:border-zinc-600"
        title="Pilih model"
      >
        ✨ {value} ▾
      </button>
      {open && (
        <div
          className="absolute bottom-full left-0 z-40 mb-2 w-72 rounded-2xl border border-zinc-800 bg-zinc-900 p-2"
          style={{ boxShadow: "var(--shadow-pop), 0 18px 40px -16px rgba(0,0,0,.35)" }}
        >
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari model…" className="input mb-2 py-1.5 text-[13px]" />
          <div className="max-h-64 overflow-y-auto">
            {list.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                  setQ("");
                }}
                className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[13px] ${m === value ? "bg-orange-500/10 font-semibold text-orange-400" : "text-zinc-300 hover:bg-zinc-800"}`}
              >
                {m === "auto" ? "auto — pilih otomatis yang tersedia" : m}
              </button>
            ))}
            {!ready && <p className="px-2.5 py-2 text-[12px] text-zinc-500">Server AI belum tersambung.</p>}
            {ready && models.length === 0 && <p className="px-2.5 py-2 text-[12px] text-zinc-500">Daftar model belum terbaca — pakai “auto”.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiChat({
  firstName,
  initialConvs,
  initialId,
  initialMsgs,
  setupError,
  defaultModel,
}: {
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
  const [model, setModel] = useState(defaultModel);
  const [models, setModels] = useState<string[]>([]);
  const [ready, setReady] = useState(!setupError);
  const [search, setSearch] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const ta = useRef<HTMLTextAreaElement>(null);

  // model pilihan tersimpan di browser
  useEffect(() => {
    try {
      const m = localStorage.getItem(MODEL_KEY);
      if (m) setModel(m);
    } catch {}
    fetch("/api/ai/models")
      .then((r) => r.json())
      .then((j) => {
        setModels(j.models ?? []);
        setReady(!!j.ready);
      })
      .catch(() => {});
  }, []);
  const pickModel = (m: string) => {
    setModel(m);
    try {
      localStorage.setItem(MODEL_KEY, m);
    } catch {}
  };

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

  const setUrl = (id: string | null) => {
    const url = id ? `/ai?c=${id}` : "/ai";
    window.history.replaceState(null, "", url);
  };

  const openConv = useCallback(
    async (id: string) => {
      if (busy) abortRef.current?.abort();
      setActiveId(id);
      setUrl(id);
      setSideOpen(false);
      setErr(null);
      setLoadingMsgs(true);
      stick.current = true;
      const { data } = await supabase.from("ai_messages").select("id, role, content, model, error, created_at").eq("conversation_id", id).order("id");
      setMsgs((data ?? []) as AiMsg[]);
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

  const run = async (content: string, regenerate = false) => {
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
      } else base = [...base, { id: `u${Date.now()}`, role: "user", content }];
      return [...base, { id: tempId, role: "assistant", content: "", model }];
    });
    const ac = new AbortController();
    abortRef.current = ac;
    let convId = activeId;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: activeId, content, model, regenerate }),
        signal: ac.signal,
      });
      const newId = res.headers.get("x-conversation-id");
      if (newId && newId !== activeId) {
        convId = newId;
        setActiveId(newId);
        setUrl(newId);
        setConvs((cs) => [{ id: newId, title: content.replace(/\s+/g, " ").slice(0, 60) || "Chat baru", model, updated_at: new Date().toISOString() }, ...cs]);
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Gagal (${res.status})`);
      }
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
      if (!text.trim()) setMsgs((m) => m.map((x) => (x.id === tempId ? { ...x, content: "_(Tidak ada jawaban dari model. Coba model lain atau ulangi.)_", error: true } : x)));
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
    if (!t || busy) return;
    setInput("");
    run(t);
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
      <div className="mt-2 border-t border-zinc-800/80 pt-2 text-[11.5px] text-zinc-500">🔒 Percakapan hanya bisa dilihat kamu sendiri</div>
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2.5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <textarea
        ref={ta}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
        rows={1}
        placeholder={setupError ? "AI belum tersambung" : "Tanya apa aja… (Enter kirim · Shift+Enter baris baru)"}
        disabled={!!setupError}
        className="block max-h-[220px] w-full resize-none bg-transparent px-2 py-1.5 text-[14px] text-zinc-100 outline-none placeholder:text-zinc-500"
        aria-label="Tulis pesan ke AI"
      />
      <div className="mt-1 flex items-center gap-2">
        <ModelPicker value={model} onChange={pickModel} models={models} ready={ready} />
        <span className="hidden text-[11.5px] text-zinc-500 sm:inline">via OmniRoute</span>
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="ml-auto flex h-9 items-center gap-1.5 rounded-xl border border-zinc-700 px-3 text-[13px] font-semibold" aria-label="Berhenti">
            ■ Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim() || !!setupError}
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
          <span className="truncate font-semibold">{active?.title ?? "Chat baru"}</span>
          {active && (
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

        {msgs.length === 0 && !loadingMsgs ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto p-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-[26px]" style={{ backgroundImage: "linear-gradient(160deg,#fb8a3c,#ea580c)" }}>
              ✨
            </span>
            <h2 className="mt-4 font-display text-[22px] font-bold">Halo {firstName}, mau ngobrol apa?</h2>
            <p className="mt-1 text-[13px] text-zinc-500">Tanya bebas — ide konten, rumus Excel, terjemahan, atau sekadar iseng.</p>
            <div className="mt-5 grid w-full max-w-[540px] grid-cols-1 gap-2 text-left text-[13px] sm:grid-cols-2">
              {SUGGEST.map(([icon, label, prompt]) => (
                <button
                  key={label}
                  type="button"
                  disabled={!!setupError}
                  onClick={() => {
                    if (prompt.endsWith("\n\n")) {
                      setInput(prompt);
                      setTimeout(() => ta.current?.focus(), 30);
                    } else run(prompt);
                  }}
                  className="rounded-xl border border-zinc-800 px-3 py-2.5 text-left text-zinc-300 transition hover:border-orange-500/50 hover:bg-orange-500/5 disabled:opacity-50"
                >
                  {icon} {label}
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
                      <div key={m.id} className="flex justify-end">
                        <div
                          className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md px-4 py-2.5 text-[14px] text-white"
                          style={{ backgroundImage: "linear-gradient(180deg,#fb8a3c,#ea580c)" }}
                        >
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/15 text-[14px]">✨</span>
                        <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-zinc-200">
                          {m.content ? (
                            m.error ? (
                              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[13px] text-red-400">{m.content.replace(/^⚠️\s*/, "⚠️ ")}</div>
                            ) : (
                              <Markdown text={m.content} />
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
                                    navigator.clipboard?.writeText(m.content).then(() => {
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
                              {m.model && <span>· {m.model}</span>}
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
    </div>
  );
}
