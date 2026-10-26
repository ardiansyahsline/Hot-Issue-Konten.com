"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isVideoSrc } from "@/components/remotion/studio/backgrounds";
import { useStudioStatus } from "@/lib/studio/client";
import type { SfxMeta } from "@/lib/studio/sfxMeta";
import { captionLineWidth, captionMaxChars, isTeaserBeatCue, roughWordWidth, teaserCaptionFit, teaserTextLines } from "@/lib/studio/teaserLock";
import {
  PLAN_LAYOUTS,
  MAX_DUR,
  MAX_LINES,
  MAX_WORDS_PER_LINE,
  MIN_DUR,
  SCREENS,
  TRANSITIONS,
  type BgKind,
  type Camera,
  type Card,
  type Dir,
  type Layout,
  type LayoutKind,
  type MusicLevel,
  type Scene,
  type ScreenKind,
  type Side,
  type TransitionKind,
} from "@/lib/studio/timeline";
import { sfxSrc, storagePathOf } from "@/lib/studio/urls";
import FreesoundPanel from "./FreesoundPanel";
import { Field, Num, Seg, Toggle, Txt, UploadBtn } from "./fields";
import { BG_LABEL, CAMERA_LABEL, DIR_LABEL, LAYOUT_LABEL, MUSIC_LABEL, SCREEN_LABEL, TRANSITION_LABEL, commaList, fmtSec, parseNum, wordCount } from "./planUtils";

export type SfxItem = SfxMeta & { src?: string };
export type ScenePatch = Partial<Scene> | ((s: Scene) => Partial<Scene>);

/** perkiraan lama bicara (detik) dari jumlah kata */
const speakSec = (text: string) => wordCount(text) * 0.34;
const MAX_SFX = 8; // sama dengan batas normalizeTimeline (lib/studio/timeline.ts)

// satu SFX diputar dalam satu waktu (tombol ▶ di daftar SFX)
let playing: HTMLAudioElement | null = null;
function listen(src: string) {
  try {
    playing?.pause();
    const a = new Audio(src);
    a.volume = 0.7;
    playing = a;
    void a.play().catch(() => {});
  } catch {}
}
const srcOf = (m: SfxItem) => m.src || sfxSrc(m.file);

const sel = "input py-2 text-[13px]";

