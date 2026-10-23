"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { CustomChar, MemoryItem, MemoryKind } from "@/lib/customChar";
import HeroArt from "./HeroArt";

const TABS: { k: MemoryKind; icon: string; name: string; desc: string }[] = [
  { k: "knowledge", icon: "📚", name: "Pengetahuan", desc: "SOP, FAQ, info produk, aturan campaign… Ketik atau upload file teks. Saat chat, bagian yang paling nyambung dengan pertanyaan otomatis dibaca." },
  { k: "example", icon: "💬", name: "Contoh jawab", desc: "Contoh pertanyaan + jawaban ideal. Karakter meniru gaya & isinya untuk pertanyaan serupa. Bisa juga dari tombol 👍 di chat." },
  { k: "correction", icon: "🧠", name: "Koreksi", desc: "Hal yang harus diperbaiki / selalu diingat. Selalu dibaca di setiap chat. Biasanya terisi dari tombol ✎ Koreksi & 🧠 Ingat ini di chat." },
];
const MAX = 60000;
const nf = (n: number) => n.toLocaleString("id-ID");
const date = (iso: string) => new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });

/** 🧠 Otak karakter: kelola catatan pengetahuan, contoh jawaban, dan koreksi */
export default function CharacterBrain({ char, onClose }: { char: CustomChar; onClose: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [tab, setTab] = useState<MemoryKind>("knowledge");
  const [items, setItems] = useState<MemoryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [del, setDel] = useState<number | null>(null);

  useEffect(() => {
    supabase
      .from("ai_character_memory")
      .select("id, character_id, kind, title, content, created_at")
      .eq("character_id", char.id)
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (error) setErr(/ai_character_memory|schema cache/i.test(error.message) ? "Fitur otak belum aktif — admin perlu menjalankan supabase/migration-19-karakter-sendiri.sql." : error.message);
        setItems((data ?? []) as MemoryItem[]);
      });
  }, [supabase, char.id]);

  const list = (items ?? []).filter((i) => i.kind === tab);
  const t = TABS.find((x) => x.k === tab)!;
  const reset = () => {
    setTitle("");
    setBody("");
    setAnswer("");
    setAdding(false);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return setErr("File maksimal 2 MB (teks).");
    if (!/\.(txt|md|csv|json|tsv|srt|html?)$/i.test(f.name) && !f.type.startsWith("text/")) return setErr("Untuk sekarang yang bisa dibaca file teks: .txt, .md, .csv, .json, .srt. PDF/Word → salin isinya lalu tempel di sini.");
    setErr(null);
    let text = await f.text();
    if (/\.html?$/i.test(f.name)) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
    if (text.length > MAX) {
      setErr(`File kepanjangan (${nf(text.length)} huruf) — diambil ${nf(MAX)} huruf pertama. Pecah jadi beberapa catatan kalau mau semuanya masuk.`);
      text = text.slice(0, MAX);
    }
    setAdding(true);
    setTitle((x) => x || f.name.replace(/\.[^.]+$/, "").slice(0, 200));
    setBody(text);
  };

  const add = async () => {
    const content = tab === "example" ? `Pertanyaan: ${body.trim()}\nJawaban ideal: ${answer.trim()}` : body.trim();
    if (!body.trim() || (tab === "example" && !answer.trim())) return;
    setSaving(true);
    setErr(null);
    const { data, error } = await supabase
      .from("ai_character_memory")
      .insert({ character_id: char.id, kind: tab, title: title.trim().slice(0, 200) || null, content: content.slice(0, MAX) })
      .select("id, character_id, kind, title, content, created_at")
      .single();
    setSaving(false);
    if (error) return setErr(error.message);
    setItems((x) => [data as MemoryItem, ...(x ?? [])]);
    reset();
  };

  const remove = async (id: number) => {
    setDel(null);
    const prev = items;
    setItems((x) => (x ?? []).filter((i) => i.id !== id));
    const { error } = await supabase.from("ai_character_memory").delete().eq("id", id);
    if (error) {
      setErr(error.message);
      setItems(prev);
    }
  };

  const total = (items ?? []).reduce((s, i) => s + i.content.length, 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label={`Otak ${char.name}`}>
      <div className="flex max-h-[92dvh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
          <span className="flex h-10 w-10 shrink-0 items-end justify-center overflow-hidden rounded-xl bg-orange-500/10">
            <HeroArt hero={char.name} size={44} still />
          </span>
          <div className="min-w-0">
            <div className="font-display text-[15px] font-bold">🧠 Otak {char.name}</div>
            <div className="text-[11.5px] text-zinc-500">
              {items ? `${nf(items.length)} catatan · ${nf(total)} huruf` : "Memuat…"} · pribadi
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="flex border-b border-zinc-800/80 text-[12.5px] font-bold">
          {TABS.map((x) => {
            const n = (items ?? []).filter((i) => i.kind === x.k).length;
            return (
              <button
                key={x.k}
                type="button"
                onClick={() => {
                  setTab(x.k);
                  reset();
                }}
                className={`flex-1 px-2 py-2.5 ${tab === x.k ? "text-orange-400 shadow-[inset_0_-2px_0_#f97316]" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {x.icon} {x.name}
                {n > 0 && <span className="ml-1 rounded-full bg-zinc-800 px-1.5 text-[10.5px] text-zinc-400">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <p className="text-[11.5px] leading-snug text-zinc-500">{t.desc}</p>
          {err && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{err}</p>}

          {adding ? (
            <div className="mt-3 space-y-2 rounded-xl border border-zinc-800 p-3">
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={tab === "example" ? "Judul (opsional) mis. Banding video ditolak" : "Judul catatan (opsional)"} className="input py-1.5 text-[13px]" />
              <textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, MAX))}
                rows={tab === "example" ? 3 : 8}
                placeholder={tab === "example" ? "Pertanyaan user…" : tab === "correction" ? "mis. Jangan pernah janji payout cair hari itu; selalu bilang proses 1–3 hari kerja." : "Tempel isi SOP / FAQ / catatan di sini…"}
                className="input resize-y py-1.5 text-[13px]"
              />
              {tab === "example" && (
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value.slice(0, MAX))} rows={5} placeholder="Jawaban ideal…" className="input resize-y py-1.5 text-[13px]" />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-zinc-500">
                  {nf(body.length + answer.length)} / {nf(MAX)} huruf
                </span>
                <button type="button" onClick={reset} className="ml-auto rounded-lg border border-zinc-800 px-3 py-1.5 text-[12px] font-bold text-zinc-300">
                  Batal
                </button>
                <button
                  type="button"
                  onClick={add}
                  disabled={saving || !body.trim() || (tab === "example" && !answer.trim())}
                  className="rounded-lg bg-orange-500 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50"
                >
                  {saving ? "Menyimpan…" : "Simpan"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setAdding(true)} className="rounded-xl bg-orange-500 px-3 py-1.5 text-[12.5px] font-bold text-white">
                ＋ Tambah {tab === "knowledge" ? "catatan" : tab === "example" ? "contoh" : "koreksi"}
              </button>
              {tab === "knowledge" && (
                <label className="cursor-pointer rounded-xl border border-zinc-800 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-600">
                  ⬆ Upload file teks
                  <input type="file" accept=".txt,.md,.csv,.json,.tsv,.srt,.html,text/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                </label>
              )}
            </div>
          )}

          <div className="mt-3 divide-y divide-zinc-800/70 rounded-xl border border-zinc-800">
            {items === null && <p className="px-3 py-3 text-[12.5px] text-zinc-500">Memuat…</p>}
            {items !== null && !list.length && <p className="px-3 py-3 text-[12.5px] text-zinc-500">Belum ada {t.name.toLowerCase()}.</p>}
            {list.map((i) => (
              <div key={i.id} className="px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[13px] font-semibold text-zinc-200">{i.title || i.content.split("\n")[0].replace(/^Pertanyaan:\s*/, "").slice(0, 90)}</div>
                    <div className="text-[11px] text-zinc-500">
                      {nf(i.content.length)} huruf · ditambah {date(i.created_at)} · {open === i.id ? "tutup ▴" : "lihat ▾"}
                    </div>
                  </button>
                  {del === i.id ? (
                    <span className="flex shrink-0 gap-2 text-[12px]">
                      <button type="button" onClick={() => remove(i.id)} className="font-bold text-red-400">
                        Hapus
                      </button>
                      <button type="button" onClick={() => setDel(null)} className="text-zinc-500">
                        Batal
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setDel(i.id)} className="shrink-0 px-1 text-[12px] text-zinc-500 hover:text-red-400" aria-label="Hapus catatan">
                      🗑
                    </button>
                  )}
                </div>
                {open === i.id && <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-zinc-950/40 p-2.5 font-sans text-[12px] text-zinc-300">{i.content}</pre>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
