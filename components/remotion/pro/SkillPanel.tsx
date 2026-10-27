"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchReadyVoices } from "@/lib/studio/client";
import {
  SECTION_ICON,
  SECTION_LABEL,
  SKILL_DESC_MAX,
  SKILL_MAX_BYTES,
  SKILL_NAME_MAX,
  SKILL_SECTIONS,
  applySkill,
  availableSections,
  collectSkill,
  normSkill,
  sectionSummary,
  skillFileName,
  skillPreview,
  type LexChange,
  type SkillLibraryRow,
  type SkillSection,
  type SkillTarget,
  type StudioSkill,
} from "@/lib/studio/skill";
import { DIRECTOR_NOTES_MAX, DIRECTOR_NOTE_LEN, normNotes, type Director, type Timeline } from "@/lib/studio/timeline";

export type SkillTab = "notes" | "save" | "import" | "library";
const TABS: { k: SkillTab; icon: string; name: string }[] = [
  { k: "notes", icon: "✍️", name: "Catatan" },
  { k: "save", icon: "💾", name: "Simpan" },
  { k: "import", icon: "📥", name: "Impor" },
  { k: "library", icon: "📚", name: "Library" },
];
const MIGRATE = "Library tim belum aktif — jalankan migration-21.";

type Lib = { state: "idle" | "loading" | "ok" | "error"; rows: SkillLibraryRow[]; needsMigration: boolean; error: string | null };
type Loaded = { skill: StudioSkill; from: string };
type Flash = { ok: boolean; text: string } | null;

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" }) : "";
};

