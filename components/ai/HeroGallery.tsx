"use client";

import { useMemo, useState } from "react";
import { SMART, SMART_HERO, heroDesc } from "@/lib/aiModels";
import { GROUPS, personaOf, type Group } from "@/lib/aiPersona";
import HeroArt from "./HeroArt";
import { CHAR_PREFIX, type CustomChar } from "@/lib/customChar";

type Opt = { hero: string; model: string; status: number; vision: boolean };

const STATUS = [
  { text: "✅ Siap dipakai", cls: "text-emerald-400" },
  { text: "Belum dicoba", cls: "text-zinc-500" },
  { text: "↪ Pakai mesin cadangan", cls: "text-amber-400" },
];
const STATUS_TIP = [
  "Mesin hero ini sudah terbukti jalan.",
  "Belum pernah dipakai / dicek.",
  "Mesin asli hero ini tidak tersedia di akun provider (atau sedang error). Jawaban otomatis dibantu mesin lain yang siap — karakter & gaya jawab tetap hero ini. User lain tidak melihat info ini.",
];

/** Tab 🎭 Karakter: semua hero + kepribadiannya, bisa langsung dipilih untuk ngobrol */
type Check = { hero: string; ok: boolean; tried: number; reason?: string };

export default function HeroGallery({
  opts,
  value,
  onPick,
  ready,
  onChecked,
  owner = false,
  chars = [],
  onNewChar,
  onEditChar,
  onBrain,
  onDeleteChar,
}: {
  owner?: boolean;
  chars?: CustomChar[];
  onNewChar?: () => void;
  onEditChar?: (c: CustomChar) => void;
  onBrain?: (c: CustomChar) => void;
  onDeleteChar?: (c: CustomChar) => void;
  opts: Opt[];
  value: string;
  onPick: (model: string) => void;
  ready: boolean;
  onChecked: () => void;
}) {
  const [group, setGroup] = useState<Group | "all">("all");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ results: Check[]; error?: string } | null>(null);
  const runCheck = async () => {
    setChecking(true);
    setCheck(null);
    try {
      const r = await fetch("/api/ai/check", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      setCheck(r.ok ? { results: j.results ?? [] } : { results: [], error: j.error || `Gagal (${r.status})` });
      onChecked();
    } catch {
      setCheck({ results: [], error: "Koneksi gagal" });
    } finally {
      setChecking(false);
    }
  };
  const checkOf = (hero: string) => check?.results.find((c) => c.hero === hero);
  const [q, setQ] = useState("");
  const [delChar, setDelChar] = useState<string | null>(null);
  const list = useMemo(() => {
    const all: Opt[] = [{ hero: SMART_HERO, model: SMART, status: 0, vision: true }, ...[...opts].sort((a, b) => a.status - b.status || a.hero.localeCompare(b.hero))];
    const s = q.trim().toLowerCase();
    return all.filter((o) => {
      const p = personaOf(o.hero);
      if (group !== "all" && p.group !== group) return false;
      if (!s) return true;
      return [o.hero, p.type, p.label, p.role, ...p.traits].join(" ").toLowerCase().includes(s);
    });
  }, [opts, group, q]);
  const mine = useMemo(() => {
    const s = q.trim().toLowerCase();
    return chars.filter((c) => {
      const p = personaOf(c.name);
      if (group !== "all" && p.group !== group) return false;
      return !s || [c.name, p.type, p.label, c.profile.role ?? ""].join(" ").toLowerCase().includes(s);
    });
  }, [chars, group, q]);

  const card = (o: Opt) => {
            const p = personaOf(o.hero);
            const g = GROUPS[p.group];
            const active = value === o.model || (o.model === SMART && value === SMART);
            const auto = o.model === SMART;
            return (
              <div key={o.hero} className={`flex flex-col gap-2 rounded-2xl border p-3 transition hover:-translate-y-0.5 ${active ? "border-orange-500/60" : "border-zinc-800"} `}>
                <div className="flex h-[116px] items-end justify-center rounded-xl" style={{ background: `linear-gradient(180deg, ${g.soft}, transparent)` }}>
                  <HeroArt hero={o.hero} size={108} title={`${o.hero}, ${p.type} ${p.label}`} />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[15px] font-bold">
                      {o.hero}
                      {auto && <span className="ml-1 text-[11px] font-semibold text-orange-400">· otomatis</span>}
                    </div>
                    <div className="text-[11px] font-semibold text-zinc-500">
                      {p.role || "Hero"}
                      {o.vision && <span className="ml-1.5 text-sky-400">👁 bisa lihat gambar</span>}
                    </div>
                  </div>
                  {!auto && owner && (
                    <span
                      className={`shrink-0 text-right text-[10.5px] font-semibold ${checkOf(o.hero) ? (checkOf(o.hero)!.ok ? "text-emerald-400" : "text-amber-400") : (STATUS[o.status]?.cls ?? "")}`}
                      title={checkOf(o.hero) ? (checkOf(o.hero)!.ok ? STATUS_TIP[0] : `${STATUS_TIP[2]}\n\nAlasan: ${checkOf(o.hero)!.reason ?? "-"}`) : STATUS_TIP[o.status]}
                    >
                      {checkOf(o.hero) ? (checkOf(o.hero)!.ok ? "✅ Lulus cek" : "↪ Pakai mesin cadangan") : STATUS[o.status]?.text}
                    </span>
                  )}
                </div>
                <div>
                  <div className="font-display text-[17px] font-extrabold leading-tight" style={{ color: g.color }}>
                    {p.label}
                  </div>
                  <div className="text-[12px] text-zinc-400">
                    {p.tag} <span className="text-zinc-500">· {p.type}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {p.traits.map((t) => (
                    <span key={t} className="rounded-full bg-zinc-800/70 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-400">
                      {t}
                    </span>
                  ))}
                </div>
                <p className="rounded-xl border border-dashed border-zinc-800 px-2.5 py-2 text-[12px] leading-snug text-zinc-300">
                  {auto ? "Aku pilihkan hero terbaik untuk tiap pertanyaan — gaya jawabnya ikut hero yang kupilih." : `“${p.say}”`}
                </p>
                <p className="text-[11px] leading-snug text-zinc-500">{auto ? heroDesc(SMART) : heroDesc(o.model)}</p>
                <button
                  type="button"
                  onClick={() => onPick(o.model)}
                  disabled={active}
                  className="mt-auto rounded-xl px-3 py-2 text-[12.5px] font-bold text-white transition disabled:opacity-60"
                  style={{ background: active ? "#a1a1aa" : "#f97316" }}
                >
                  {active ? "Sedang dipakai" : `Ngobrol sama ${o.hero}`}
                </button>
              </div>
            );
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-[1000px]">
        <h2 className="font-display text-[18px] font-bold">🎭 Karakter AI</h2>
        <p className="mt-0.5 text-[12.5px] text-zinc-500">
          Tiap hero punya kepribadian & gaya jawab sendiri (gaya 16 tipe MBTI). Pilih hero untuk ngobrol — gaya jawabnya ikut hero yang sedang menjawab.
        </p>
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
          <button
            type="button"
            onClick={() => setGroup("all")}
            className={`shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold ${group === "all" ? "border-orange-500/50 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-500"}`}
          >
            Semua
          </button>
          {(Object.keys(GROUPS) as Group[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroup(g)}
              title={GROUPS[g].desc}
              className="shrink-0 rounded-full border px-3 py-1 text-[12px] font-semibold"
              style={group === g ? { borderColor: GROUPS[g].color, background: GROUPS[g].soft, color: GROUPS[g].color } : undefined}
            >
              <span className={group === g ? "" : "text-zinc-500"}>
                {GROUPS[g].icon} {GROUPS[g].name} ({g})
              </span>
            </button>
          ))}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari hero / tipe / sifat…" className="input ml-auto w-44 shrink-0 py-1.5 text-[12.5px] sm:w-56" />
        </div>
        {owner && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 px-3 py-2 text-[12px]">
          <button
            type="button"
            onClick={runCheck}
            disabled={checking || !ready}
            className="rounded-lg bg-orange-500 px-3 py-1.5 font-bold text-white disabled:opacity-60"
          >
            {checking ? "⏳ Mengecek semua hero… (±30 detik)" : "🩺 Cek semua hero"}
          </button>
          {!check && !checking && <span className="text-zinc-500">Tes cepat tiap hero (1 pesan pendek) supaya yang dipilih pasti bisa jawab.</span>}
          {check?.error && <span className="text-red-400">{check.error}</span>}
          {check && !check.error && (
            <span className="text-zinc-400">
              ✅ <b className="text-emerald-400">{check.results.filter((c) => c.ok).length}</b> hero mesinnya sendiri · ↪{" "}
              <b className="text-amber-400">{check.results.filter((c) => !c.ok).length}</b> pakai mesin cadangan
              {check.results.some((c) => !c.ok) && (
                <span className="text-zinc-500"> — tetap bisa dipakai, karakternya tidak berubah</span>
              )}
            </span>
          )}
        </div>
        )}
        {!ready && <p className="mt-4 text-[13px] text-zinc-500">Server AI belum tersambung.</p>}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {onNewChar && group === "all" && !q.trim() && (
            <button
              type="button"
              onClick={onNewChar}
              disabled={!ready}
              className="flex min-h-[200px] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-orange-500/40 bg-orange-500/5 p-3 text-center text-orange-400 transition hover:-translate-y-0.5 hover:border-orange-500/70 disabled:opacity-50"
            >
              <span className="text-[30px] font-light leading-none">＋</span>
              <span className="text-[14px] font-bold">Buat karakter sendiri</span>
              <span className="text-[11.5px] font-medium text-zinc-500">Nama & gambar sendiri · 12 pertanyaan · ±2 menit</span>
              <span className="text-[11px] text-zinc-500">🔒 pribadi, hanya kamu yang lihat</span>
            </button>
          )}
          {mine.map((c) => {
            const p = personaOf(c.name);
            const g = GROUPS[p.group];
            const model = `${CHAR_PREFIX}${c.id}`;
            const active = value === model;
            return (
              <div key={c.id} className={`relative flex flex-col gap-2 rounded-2xl border p-3 transition hover:-translate-y-0.5 ${active ? "border-orange-500/60" : "border-zinc-800"}`}>
                <span className="absolute right-3 top-3 z-10 rounded-md bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-orange-400">MILIKMU</span>
                <div className="flex h-[116px] items-end justify-center rounded-xl" style={{ background: `linear-gradient(180deg, ${g.soft}, transparent)` }}>
                  <HeroArt hero={c.name} size={p.img ? 96 : 108} title={`${c.name}, ${p.type} ${p.label}`} />
                </div>
                <div>
                  <div className="text-[15px] font-bold">{c.name}</div>
                  <div className="line-clamp-1 text-[11px] font-semibold text-zinc-500">{c.profile.role || "Karakter buatanmu"}</div>
                </div>
                <div>
                  <div className="font-display text-[17px] font-extrabold leading-tight" style={{ color: g.color }}>
                    {p.label}
                  </div>
                  <div className="text-[12px] text-zinc-400">
                    {p.tag} <span className="text-zinc-500">· {p.type}</span>
                  </div>
                </div>
                {c.profile.catchphrase && (
                  <p className="rounded-xl border border-dashed border-zinc-800 px-2.5 py-2 text-[12px] leading-snug text-zinc-300">“{c.profile.catchphrase}”</p>
                )}
                <div className="mt-auto flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onPick(model)}
                    disabled={active}
                    className="flex-1 rounded-xl px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
                    style={{ background: active ? "#a1a1aa" : "#f97316" }}
                  >
                    {active ? "Sedang dipakai" : "Ngobrol"}
                  </button>
                  <button type="button" onClick={() => onBrain?.(c)} className="rounded-xl border border-zinc-800 px-2.5 py-2 text-[12px] font-bold text-zinc-300 hover:border-zinc-600" title="Isi pengetahuan, contoh jawaban & koreksi">
                    🧠 Otak
                  </button>
                  <button type="button" onClick={() => onEditChar?.(c)} className="rounded-xl border border-zinc-800 px-2.5 py-2 text-[12px] font-bold text-zinc-300 hover:border-zinc-600" aria-label={`Edit ${c.name}`} title="Edit">
                    ✎
                  </button>
                  {delChar === c.id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setDelChar(null);
                        onDeleteChar?.(c);
                      }}
                      className="rounded-xl bg-red-500/15 px-2.5 py-2 text-[12px] font-bold text-red-400"
                      onBlur={() => setDelChar(null)}
                    >
                      Yakin hapus?
                    </button>
                  ) : (
                    <button type="button" onClick={() => setDelChar(c.id)} className="rounded-xl border border-zinc-800 px-2.5 py-2 text-[12px] text-zinc-500 hover:text-red-400" aria-label={`Hapus ${c.name}`} title="Hapus">
                      🗑
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {list.filter((o) => o.model === SMART).map(card)}
        </div>
        {(Object.keys(GROUPS) as Group[]).map((gk) => {
          const items = list.filter((o) => o.model !== SMART && personaOf(o.hero).group === gk);
          if (!items.length) return null;
          const G = GROUPS[gk];
          return (
            <section key={gk} className="mt-6">
              <div className="flex items-baseline gap-2 rounded-xl px-3 py-2" style={{ background: G.soft }}>
                <span className="font-display text-[16px] font-extrabold" style={{ color: G.color }}>
                  {G.icon} {G.name}
                </span>
                <span className="text-[12px] font-medium" style={{ color: G.color, opacity: 0.85 }}>
                  {G.desc}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(card)}</div>
            </section>
          );
        })}
        {!list.length && !mine.length && <p className="mt-6 text-center text-[13px] text-zinc-500">Tidak ada hero yang cocok.</p>}
      </div>
    </div>
  );
}
