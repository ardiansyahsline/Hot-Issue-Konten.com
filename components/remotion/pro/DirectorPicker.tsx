"use client";

import { useEffect, useRef, useState } from "react";
import HeroArt from "@/components/ai/HeroArt";
import { HERO_NAMES, personaOf } from "@/lib/aiPersona";
import { CHAR_PREFIX, registerChar, type CustomChar } from "@/lib/customChar";
import type { Director } from "@/lib/studio/timeline";
import { createClient } from "@/lib/supabase/client";

/** sutradara bawaan Studio (sama dengan DIRECTOR_HERO di lib/studio/director.ts — file itu tidak diimpor ke browser) */
export const DEFAULT_DIRECTOR = "Harley";

// ---------- karakter buatan user (ai_characters, RLS: hanya milik sendiri) — dimuat sekali per user per halaman ----------
// cache dikaitkan ke user yang login (ganti akun di tab yang sama tidak melihat karakter user sebelumnya);
// hasil gagal tidak di-cache (muat berikutnya mencoba lagi)
let charsCache: { uid: string; p: Promise<CustomChar[] | null> } | null = null;
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
async function loadChars(): Promise<CustomChar[]> {
  try {
    const sb = createClient();
    const uid = (await sb.auth.getSession()).data.session?.user?.id ?? "";
    if (!uid) return [];
    if (charsCache?.uid !== uid) {
      const p = fetchChars(sb);
      charsCache = { uid, p };
      void p.then((r) => {
        if (!r && charsCache?.p === p) charsCache = null;
      });
    }
    return (await charsCache.p) ?? [];
  } catch {
    return [];
  }
}

/** karakter buatan user yang bisa dipilih jadi sutradara. Tabel belum ada / gagal -> [] (pilihan hero bawaan tetap jalan) */
export function useMyChars(): { chars: CustomChar[]; loaded: boolean } {
  const [s, setS] = useState<{ chars: CustomChar[]; loaded: boolean }>({ chars: [], loaded: false });
  useEffect(() => {
    let dead = false;
    void loadChars().then((chars) => !dead && setS({ chars, loaded: true }));
    return () => {
      dead = true;
    };
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
        onClick={() => setOpen((v) => !v)}
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
          <span className="block truncate text-[11.5px] text-zinc-500">
            {shownNote ? <span className="text-amber-400">⚠️ {shownNote}</span> : notes ? `✍️ ${notes} catatan gaya · ketik ide → cek rencana → preview` : "Ketik ide → cek rencana → preview → download"}
          </span>
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