/** kartu satu adegan di rencana (bisa dilipat). Semua perubahan lewat onPatch -> normalizeTimeline di PlanCard */
export default function SceneCard({
  scene: s,
  index,
  count,
  open,
  selected,
  sfxList,
  onToggle,
  onPatch,
  onMove,
  onDup,
  onDel,
}: {
  scene: Scene;
  index: number;
  count: number;
  open: boolean;
  selected: boolean;
  sfxList: SfxItem[];
  onToggle: (id: string) => void;
  onPatch: (id: string, p: ScenePatch) => void;
  onMove: (id: string, d: -1 | 1) => void;
  onDup: (id: string) => void;
  onDel: (id: string) => void;
}) {
  const [askDel, setAskDel] = useState(false);
  const [draftLines, setDraftLines] = useState<string[] | null>(null);
  const patch = (p: ScenePatch) => onPatch(s.id, p);
  const setLayout = (p: Partial<Layout>) => patch((x) => ({ layout: { ...x.layout, ...p } }));
  const dur = (d: number) => patch({ dur: Math.min(MAX_DUR, Math.max(MIN_DUR, Math.round(d * 10) / 10)) });

  // peringatan teks layar dihitung dari yang sedang diketik (sebelum dirapikan otomatis)
  const shown = draftLines ?? s.text;
  const long = shown.map((l, i) => ({ i, n: wordCount(l) })).filter((x) => x.n > MAX_WORDS_PER_LINE);
  const voSec = s.vo ? speakSec(s.vo.text) : 0;
  const peek = s.text[0] || s.vo?.text || s.layout.title || s.visual;
  // adegan premium teaser (buatan tangan): VO, SFX, transisi & musik boleh diubah; visual (jenis tampilan, latar, kamera,
  // durasi) dikunci. Teks layar hanya bisa diubah di shot yang memang membacanya (chat, trainAi, montage — lihat teaserLock)
  const textLines = teaserTextLines(s);
  const teaser = textLines !== null;
  const textLocked = textLines === 0;
  // teaser selalu 9:16; baris yang lebih lebar dari kotak aman turun ke baris berikut dan menabrak UI animasi
  const fit = teaser && !textLocked ? teaserCaptionFit(s, "9:16") : null;
  const tooWide = fit ? shown.slice(0, fit.lines).map((l, i) => ({ i, w: captionLineWidth(l, fit.size, roughWordWidth(fit.size)) })).filter((x) => x.w > fit.maxW) : [];
  const headId = `scene-${s.id}`;

  return (
    <div id={headId} className={`rounded-xl border transition ${selected ? "border-orange-500/70 bg-orange-500/[0.04]" : "border-zinc-800"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-2">
        <button
          type="button"
          onClick={() => onToggle(s.id)}
          aria-expanded={open}
          aria-controls={`${headId}-body`}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${selected ? "bg-orange-500 text-white" : "bg-zinc-800 text-zinc-300"}`}>{index + 1}</span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-[13.5px] font-semibold text-zinc-100">{s.name}</span>
              <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-500">{fmtSec(s.dur, 2)}</span>
            </span>
            {!open && peek && <span className="block truncate text-[11.5px] text-zinc-500">{LAYOUT_LABEL[s.layout.kind].split(" ")[0]} {peek}</span>}
          </span>
          <span aria-hidden className={`shrink-0 text-[11px] text-zinc-500 transition ${open ? "rotate-90" : ""}`}>
            ▶
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          <IconBtn label={`Naikkan adegan ${index + 1}`} disabled={index === 0} onClick={() => onMove(s.id, -1)}>
            ↑
          </IconBtn>
          <IconBtn label={`Turunkan adegan ${index + 1}`} disabled={index === count - 1} onClick={() => onMove(s.id, 1)}>
            ↓
          </IconBtn>
          <IconBtn label={`Duplikat adegan ${index + 1}`} onClick={() => onDup(s.id)}>
            ⧉
          </IconBtn>
          <IconBtn label={`Hapus adegan ${index + 1}`} disabled={count <= 1} onClick={() => setAskDel(true)}>
            🗑
          </IconBtn>
        </div>
        {askDel && (
          <div role="alert" className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-2.5 py-1.5 text-[12px] text-red-300">
            Hapus adegan “{s.name}”?
            <button type="button" className="font-semibold text-red-400 underline" onClick={() => (setAskDel(false), onDel(s.id))}>
              Ya, hapus
            </button>
            <button type="button" className="font-semibold text-zinc-400" onClick={() => setAskDel(false)}>
              Batal
            </button>
          </div>
        )}
      </div>

      {open && (
        <div id={`${headId}-body`} className="space-y-3.5 border-t border-zinc-800/70 px-2.5 pb-3 pt-3 sm:px-3">
          {teaser && (
            <p role="note" data-teaser-note className="rounded-xl border border-orange-500/30 bg-orange-500/[0.07] px-3 py-2 text-[12px] leading-relaxed text-orange-200">
              {textLocked
                ? "🎞️ Adegan premium buatan tangan: visual, durasi & teks layar tetap (bagian dari animasi); VO, SFX, transisi dan musik boleh diubah."
                : "🎞️ Adegan premium buatan tangan: visual & durasi tetap; teks layar, VO, SFX, transisi dan musik boleh diubah."}{" "}
              Detik SFX bawaan dikunci karena sinkron dengan gerakan.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama adegan">{(id) => <Txt id={id} value={s.name} maxLength={40} onCommit={(v) => patch({ name: v })} />}</Field>
            <Field label="Durasi" hint={teaser ? "Dikunci di ketukan musik (adegan premium)" : `${MIN_DUR}–${MAX_DUR} detik`}>
              {(id) =>
                teaser ? (
                  <div id={id} className="flex h-9 items-center text-[13px] tabular-nums text-zinc-300">
                    {fmtSec(s.dur, 2)}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="btn-ghost h-9 w-9 shrink-0 p-0" aria-label="Kurangi 0,1 detik" onClick={() => dur(s.dur - 0.1)}>
                      −
                    </button>
                    <Num id={id} value={s.dur} min={MIN_DUR} max={MAX_DUR} commitOnBlur className="w-20 text-center" onCommit={(v) => v !== undefined && patch({ dur: v })} />
                    <button type="button" className="btn-ghost h-9 w-9 shrink-0 p-0" aria-label="Tambah 0,1 detik" onClick={() => dur(s.dur + 0.1)}>
                      +
                    </button>
                    <span className="text-[12px] text-zinc-500">dtk</span>
                  </div>
                )
              }
            </Field>
          </div>

          {/* suara */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="🎙️ Teks VO (tampil di subtitle)"
              hint={
                s.vo && voSec > s.dur - 0.2 ? (
                  <span className="text-amber-400">
                    VO ±{fmtSec(voSec)} — lebih panjang dari adegan. Pendekkan teks atau tambah durasi.
                  </span>
                ) : s.vo ? (
                  `±${wordCount(s.vo.text)} kata · ±${fmtSec(voSec)}`
                ) : (
                  "Kosongkan kalau adegan ini tanpa suara."
                )
              }
            >
              {(id) => <Txt id={id} multiline value={s.vo?.text ?? ""} maxLength={400} onCommit={(v) => patch((x) => ({ vo: v.trim() ? { text: v, spell: x.vo?.spell } : null }))} />}
            </Field>
            <Field label="Ejaan untuk mesin suara" hint="Isi kalau mesin salah baca, mis. “Si-es Treker”, “E-ai”. Subtitle tetap pakai teks asli.">
              {(id) => (
                <Txt
                  id={id}
                  multiline
                  value={s.vo?.spell ?? ""}
                  maxLength={400}
                  placeholder={s.vo ? "Sama dengan teks VO" : "Isi teks VO dulu"}
                  disabled={!s.vo}
                  onCommit={(v) => patch((x) => (x.vo ? { vo: { text: x.vo.text, spell: v || undefined } } : {}))}
                />
              )}
            </Field>
          </div>

          {textLocked ? (
            <Field label="🔤 Teks di layar" hint="Dikunci: teks layar adegan ini digambar langsung di animasi premium (ganti pesannya lewat Teks VO).">
              {(id) => (
                <div id={id} data-teaser-text-locked className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-3 py-2 text-[13px] text-zinc-400">
                  🔒 {s.text.length ? s.text.join(" · ") : "Teks bawaan animasi"}
                </div>
              )}
            </Field>
          ) : (
          <Field
            label="🔤 Teks di layar (satu baris per baris)"
            hint={
              fit && tooWide.length ? (
                <span className="text-amber-400">
                  {tooWide.map((x) => `Baris ${x.i + 1}`).join(" · ")} kepanjangan — bisa turun baris & menabrak animasi. Maks ±{captionMaxChars(fit)} huruf per baris.
                </span>
              ) : teaser && !long.length && shown.length <= MAX_LINES ? (
                `Yang tampil: ${textLines === 1 ? "baris pertama saja" : `${textLines} baris pertama`}, maks ±${fit ? captionMaxChars(fit) : 20} huruf per baris supaya muat satu baris. ${
                  // chat & montage: `text[0] ?? teks bawaan`; trainAi: `lines={text}` → kosong = tanpa teks layar
                  s.layout.shot === "trainAi" ? "Kosongkan = tanpa teks layar." : "Kosongkan untuk teks bawaan animasi."
                }`
              ) : long.length || shown.length > MAX_LINES ? (
                <span className="text-amber-400">
                  {long.map((x) => `Baris ${x.i + 1}: ${x.n} kata`).join(" · ")}
                  {long.length ? " — maks " + MAX_WORDS_PER_LINE + " kata per baris, nanti dipecah otomatis." : ""}
                  {shown.length > MAX_LINES ? ` Maks ${MAX_LINES} baris.` : ""}
                </span>
              ) : (
                `Maks ${MAX_WORDS_PER_LINE} kata per baris biar kebaca di HP.`
              )
            }
          >
            {(id) => (
              <Txt
                id={id}
                multiline
                rows={Math.min(4, Math.max(2, s.text.length))}
                value={s.text.join("\n")}
                onDraft={(v) => setDraftLines(v.split("\n").filter((l) => l.trim()))}
                onDone={() => setDraftLines(null)}
                onCommit={(v) => patch({ text: lines(v) })}
              />
            )}
          </Field>
          )}

          {teaser ? (
            <div className="rounded-xl border border-zinc-800/80 px-3 py-2 text-[12px] text-zinc-400">
              <span className="font-semibold text-zinc-300">🎨 Visual:</span> {s.visual || LAYOUT_LABEL.teaser}
            </div>
          ) : (
            <Field label="🎨 Catatan visual / storyboard" hint="Apa yang terlihat di layar.">
              {(id) => <Txt id={id} multiline value={s.visual} maxLength={400} onCommit={(v) => patch({ visual: v })} />}
            </Field>
          )}

          {/* tampilan (adegan premium teaser: dikunci) */}
          {!teaser && (
            <div className="space-y-3 rounded-xl border border-zinc-800/80 p-2.5 sm:p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Jenis tampilan">
                  {(id) => (
                    <select id={id} className={sel} value={s.layout.kind} onChange={(e) => setLayout({ kind: e.target.value as LayoutKind })}>
                      {PLAN_LAYOUTS.map((k) => (
                        <option key={k} value={k}>
                          {LAYOUT_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Latar">
                  {(id) => (
                    <select id={id} className={sel} value={s.bg.kind} onChange={(e) => patch((x) => ({ bg: { ...x.bg, kind: e.target.value as BgKind } }))}>
                      {(["gradient", "particles", "solid", "grid", ...(s.bg.kind === "media" ? (["media"] as const) : [])] as BgKind[]).map((k) => (
                        <option key={k} value={k}>
                          {BG_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <LayoutFields l={s.layout} set={setLayout} />
            </div>
          )}

          {/* gerak */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Transisi masuk">
              {(id) => (
                <select id={id} className={sel} value={s.transition.kind} onChange={(e) => patch((x) => ({ transition: { ...x.transition, kind: e.target.value as TransitionKind } }))}>
                  {TRANSITIONS.map((k) => (
                    <option key={k} value={k}>
                      {TRANSITION_LABEL[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {["slide", "whip", "mask"].includes(s.transition.kind) ? (
              <Field label="Arah">
                {(id) => (
                  <select id={id} className={sel} value={s.transition.dir ?? "left"} onChange={(e) => patch((x) => ({ transition: { ...x.transition, dir: e.target.value as Dir } }))}>
                    {(Object.keys(DIR_LABEL) as Dir[]).map((k) => (
                      <option key={k} value={k}>
                        {DIR_LABEL[k]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            {s.transition.kind !== "cut" ? (
              <Field label="Lama transisi (dtk)">
                {(id) => <Num id={id} value={s.transition.dur} min={0.1} max={1.2} onCommit={(v) => patch((x) => ({ transition: { ...x.transition, dur: v } }))} />}
              </Field>
            ) : (
              <div className="hidden sm:block" />
            )}
            {!teaser && (
              <Field label="Gerak kamera">
                {(id) => (
                  <select id={id} className={sel} value={s.camera} onChange={(e) => patch({ camera: e.target.value as Camera })}>
                    {(Object.keys(CAMERA_LABEL) as Camera[]).map((k) => (
                      <option key={k} value={k}>
                        {CAMERA_LABEL[k]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            )}
            <Field label="Level musik">
              {(id) => (
                <select id={id} className={sel} value={s.music} onChange={(e) => patch({ music: e.target.value as MusicLevel })}>
                  {(Object.keys(MUSIC_LABEL) as MusicLevel[]).map((k) => (
                    <option key={k} value={k}>
                      {MUSIC_LABEL[k]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="flex items-end pb-2">
              <Toggle on={s.subtitles} onChange={(v) => patch({ subtitles: v })}>
                Subtitle
              </Toggle>
            </div>
          </div>

          <SfxEditor scene={s} sfxList={sfxList} patch={patch} lockAt={teaser ? (c) => isTeaserBeatCue(s, c) : undefined} />
        </div>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

/**
 * daftar SFX adegan: nyala/mati, detik "pukulan", dengar, hapus, tambah dari katalog / Freesound CC0.
 * `lockAt` = cue yang detiknya dikunci (SFX bawaan adegan premium teaser, sinkron dengan gerakan animasinya).
 */
function SfxEditor({ scene: s, sfxList, patch, lockAt }: { scene: Scene; sfxList: SfxItem[]; patch: (p: ScenePatch) => void; lockAt?: (c: Scene["sfx"][number]) => boolean }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const [fsOpen, setFsOpen] = useState(false);
  /** id SFX Freesound yang baru ditambah, menunggu katalog termuat ulang */
  const [want, setWant] = useState<string | null>(null);
  const freesound = useStudioStatus()?.freesound === true;
  const byId = useMemo(() => new Map(sfxList.map((m) => [m.id, m])), [sfxList]);

  // cue SFX Freesound dipasang setelah SFX-nya ada di katalog (kalau belum, cue-nya dibuang saat timeline dirapikan)
  useEffect(() => {
    if (!want || !byId.has(want)) return;
    const id = want;
    setWant(null);
    patch((x) => (x.sfx.length >= MAX_SFX ? {} : { sfx: [...x.sfx, { id, at: 0, on: true }] }));
  }, [want, byId, patch]);
  const found = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? sfxList.filter((m) => [m.id, m.cat, m.use, ...m.tags].join(" ").toLowerCase().includes(t)) : sfxList;
    return list.slice(0, 40);
  }, [q, sfxList]);
  const setCue = (i: number, p: Partial<Scene["sfx"][number]>) => patch((x) => ({ sfx: x.sfx.map((c, k) => (k === i ? { ...c, ...p } : c)) }));
  const full = s.sfx.length >= MAX_SFX;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-400">🔊 SFX ({s.sfx.length}/{MAX_SFX})</span>
        <button type="button" disabled={full} aria-expanded={adding} className="text-[12px] font-semibold text-orange-400 hover:text-orange-300 disabled:opacity-40" onClick={() => setAdding((v) => !v)}>
          {adding ? "Tutup" : "＋ Tambah SFX"}
        </button>
      </div>
      {s.sfx.length === 0 && !adding && <p className="text-[11.5px] text-zinc-500">Belum ada SFX di adegan ini.</p>}
      <ul className="space-y-1.5">
        {s.sfx.map((c, i) => {
          const m = byId.get(c.id);
          // kunci tidak pakai indeks (daftar diurut ulang per waktu): id + urutan ke-n untuk id yang sama
          const nth = s.sfx.slice(0, i).filter((x) => x.id === c.id).length;
          return (
            <li key={`${c.id}#${nth}`} className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2 py-1.5 ${c.on ? "border-zinc-800" : "border-zinc-800/60 opacity-60"}`}>
              <Toggle on={c.on} label={`SFX ${c.id} nyala`} onChange={(v) => setCue(i, { on: v })} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-zinc-200">{c.id}</span>
                {m?.use && <span className="block truncate text-[11px] text-zinc-500">{m.use}</span>}
              </span>
              {lockAt?.(c) ? (
                <span className="flex items-center gap-1 text-[11.5px] tabular-nums text-zinc-500" title="Detik ini sinkron dengan gerakan animasi premium (dikunci)" aria-label={`Detik pukulan SFX ${c.id}: ${fmtSec(c.at, 2)}, dikunci`}>
                  di 🔒 {fmtSec(c.at, 2)}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11.5px] text-zinc-500">
                  di
                  <Num value={c.at} min={0} max={s.dur} commitOnBlur label={`Detik pukulan SFX ${c.id}`} className="w-16 px-2 py-1 text-center text-[12px]" onCommit={(v) => setCue(i, { at: v ?? 0 })} />
                  dtk
                </span>
              )}
              {m && (
                <button type="button" aria-label={`Dengar ${c.id}`} title="Dengar" className="rounded-md px-1.5 py-1 text-[12px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" onClick={() => listen(srcOf(m))}>
                  ▶
                </button>
              )}
              <button type="button" aria-label={`Hapus SFX ${c.id}`} title="Hapus" className="rounded-md px-1.5 py-1 text-[12px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400" onClick={() => patch((x) => ({ sfx: x.sfx.filter((_, k) => k !== i) }))}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      {adding && (
        <div className="rounded-xl border border-zinc-800 p-2">
          <input
            className="input mb-2 py-2 text-[13px]"
            placeholder="Cari SFX, mis. whoosh, boom, ui, koin…"
            aria-label="Cari SFX"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
            {found.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-zinc-800/60">
                <button type="button" aria-label={`Dengar ${m.id}`} className="shrink-0 rounded-md px-1.5 py-1 text-[12px] text-zinc-400 hover:text-zinc-100" onClick={() => listen(srcOf(m))}>
                  ▶
                </button>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-zinc-200">
                    {m.id} <span className="font-normal text-zinc-500">· {m.cat} · {fmtSec(m.dur)}</span>
                  </span>
                  <span className="block truncate text-[11px] text-zinc-500">{m.use}</span>
                </span>
                <button
                  type="button"
                  disabled={full}
                  className="shrink-0 rounded-lg border border-zinc-700 px-2 py-1 text-[11.5px] font-semibold text-zinc-200 hover:border-orange-500 hover:text-orange-400 disabled:opacity-40"
                  onClick={() => patch((x) => ({ sfx: [...x.sfx, { id: m.id, at: 0, on: true }] }))}
                >
                  Tambah
                </button>
              </li>
            ))}
            {!found.length && <li className="px-1.5 py-2 text-[12px] text-zinc-500">Tidak ketemu. Coba kata lain.</li>}
          </ul>
          {freesound &&
            (fsOpen ? (
              <FreesoundPanel initial={q.trim()} full={full} onAdd={setWant} onClose={() => setFsOpen(false)} />
            ) : (
              <button type="button" className="mt-2 text-[12px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => setFsOpen(true)}>
                🌐 Cari SFX gratis (Freesound CC0)
              </button>
            ))}
          <p className="mt-1.5 text-[11px] text-zinc-500">Maks {MAX_SFX} SFX per adegan & maks 2 SFX keras di detik yang sama (sisanya otomatis dibuang).</p>
        </div>
      )}
    </div>
  );
}

const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);
/** "12, 18, 25.5" -> angka. Kalau pakai titik koma ("12,5; 18"), koma dianggap desimal */
const chartValues = (v: string) =>
  (v.includes(";") ? v.split(";") : v.split(/[,\s]+/)).map((x) => parseNum(x)).filter((n): n is number => n !== null);

/** isian utama sesuai jenis tampilan */
function LayoutFields({ l, set }: { l: Layout; set: (p: Partial<Layout>) => void }) {
  const t = (label: string, key: "title" | "subtitle" | "kicker" | "name" | "role" | "prefix" | "suffix" | "label" | "tagline" | "button" | "by", max = 90, hint?: string) => (
    <Field label={label} hint={hint}>
      {(id) => <Txt id={id} value={l[key] ?? ""} maxLength={max} onCommit={(v) => set({ [key]: v || undefined } as Partial<Layout>)} />}
    </Field>
  );
  const items = (label: string, hint?: string) => (
    <Field label={label} hint={hint ?? "Satu poin per baris."}>
      {(id) => <Txt id={id} multiline rows={3} value={(l.items ?? []).join("\n")} onCommit={(v) => set({ items: lines(v) })} />}
    </Field>
  );
  switch (l.kind) {
    case "kinetic":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kata yang disorot" hint="Pisahkan dengan koma. Diberi warna brand.">
            {(id) => <Txt id={id} value={(l.emphasis ?? []).join(", ")} onCommit={(v) => set({ emphasis: commaList(v) })} />}
          </Field>
          <div>
            <div className="mb-1 text-xs font-semibold text-zinc-400">Gaya teks</div>
            <Seg
              label="Gaya teks"
              size="sm"
              value={l.style ?? "punch"}
              options={[
                ["punch", "Hentak"],
                ["stack", "Bertumpuk"],
                ["type", "Ketik"],
              ]}
              onChange={(v) => set({ style: v })}
            />
          </div>
        </div>
      );
    case "title":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Teks kecil di atas", "kicker", 50)}
          {t("Judul", "title")}
          <div className="sm:col-span-2">{t("Sub judul", "subtitle", 140)}</div>
        </div>
      );
    case "lowerThird":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Nama", "name", 50)}
          {t("Peran / jabatan", "role", 60)}
        </div>
      );
    case "counter":
      return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Dari angka">{(id) => <Num id={id} value={l.from} onCommit={(v) => set({ from: v })} />}</Field>
          <Field label="Ke angka">{(id) => <Num id={id} value={l.to} onCommit={(v) => set({ to: v })} />}</Field>
          <Field label="Angka desimal">{(id) => <Num id={id} value={l.decimals} min={0} max={3} placeholder="0" onCommit={(v) => set({ decimals: v === undefined ? undefined : Math.round(v) })} />}</Field>
          {t("Awalan (mis. Rp)", "prefix", 12)}
          {t("Akhiran (mis. %)", "suffix", 16)}
          {t("Keterangan", "label", 80)}
        </div>
      );
    case "chart":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <div className="mb-1 text-xs font-semibold text-zinc-400">Jenis grafik</div>
            <Seg
              label="Jenis grafik"
              size="sm"
              value={l.chart?.kind ?? "line"}
              options={[
                ["line", "Garis"],
                ["bar", "Batang"],
                ["area", "Area"],
              ]}
              onChange={(kind) => l.chart && set({ chart: { ...l.chart, kind } })}
            />
          </div>
          <Field label="Angka-angka" hint="Pisahkan dengan koma, minimal 2 angka. Mis. 12, 18, 25.5, 40">
            {(id) => (
              <Txt
                id={id}
                value={(l.chart?.values ?? []).join(", ")}
                onCommit={(v) => set({ chart: { kind: l.chart?.kind ?? "line", values: chartValues(v), labels: l.chart?.labels, unit: l.chart?.unit } })}
              />
            )}
          </Field>
          <Field label="Label sumbu" hint="Pisahkan dengan koma. Mis. Jan, Feb, Mar">
            {(id) => <Txt id={id} value={(l.chart?.labels ?? []).join(", ")} onCommit={(v) => l.chart && set({ chart: { ...l.chart, labels: commaList(v) } })} />}
          </Field>
          <Field label="Satuan">{(id) => <Txt id={id} value={l.chart?.unit ?? ""} maxLength={12} onCommit={(v) => l.chart && set({ chart: { ...l.chart, unit: v || undefined } })} />}</Field>
        </div>
      );
    case "phone":
    case "laptop":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Layar yang tampil">
            {(id) => (
              <select
                id={id}
                className={sel}
                value={l.screen ?? "dashboard"}
                onChange={(e) => {
                  const screen = e.target.value as ScreenKind;
                  // klip video hanya tampil di layar Media → lepas saat pindah layar (tidak tersimpan diam-diam)
                  set({ screen, ...(screen !== "media" && isVideoSrc(l.src) ? { src: null } : {}) });
                }}
              >
                {SCREENS.map((k) => (
                  <option key={k} value={k}>
                    {SCREEN_LABEL[k]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Kemiringan 3D (derajat)" hint="-25 sampai 25. 0 = lurus.">
            {(id) => <Num id={id} value={l.tilt} min={-25} max={25} placeholder="0" onCommit={(v) => set({ tilt: v })} />}
          </Field>
          {/* layar Media / Website menampilkan layout.src (Website: gambar pratinjau, opsional) */}
          {l.screen === "media" && (
            <div className="sm:col-span-2">
              <SrcUpload src={l.src} accept="image/*,video/*" what="klip / gambar" empty="Foto / klip yang tampil di dalam layar." onChange={(src) => set({ src })} />
            </div>
          )}
          {l.screen === "website" && (
            <div className="sm:col-span-2">
              <SrcUpload src={l.src} accept="image/*" what="gambar website" empty="Opsional: screenshot website. Kosong = contoh website otomatis." onChange={(src) => set({ src })} />
            </div>
          )}
          <div className="sm:col-span-2">{items("Isi layar (opsional)", "Satu baris per item, mis. judul issue / pesan chat.")}</div>
        </div>
      );
    case "logo":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Nama / judul", "title")}
          {t("Tagline", "tagline")}
        </div>
      );
    case "split":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <SideFields label="Kiri" side={l.left} onChange={(left) => set({ left })} />
          <SideFields label="Kanan" side={l.right} onChange={(right) => set({ right })} />
        </div>
      );
    case "features":
      return <CardsFields cards={l.cards ?? []} onChange={(cards) => set({ cards })} />;
    case "cta":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Ajakan", "title")}
          {t("Teks tombol", "button", 40)}
          <div className="sm:col-span-2">{t("Teks kecil", "subtitle", 140)}</div>
        </div>
      );
    case "media":
      return (
        <div className="space-y-3">
          <SrcUpload src={l.src} accept="image/*,video/*" what="klip / gambar" empty="Bisa juga kirim lewat chat (📎 Klip/gambar)." onChange={(src) => set({ src })} />
          <div className="flex flex-wrap items-center gap-4">
            <Seg
              label="Cara tampil"
              size="sm"
              value={l.fit ?? "cover"}
              options={[
                ["cover", "Penuh layar"],
                ["contain", "Utuh"],
              ]}
              onChange={(fit) => set({ fit })}
            />
            <Toggle on={l.kenburns !== false} onChange={(kenburns) => set({ kenburns })}>
              Zoom pelan
            </Toggle>
          </div>
        </div>
      );
    case "quote":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {t("Kutipan", "title")}
          {t("Oleh", "by", 60)}
        </div>
      );
  }
}

/** upload gambar / klip untuk layout.src + nama file & tombol Lepas */
function SrcUpload({ src, accept, what, empty, onChange }: { src: string | null | undefined; accept: string; what: string; empty: string; onChange: (src: string | null) => void }) {
  const name = storagePathOf(src)?.split("/").pop();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <UploadBtn accept={accept} sub="media" label={src ? `🔁 Ganti ${what}` : `⬆️ Upload ${what}`} onDone={(r) => onChange(r.src)} />
      {src ? (
        <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-zinc-400">
          <span className="truncate">📎 {name || "file terpasang"}</span>
          <button type="button" className="font-semibold text-zinc-500 hover:text-red-400" onClick={() => onChange(null)}>
            Lepas
          </button>
        </span>
      ) : (
        <span className="text-[11.5px] text-zinc-500">{empty}</span>
      )}
    </div>
  );
}

function SideFields({ label, side, onChange }: { label: string; side: Side | undefined; onChange: (s: Side) => void }) {
  const s: Side = side ?? { title: "", items: [], tone: "neutral" };
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800/70 p-2">
      <div className="text-xs font-semibold text-zinc-400">{label}</div>
      <Txt label={`Judul sisi ${label}`} placeholder="Judul" value={s.title} maxLength={60} onCommit={(title) => onChange({ ...s, title })} />
      <Txt label={`Poin sisi ${label}`} placeholder="Satu poin per baris" multiline rows={3} value={(s.items ?? []).join("\n")} onCommit={(v) => onChange({ ...s, items: lines(v) })} />
      <Seg
        label={`Nada sisi ${label}`}
        size="sm"
        value={s.tone ?? "neutral"}
        options={[
          ["bad", "❌ Masalah"],
          ["good", "✅ Solusi"],
          ["neutral", "Netral"],
        ]}
        onChange={(tone) => onChange({ ...s, tone })}
      />
    </div>
  );
}

function CardsFields({ cards, onChange }: { cards: Card[]; onChange: (c: Card[]) => void }) {
  const set = (i: number, p: Partial<Card>) => onChange(cards.map((c, k) => (k === i ? { ...c, ...p } : c)));
  return (
    <div className="space-y-2">
      {cards.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-zinc-800/70 p-2">
          <div className="flex items-center gap-1.5">
            <Txt label={`Ikon kartu ${i + 1}`} placeholder="⚡" value={c.icon ?? ""} maxLength={8} className="w-14 shrink-0 px-2 text-center" onCommit={(icon) => set(i, { icon: icon || undefined })} />
            <Txt label={`Judul kartu ${i + 1}`} placeholder="Judul" value={c.title} maxLength={40} onCommit={(title) => set(i, { title })} />
            <button type="button" aria-label={`Hapus kartu ${i + 1}`} className="h-9 shrink-0 rounded-lg px-2 text-[12px] text-zinc-500 hover:bg-zinc-800 hover:text-red-400" onClick={() => onChange(cards.filter((_, k) => k !== i))}>
              ✕
            </button>
          </div>
          <Txt label={`Keterangan kartu ${i + 1}`} placeholder="Keterangan singkat" value={c.desc ?? ""} maxLength={90} onCommit={(desc) => set(i, { desc: desc || undefined })} />
        </div>
      ))}
      {cards.length < 4 && (
        <button type="button" className="text-[12px] font-semibold text-orange-400 hover:text-orange-300" onClick={() => onChange([...cards, { title: `Fitur ${cards.length + 1}` }])}>
          ＋ Tambah kartu
        </button>
      )}
    </div>
  );
}
