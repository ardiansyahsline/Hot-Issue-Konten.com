"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import HeroArt from "@/components/ai/HeroArt";
import { HERO_NAMES, personaOf } from "@/lib/aiPersona";
import { CHAR_PREFIX, registerChar, type CustomChar } from "@/lib/customChar";
import type { Director } from "@/lib/studio/timeline";
import { createClient } from "@/lib/supabase/client";

/** sutradara bawaan Studio (sama dengan DIRECTOR_HERO di lib/studio/director.ts — file itu tidak diimpor ke browser) */
export const DEFAULT_DIRECTOR = "Harley";

// ---------- karakter buatan user (ai_characters, RLS: hanya milik sendiri) ----------
// Satu daftar bersama untuk semua pemakai di halaman (header chat, panel Suara VO, Skill), selalu disegarkan: tiap kali dipasang,
// dropdown dibuka, dan tab kembali terlihat — karakter yang baru dibuat / dihapus di tab AI langsung ikut tanpa muat ulang halaman.
// Selama disegarkan daftar lama tetap tampil; gagal → daftar lama tetap. Daftar dikaitkan ke user yang login: ganti akun → kosong
// dulu (karakter user sebelumnya tidak pernah tampil).
type CharState = { uid: string | null; chars: CustomChar[]; loaded: boolean };
const EMPTY: CharState = { uid: null, chars: [], loaded: false };
let charState: CharState = EMPTY;
const charSubs = new Set<() => void>();
let inflight: Promise<void> | null = null;
let authHooked = false;
const setChars = (next: CharState) => {
  charState = next;
  charSubs.forEach((f) => f());
};

async function fetchChars(sb: ReturnType<typeof createClient>): Promise<CustomChar[] | null> {
  try {
    const { data, error } = await sb.from("ai_characters").select("id, name, mbti, avatar, profile, created_at").order("created_at");
    if (error || !Array.isArray(data)) return null;
    const list = (data as CustomChar[]).filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && c.avatar && c.profile);
    // avatar & tipe karakter dikenali HeroArt / HelperLine lewat namanya
    list.forEach((c) => {
      try {
        registerChar(c);
      } catch {}
    });
    return list;
  } catch {
    return null;
  }
}

/** muat ulang daftar karakter (permintaan yang sedang jalan dipakai bersama) */
export function refreshChars(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const sb = createClient();
      const uid = (await sb.auth.getSession()).data.session?.user?.id ?? "";
      if (!uid) return setChars({ uid: "", chars: [], loaded: true });
      if (charState.uid !== uid) setChars({ uid, chars: [], loaded: false });
      const list = await fetchChars(sb);
      if (charState.uid !== uid) return; // akun berganti selama memuat
      if (list) setChars({ uid, chars: list, loaded: true });
      else if (!charState.loaded) setChars({ ...charState, loaded: true }); // tabel belum ada / gagal pertama → [] (hero bawaan tetap jalan)
    } catch {
      if (!charState.loaded) setChars({ ...charState, loaded: true });
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/**
 * Server tidak bisa memakai karakter ini (dihapus / bukan milik user) → anggap benar: karakter dikeluarkan dari daftar sekarang
 * juga (header, panel Suara VO & Skill langsung menampilkan Harley), lalu daftar disegarkan.
 */
export function charUnavailable(hero: string | null | undefined) {
  if (!hero?.startsWith(CHAR_PREFIX)) return;
  const id = hero.slice(CHAR_PREFIX.length).toLowerCase();
  if (charState.chars.some((c) => c.id.toLowerCase() === id)) setChars({ ...charState, chars: charState.chars.filter((c) => c.id.toLowerCase() !== id) });
  void refreshChars();
}

let lastWake = 0;
let unwake: (() => void) | null = null;
function subscribeChars(f: () => void) {
  charSubs.add(f);
  if (charSubs.size === 1) {
    // tab kembali terlihat / jendela fokus lagi (mis. karakter dibuat di tab lain) → segarkan (maks sekali per 2 dtk)
    const wake = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastWake < 2000) return;
      lastWake = Date.now();
      void refreshChars();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    unwake = () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }
  if (!authHooked) {
    authHooked = true;
    try {
      // login / logout di tab yang sama → daftar akun lama dibuang
      createClient().auth.onAuthStateChange((_e, session) => {
        const uid = session?.user?.id ?? "";
        if (charState.uid !== null && charState.uid !== uid) {
          setChars({ uid, chars: [], loaded: !uid });
          if (uid) void refreshChars();
        }
      });
    } catch {}
  }
  return () => {
    charSubs.delete(f);
    if (!charSubs.size) {
      unwake?.();
      unwake = null;
    }
  };
}
const getChars = () => charState;
const getServerChars = () => EMPTY;