/** unduh skill sebagai file .json */
function download(skill: StudioSkill) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(skill, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = skillFileName(skill);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Panel 🧠 Skill Studio: catatan gaya untuk sutradara, simpan setelan proyek sebagai skill (unduh .json / Library tim),
 * impor skill (pratinjau → centang → Terapkan) dan Library tim (Pakai / Unduh / Hapus).
 */
export default function SkillPanel({
  tab,
  onTab,
  onClose,
  timeline,
  director,
  dirName,
  onApply,
}: {
  tab: SkillTab;
  onTab: (t: SkillTab) => void;
  onClose: () => void;
  timeline: Timeline | null;
  director: Director | null;
  /** nama sutradara aktif (tampilan) */
  dirName: string;
  /** hasil applySkill / catatan baru → disimpan ke proyek */
  onApply: (next: SkillTarget) => void;
}) {
  const target: SkillTarget = useMemo(() => (timeline ? { ...timeline, director: director ?? undefined } : { director: director ?? undefined }), [timeline, director]);
  const [flash, setFlash] = useState<Flash>(null);
  const [lib, setLib] = useState<Lib>({ state: "idle", rows: [], needsMigration: false, error: null });
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [voices, setVoices] = useState<{ id: string; name: string }[] | undefined>(undefined);
  const dialog = useRef<HTMLDivElement>(null);

  // bank suara siap (voiceName di skill dicocokkan ke id bank di database ini); gagal -> tanpa pencocokan
  useEffect(() => {
    let dead = false;
    fetchReadyVoices().then(
      (v) => !dead && setVoices(v.map((x) => ({ id: x.id, name: x.name }))),
      () => !dead && setVoices([]),
    );
    return () => {
      dead = true;
    };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    dialog.current?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => setFlash(null), [tab]);

  const libAsked = useRef(false);
  const loadLib = useCallback(async () => {
    libAsked.current = true;
    setLib((l) => ({ ...l, state: "loading", error: null }));
    try {
      const res = await fetch("/api/studio/skills", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as { skills?: SkillLibraryRow[]; needsMigration?: boolean; error?: string };
      if (j.needsMigration) return setLib({ state: "ok", rows: [], needsMigration: true, error: null });
      if (!res.ok) return setLib({ state: "error", rows: [], needsMigration: false, error: j.error || "Gagal memuat Library tim. Coba lagi sebentar." });
      setLib({ state: "ok", rows: Array.isArray(j.skills) ? j.skills : [], needsMigration: false, error: null });
    } catch {
      setLib({ state: "error", rows: [], needsMigration: false, error: "Gagal memuat Library tim. Cek internet lalu coba lagi." });
    }
  }, []);
  // status Library dibutuhkan juga di tab Simpan (tombol simpan ke Library)
  useEffect(() => {
    if ((tab === "library" || tab === "save") && !libAsked.current) void loadLib();
  }, [tab, loadLib]);

  const pickSkill = (skill: StudioSkill, from: string) => {
    setLoaded({ skill, from });
    onTab("import");
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-3"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Skill Studio"
        className="flex max-h-[92dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-t-2xl border border-zinc-800 bg-zinc-900 outline-none sm:rounded-2xl"
        style={{ boxShadow: "var(--shadow-pop)" }}
      >
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0">
            <div className="font-display text-[15px] font-bold">🧠 Skill Studio</div>
            <div className="text-[11.5px] leading-snug text-zinc-500">Simpan & bagikan setelan proyek supaya hasil tim seragam.</div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto shrink-0 rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div role="tablist" aria-label="Bagian Skill" className="grid grid-cols-4 border-b border-zinc-800/80 text-[12px] font-bold sm:text-[12.5px]">
          {TABS.map((x) => (
            <button
              key={x.k}
              type="button"
              role="tab"
              aria-selected={tab === x.k}
              onClick={() => onTab(x.k)}
              className={`min-w-0 px-1 py-2.5 ${tab === x.k ? "text-orange-400 shadow-[inset_0_-2px_0_#f97316]" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <span aria-hidden>{x.icon}</span> {x.name}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {tab === "notes" && <NotesTab director={director} dirName={dirName} onSave={(d) => onApply({ ...target, director: d })} onFlash={setFlash} />}
          {tab === "save" && <SaveTab target={target} dirName={dirName} lib={lib} onSaved={() => void loadLib()} onFlash={setFlash} />}
          {tab === "import" && (
            <ImportTab
              target={target}
              voices={voices}
              loaded={loaded}
              onLoaded={setLoaded}
              onApply={(parts, lexicon) => {
                if (!loaded) return;
                onApply(applySkill(target, loaded.skill, parts, { voices, lexicon }));
                setFlash({ ok: true, text: `✓ Skill “${loaded.skill.name}” diterapkan (${parts.length} bagian).` });
              }}
              onFlash={setFlash}
            />
          )}
          {tab === "library" && <LibraryTab lib={lib} onReload={() => void loadLib()} onUse={(s) => pickSkill(s, "Library tim")} onFlash={setFlash} />}
          {flash && (
            <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-[12.5px] ${flash.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"}`}>
              {flash.text}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// ✍️ Catatan gaya
// ---------------------------------------------------------------------------------------------
function NotesTab({ director, dirName, onSave, onFlash }: { director: Director | null; dirName: string; onSave: (d: Director | undefined) => void; onFlash: (f: Flash) => void }) {
  const [text, setText] = useState(() => (director?.notes ?? []).join("\n"));
  const list = normNotes(text.split("\n"));
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const dirty = list.join("\n") !== (director?.notes ?? []).join("\n");
  const save = () => {
    const next: Director = { hero: director?.hero ?? "Harley", ...(director?.name ? { name: director.name } : {}), ...(list.length ? { notes: list } : {}) };
    onSave(next);
    setText(list.join("\n"));
    onFlash({ ok: true, text: list.length ? `✓ ${list.length} catatan disimpan — dipakai ${dirName} mulai pesan berikutnya.` : "✓ Catatan dikosongkan." });
  };
  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] leading-relaxed text-zinc-400">
        Hal yang ingin selalu diingat <b className="text-zinc-200">{dirName}</b> di proyek ini — mis. koreksi gaya, kata yang dihindari. Satu baris = satu catatan (maks {DIRECTOR_NOTES_MAX}, {DIRECTOR_NOTE_LEN} huruf per baris).
      </p>
      <textarea
        rows={6}
        value={text}
        aria-label="Catatan gaya untuk sutradara"
        placeholder={"Hook maksimal 3 detik, langsung ke masalah\nJangan pakai kata “gacor”\nPenutup selalu ajak follow"}
        onChange={(e) => setText(e.target.value)}
        className="input min-h-[132px] resize-y text-[13px] leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11.5px] ${lines > DIRECTOR_NOTES_MAX ? "text-amber-400" : "text-zinc-500"}`}>
          {list.length}/{DIRECTOR_NOTES_MAX} catatan{lines > DIRECTOR_NOTES_MAX ? " — kelebihan tidak disimpan" : ""}
        </span>
        <span className="flex-1" />
        <button type="button" className="btn-primary px-3.5 py-1.5 text-[13px]" disabled={!dirty} onClick={save}>
          Simpan catatan
        </button>
      </div>
      <p className="text-[11px] leading-snug text-zinc-500">Catatan dikirim sebagai preferensi, bukan perintah sistem — aturan & format rencana sutradara tetap berlaku.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 💾 Simpan sebagai skill
// ---------------------------------------------------------------------------------------------
function SaveTab({ target, dirName, lib, onSaved, onFlash }: { target: SkillTarget; dirName: string; lib: Lib; onSaved: () => void; onFlash: (f: Flash) => void }) {
  const avail = useMemo(() => availableSections(target), [target]);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  // sutradara ikut dicentang hanya kalau bukan bawaan (supaya skill tidak mengganti sutradara pemakainya ke Harley)
  const [parts, setParts] = useState<SkillSection[]>(() => avail.filter((k) => k !== "director" || (!!target.director && target.director.hero !== "Harley")));
  const [busy, setBusy] = useState(false);
  const chosen = parts.filter((k) => avail.includes(k));
  const build = (): StudioSkill | null => {
    if (!name.trim()) {
      onFlash({ ok: false, text: "Isi nama skill dulu." });
      return null;
    }
    const skill = collectSkill(target, chosen, { name, desc });
    if (!skill) onFlash({ ok: false, text: "Centang minimal satu bagian yang ada isinya." });
    return skill;
  };
  const saveLib = async () => {
    const skill = build();
    if (!skill) return;
    setBusy(true);
    try {
      const res = await fetch("/api/studio/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill }) });
      const j = (await res.json().catch(() => ({}))) as { error?: string; needsMigration?: boolean };
      if (!res.ok) onFlash({ ok: false, text: j.needsMigration ? `${MIGRATE} Skill tetap bisa diunduh.` : j.error || "Gagal menyimpan ke Library tim." });
      else {
        onFlash({ ok: true, text: `✓ “${skill.name}” tersimpan di Library tim.` });
        onSaved();
      }
    } catch {
      onFlash({ ok: false, text: "Gagal menyimpan. Cek internet lalu coba lagi." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="label">Nama skill</span>
          <input className="input py-2 text-[13px]" value={name} maxLength={SKILL_NAME_MAX} placeholder="mis. Teaser gaya CS Tracker" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block min-w-0">
          <span className="label">Deskripsi (opsional)</span>
          <input className="input py-2 text-[13px]" value={desc} maxLength={SKILL_DESC_MAX} placeholder="Untuk apa skill ini" onChange={(e) => setDesc(e.target.value)} />
        </label>
      </div>
      <fieldset>
        <legend className="label">Bagian yang disimpan</legend>
        <ul className="space-y-1">
          {SKILL_SECTIONS.map((k) => {
            const ok = avail.includes(k);
            const sum = sectionSummary(target, k, dirName);
            return (
              <li key={k}>
                <label className={`flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 ${ok ? "cursor-pointer hover:bg-zinc-800/60" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                    disabled={!ok}
                    checked={ok && parts.includes(k)}
                    onChange={(e) => setParts((p) => (e.target.checked ? [...p, k] : p.filter((x) => x !== k)))}
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13px] font-semibold text-zinc-200">
                      {SECTION_ICON[k]} {SECTION_LABEL[k]}
                    </span>
                    <span className="block break-words text-[11.5px] text-zinc-500">{ok ? sum : emptyText(k, !!target.voice)}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-[12.5px]"
          disabled={!chosen.length}
          onClick={() => {
            const s = build();
            if (s) {
              download(s);
              onFlash({ ok: true, text: `✓ ${skillFileName(s)} diunduh. Bagikan file ini ke tim, lalu Impor.` });
            }
          }}
        >
          ⬇️ Unduh .json
        </button>
        <button type="button" className="btn-primary px-3 py-1.5 text-[12.5px]" disabled={busy || !chosen.length || lib.needsMigration} onClick={() => void saveLib()}>
          {busy ? "Menyimpan…" : "📚 Simpan ke Library tim"}
        </button>
      </div>
      {lib.needsMigration && <p className="text-[11.5px] text-amber-400">⚠️ {MIGRATE} Unduh & impor file tetap bisa.</p>}
    </div>
  );
}

/** keterangan bagian yang belum bisa disimpan: "butuh rencana" hanya kalau memang belum ada rencana */
function emptyText(k: SkillSection, hasPlan: boolean): string {
  if (k === "notes") return "Belum ada catatan (isi di tab Catatan)";
  if (!hasPlan) return "Belum ada — butuh rencana video dulu";
  if (k === "lexicon") return "Kamus masih kosong — tambah kata di 📖 Kamus ejaan (panel Suara VO)";
  if (k === "mix") return "Masih volume bawaan — atur di 🎚️ Volume (timeline)";
  return "Belum ada isinya";
}

/** daftar SEMUA perubahan kamus dari skill (dari → ke), centang per entri; entri yang mengganti kata jadi kata lain ditandai */
function LexList({
  entries,
  picked,
  onPick,
  onAll,
}: {
  entries: readonly LexChange[];
  picked: readonly string[];
  onPick: (key: string, v: boolean) => void;
  onAll: (v: boolean) => void;
}) {
  const all = entries.every((e) => picked.includes(e.key));
  return (
    <div className="mb-1 ml-8 mr-1 mt-0.5 rounded-lg border border-zinc-800">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-2.5 py-1 text-[11px] text-zinc-500">
        <span className="min-w-0 flex-1">
          {picked.length}/{entries.length} kata dipakai · subtitle tidak berubah
        </span>
        <button type="button" className="min-h-[32px] shrink-0 rounded-md px-2 font-semibold text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" onClick={() => onAll(!all)}>
          {all ? "Kosongkan" : "Centang semua"}
        </button>
      </div>
      <ul className="max-h-60 overflow-y-auto p-1" aria-label="Perubahan kamus ejaan">
        {entries.map((e) => (
          <li key={e.key}>
            <label className={`flex min-w-0 cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-800/60 ${e.risk ? "bg-amber-500/5" : ""}`}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                checked={picked.includes(e.key)}
                onChange={(ev) => onPick(e.key, ev.target.checked)}
                aria-label={`${e.from} jadi ${e.to}`}
              />
              <span className="min-w-0 flex-1 leading-snug">
                <span className="block break-words text-[12.5px] text-zinc-200">
                  <b className="font-semibold">{e.from}</b> → {e.to}
                </span>
                {e.old !== undefined && (
                  <span className="block break-words text-[11px] text-zinc-500">
                    {e.builtin ? "ganti ejaan bawaan" : "ganti ejaanmu"} “{e.old}”
                  </span>
                )}
                {e.risk && <span className="block break-words text-[11px] font-semibold text-amber-400">⚠️ {e.risk.text}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 📥 Impor skill: pilih file → pratinjau → centang → Terapkan
// ---------------------------------------------------------------------------------------------
function ImportTab({
  target,
  voices,
  loaded,
  onLoaded,
  onApply,
  onFlash,
}: {
  target: SkillTarget;
  voices: { id: string; name: string }[] | undefined;
  loaded: Loaded | null;
  onLoaded: (l: Loaded | null) => void;
  /** `lexicon` = kunci entri kamus yang dicentang */
  onApply: (parts: SkillSection[], lexicon: string[]) => void;
  onFlash: (f: Flash) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (loaded ? skillPreview(target, loaded.skill, { voices }) : []), [loaded, target, voices]);
  const lexEntries = useMemo(() => preview.find((p) => p.key === "lexicon")?.entries ?? [], [preview]);
  const [parts, setParts] = useState<SkillSection[]>([]);
  const [lexPick, setLexPick] = useState<string[]>([]);
  // skill baru dimuat -> semua bagian yang bisa diterapkan dicentang; entri kamus yang mengganti kata jadi kata lain TIDAK
  const key = loaded ? `${loaded.from}|${loaded.skill.name}|${loaded.skill.created_at}` : "";
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setParts(preview.filter((p) => p.ok).map((p) => p.key));
    setLexPick(lexEntries.filter((e) => !e.risk).map((e) => e.key));
  }
  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > SKILL_MAX_BYTES) return onFlash({ ok: false, text: "File skill terlalu besar (maks 64 KB)." });
    try {
      const r = normSkill(await f.text());
      if (!r.ok) return onFlash({ ok: false, text: r.error });
      onFlash(null);
      onLoaded({ skill: r.skill, from: f.name.slice(0, 60) });
    } catch {
      onFlash({ ok: false, text: "File tidak bisa dibaca." });
    }
  };
  const lexChosen = lexPick.filter((k) => lexEntries.some((e) => e.key === k));
  // kamus dengan daftar perubahan: ikut diterapkan kalau ada entri yang dicentang (bagiannya mengikuti centang entri)
  const chosen = preview
    .filter((p) => p.ok && (p.key === "lexicon" && lexEntries.length ? lexChosen.length > 0 : parts.includes(p.key)))
    .map((p) => p.key);
  return (
    <div className="space-y-3">
      <input ref={file} type="file" accept=".json,application/json" className="hidden" tabIndex={-1} onChange={(e) => void pick(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-[12.5px]" onClick={() => file.current?.click()}>
          📂 Pilih file skill (.json)
        </button>
        <span className="text-[11.5px] text-zinc-500">atau tekan “Pakai” di Library tim</span>
      </div>
      {loaded && (
        <div className="rounded-xl border border-zinc-800 p-3">
          <div className="min-w-0">
            <div className="break-words text-[14px] font-bold text-zinc-100">🧠 {loaded.skill.name}</div>
            {loaded.skill.desc && <p className="mt-0.5 break-words text-[12.5px] text-zinc-400">{loaded.skill.desc}</p>}
            <p className="mt-0.5 text-[11px] text-zinc-500">
              Dari {loaded.from} · dibuat {fmtDate(loaded.skill.created_at)}
            </p>
          </div>
          <p className="mb-1 mt-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Yang akan berubah</p>
          <ul className="space-y-1">
            {preview.map((p) => (
              <li key={p.key}>
                <label className={`flex min-w-0 items-start gap-2.5 rounded-lg px-2 py-1.5 ${p.ok ? "cursor-pointer hover:bg-zinc-800/60" : "opacity-50"}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-orange-500"
                    disabled={!p.ok}
                    checked={p.ok && (p.key === "lexicon" && lexEntries.length ? lexChosen.length > 0 : parts.includes(p.key))}
                    onChange={(e) => {
                      const v = e.target.checked;
                      // kamus: centang bagian = semua entri yang aman; entri bertanda ⚠️ dicentang satu per satu di daftarnya
                      // (kalau semuanya bertanda ⚠️, centang bagian = semua — peringatannya tampil tepat di bawah)
                      if (p.key === "lexicon" && lexEntries.length) {
                        const safe = lexEntries.filter((x) => !x.risk);
                        return setLexPick(v ? (safe.length ? safe : lexEntries).map((x) => x.key) : []);
                      }
                      setParts((s) => (v ? [...s.filter((x) => x !== p.key), p.key] : s.filter((x) => x !== p.key)));
                    }}
                  />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block text-[13px] font-semibold text-zinc-200">
                      {SECTION_ICON[p.key]} {SECTION_LABEL[p.key]}
                    </span>
                    {p.lines.map((l, i) => (
                      <span key={i} className={`block break-words text-[11.5px] ${l.startsWith("⚠️") ? "text-amber-400" : "text-zinc-500"}`}>
                        {l}
                      </span>
                    ))}
                  </span>
                </label>
                {p.key === "lexicon" && p.ok && p.entries && p.entries.length > 0 && (
                  <LexList
                    entries={p.entries}
                    picked={lexChosen}
                    onPick={(k, v) => setLexPick((s) => (v ? [...s.filter((x) => x !== k), k] : s.filter((x) => x !== k)))}
                    onAll={(v) => setLexPick(v ? p.entries!.map((e) => e.key) : [])}
                  />
                )}
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary px-3.5 py-1.5 text-[13px]" disabled={!chosen.length} onClick={() => onApply(chosen, lexChosen)}>
              Terapkan {chosen.length ? `(${chosen.length})` : ""}
            </button>
            <button type="button" className="btn-ghost px-3.5 py-1.5 text-[13px]" onClick={() => onLoaded(null)}>
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 📚 Library tim
// ---------------------------------------------------------------------------------------------
function LibraryTab({ lib, onReload, onUse, onFlash }: { lib: Lib; onReload: () => void; onUse: (s: StudioSkill) => void; onFlash: (f: Flash) => void }) {
  const [askDel, setAskDel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const del = async (r: SkillLibraryRow) => {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/studio/skills/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) onFlash({ ok: false, text: j.error || "Gagal menghapus skill." });
      else {
        onFlash({ ok: true, text: `✓ “${r.name}” dihapus.` });
        onReload();
      }
    } catch {
      onFlash({ ok: false, text: "Gagal menghapus. Cek internet lalu coba lagi." });
    } finally {
      setBusy(null);
      setAskDel(null);
    }
  };
  if (lib.state === "idle" || lib.state === "loading") return <p className="py-6 text-center text-[13px] text-zinc-500">Memuat Library tim…</p>;
  if (lib.needsMigration)
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-3 text-[12.5px] leading-relaxed text-amber-300">
        📚 {MIGRATE}
        <br />
        <span className="text-amber-200/80">Sementara itu, bagikan skill lewat file: tab Simpan → Unduh .json, lalu teman tim membuka tab Impor.</span>
      </div>
    );
  if (lib.state === "error")
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12.5px] text-red-400">
        <span className="min-w-0 flex-1">{lib.error}</span>
        <button type="button" className="shrink-0 font-semibold underline" onClick={onReload}>
          Coba lagi
        </button>
      </div>
    );
  if (!lib.rows.length) return <p className="py-6 text-center text-[13px] text-zinc-500">Belum ada skill di Library tim. Simpan yang pertama dari tab Simpan.</p>;
  return (
    <ul className="space-y-2">
      {lib.rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-zinc-800 p-3">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1 basis-[200px]">
              <div className="break-words text-[13.5px] font-bold text-zinc-100">{r.name}</div>
              {r.desc && <p className="mt-0.5 break-words text-[12px] text-zinc-400">{r.desc}</p>}
              <p className="mt-0.5 text-[11px] text-zinc-500">
                oleh {r.mine ? "kamu" : r.ownerName} · {fmtDate(r.created_at)}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {r.sections.map((k) => (
                  <span key={k} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10.5px] text-zinc-300">
                    {SECTION_ICON[k]} {SECTION_LABEL[k]}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <button type="button" className="btn-primary px-2.5 py-1 text-[12px]" onClick={() => onUse(r.skill)}>
                Pakai
              </button>
              <button type="button" className="btn-ghost px-2.5 py-1 text-[12px]" aria-label={`Unduh ${r.name}`} onClick={() => download(r.skill)}>
                ⬇️
              </button>
              {r.canDelete && (
                <button type="button" className="btn-ghost px-2.5 py-1 text-[12px] hover:text-red-400" aria-label={`Hapus ${r.name}`} disabled={busy === r.id} onClick={() => setAskDel(r.id)}>
                  🗑
                </button>
              )}
            </div>
          </div>
          {askDel === r.id && (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-300">
              Hapus “{r.name}” dari Library tim?
              <button type="button" className="min-h-[32px] rounded-lg px-2.5 py-1.5 font-semibold text-red-400 underline hover:bg-red-500/10" disabled={busy === r.id} onClick={() => void del(r)}>
                {busy === r.id ? "Menghapus…" : "Ya, hapus"}
              </button>
              <button type="button" className="min-h-[32px] rounded-lg px-2.5 py-1.5 font-semibold text-zinc-400 hover:bg-zinc-800" onClick={() => setAskDel(null)}>
                Batal
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