/** karakter buatan user yang bisa dipilih jadi sutradara. Tabel belum ada / gagal -> [] (pilihan hero bawaan tetap jalan) */
export function useMyChars(): { chars: CustomChar[]; loaded: boolean } {
  const s = useSyncExternalStore(subscribeChars, getChars, getServerChars);
  // tiap kali dipasang (mis. kembali ke Studio dari tab AI) → daftar disegarkan; daftar lama tampil selama memuat
  useEffect(() => {
    void refreshChars();
  }, []);
  return s;
}

/**
 * Sutradara yang benar-benar dipakai untuk pilihan ini (nama untuk tampilan + catatan kalau pilihan tidak bisa dipakai).
 * Karakter buatan yang sudah dihapus / bukan milik user -> Harley (server melakukan hal yang sama).
 */
export function activeDirector(d: Director | null | undefined, chars: readonly CustomChar[], loaded: boolean): { name: string; custom: boolean; note: string | null } {
  if (!d) return { name: DEFAULT_DIRECTOR, custom: false, note: null };
  if (d.hero.startsWith(CHAR_PREFIX)) {
    const id = d.hero.slice(CHAR_PREFIX.length).toLowerCase();
    const c = chars.find((x) => x.id.toLowerCase() === id);
    if (c) return { name: c.name, custom: true, note: null };
    if (!loaded) return { name: d.name || DEFAULT_DIRECTOR, custom: true, note: null };
    return { name: DEFAULT_DIRECTOR, custom: false, note: `Karakter ${d.name ? `“${d.name}” ` : ""}tidak ditemukan — sementara pakai ${DEFAULT_DIRECTOR}.` };
  }
  if (HERO_NAMES.includes(d.hero)) return { name: d.hero, custom: false, note: null };
  return { name: DEFAULT_DIRECTOR, custom: false, note: `Sutradara “${d.hero}” tidak dikenal — pakai ${DEFAULT_DIRECTOR}.` };
}

/** pilihan baru (catatan gaya tetap ikut). Harley tanpa catatan = kosong (bawaan) */
function pickDirector(cur: Director | null | undefined, hero: string, name?: string): Director | null {
  const notes = cur?.notes?.length ? cur.notes : undefined;
  if (hero === DEFAULT_DIRECTOR && !notes) return null;
  return { hero, ...(name ? { name } : {}), ...(notes ? { notes } : {}) };
}

/**
 * Dropdown "Sutradara: Harley ▾" di header chat Studio Pro: hero bawaan + karakter buatan user (yang sudah dilatih).
 * Pilihan disimpan per proyek (timeline.director); catatan gaya diatur lewat tombol ✍️ (panel Skill).
 */
export default function DirectorPicker({
  value,
  onChange,
  chars,
  loaded,
  busy,
  note,
  onNotes,
}: {
  value: Director | null | undefined;
  onChange: (d: Director | null) => void;
  chars: readonly CustomChar[];
  loaded: boolean;
  /** sutradara sedang menjawab (avatar bergerak; ganti sutradara tetap boleh untuk pesan berikutnya) */
  busy?: boolean;
  /** catatan dari server (mis. karakter tidak bisa dibaca) */
  note?: string | null;
  onNotes?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const act = activeDirector(value, chars, loaded);
  const hero = value?.hero ?? DEFAULT_DIRECTOR;
  const notes = value?.notes?.length ?? 0;
  const shownNote = act.note ?? note ?? null;

  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent | TouchEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("touchstart", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("touchstart", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const choose = (h: string, name?: string) => {
    setOpen(false);
    if (h !== hero || (name && name !== value?.name)) onChange(pickDirector(value, h, name));
  };
  const builtins = [DEFAULT_DIRECTOR, ...HERO_NAMES.filter((h) => h !== DEFAULT_DIRECTOR)];

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Ganti sutradara (sekarang ${act.name})`}
        onClick={() => {
          // daftar karakter disegarkan tiap dropdown dibuka (karakter baru / yang dihapus di tab AI langsung ikut)
          if (!open) void refreshChars();
          setOpen((v) => !v);
        }}
        className="flex w-full min-w-0 items-center gap-2 rounded-xl py-0.5 pl-0.5 pr-1.5 text-left transition hover:bg-zinc-800/60"
      >
        <span className="flex h-8 w-8 shrink-0 items-end justify-center overflow-hidden rounded-full bg-orange-500/10">
          <HeroArt hero={act.name} size={38} still={!busy} talk={busy} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex min-w-0 items-center gap-1 text-[14px] font-bold">
            <span className="shrink-0 font-semibold text-zinc-500">Sutradara:</span>
            <span className="truncate">{act.name}</span>
            <span aria-hidden className="shrink-0 text-[11px] font-normal text-zinc-500">
              ▾
            </span>
          </span>
          {shownNote ? (
            // peringatan dibaca utuh: boleh 2 baris di HP (+ title untuk teks lengkap)
            <span title={shownNote} className="line-clamp-2 block whitespace-normal break-words text-[11.5px] leading-snug text-amber-400">
              ⚠️ {shownNote}
            </span>
          ) : (
            <span className="block truncate text-[11.5px] text-zinc-500">{notes ? `✍️ ${notes} catatan gaya · ketik ide → cek rencana → preview` : "Ketik ide → cek rencana → preview → download"}</span>
          )}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-30 mt-1.5 flex max-h-[min(62vh,520px)] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900"
          style={{ boxShadow: "var(--shadow-pop)" }}
        >
          <ul role="listbox" aria-label="Pilih sutradara" className="min-h-0 flex-1 overflow-y-auto p-1">
            <li role="presentation" className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              🧠 Karakter buatanmu
            </li>
            {!loaded ? (
              <li role="presentation" className="px-2.5 py-1.5 text-[12px] text-zinc-500">
                Memuat…
              </li>
            ) : chars.length ? (
              chars.map((c) => (
                <Option
                  key={c.id}
                  selected={hero === `${CHAR_PREFIX}${c.id.toLowerCase()}`}
                  hero={c.name}
                  title={c.name}
                  sub={c.profile?.version === 2 && c.profile.roleLabel ? `Dilatih: ${c.profile.roleLabel} · ${c.mbti}` : `Buatanmu · ${c.mbti}`}
                  onPick={() => choose(`${CHAR_PREFIX}${c.id.toLowerCase()}`, c.name)}
                />
              ))
            ) : (
              <li role="presentation" className="px-2.5 py-1.5 text-[12px] leading-snug text-zinc-500">
                Belum ada. Buat & latih karaktermu di tab AI (Train your AI), lalu pilih di sini.
              </li>
            )}
            <li role="presentation" className="px-2.5 pb-1 pt-2.5 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
              🎬 Hero bawaan
            </li>
            {builtins.map((h) => {
              const p = personaOf(h);
              return (
                <Option
                  key={h}
                  selected={hero === h}
                  hero={h}
                  title={h === DEFAULT_DIRECTOR ? `${h} (bawaan)` : h}
                  sub={`${p.label} · ${p.type}`}
                  onPick={() => choose(h)}
                />
              );
            })}
          </ul>
          {onNotes && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onNotes();
              }}
              className="flex items-center gap-2 border-t border-zinc-800 px-3 py-2.5 text-left text-[12.5px] font-semibold text-zinc-300 transition hover:bg-zinc-800"
            >
              ✍️ Catatan gaya untuk sutradara{notes ? ` (${notes})` : ""}
              <span className="ml-auto text-[11px] font-normal text-zinc-500">atur ›</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Option({ selected, hero, title, sub, onPick }: { selected: boolean; hero: string; title: string; sub: string; onPick: () => void }) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${selected ? "bg-orange-500/10 text-orange-400" : "text-zinc-200 hover:bg-zinc-800"}`}
      >
        <span className="flex h-7 w-7 shrink-0 items-end justify-center overflow-hidden rounded-full bg-orange-500/10">
          <HeroArt hero={hero} size={32} still />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold">{title}</span>
          <span className="block truncate text-[11px] text-zinc-500">{sub}</span>
        </span>
        {selected && (
          <span aria-hidden className="shrink-0 text-[13px] font-bold">
            ✓
          </span>
        )}
      </button>
    </li>
  );
}
