"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { MIX_MAX_DB, MIX_MIN_DB } from "@/lib/studio/timeline";

/** -3 → "−3 dB", 2.5 → "+2,5 dB", 0 → "0 dB" */
export const fmtDb = (db: number): string => {
  const v = Math.round(db * 10) / 10;
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${String(Math.abs(v)).replace(".", ",")} dB`;
};

/** kata awam untuk volume (dB dari bawaan) */
export function dbWord(db: number): string {
  if (db <= -18) return "Hampir hening";
  if (db <= -9) return "Sangat pelan";
  if (db < -1.5) return "Pelan";
  if (db <= 1.5) return "Normal";
  return "Keras";
}

/** jeda minimal antar kiriman saat slider digeser (preview ikut ±10x per detik, tidak membuat halaman berat) */
const SEND_MS = 90;
/** dua ketukan dalam jeda ini = kembali ke 0 dB */
const DOUBLE_TAP_MS = 320;
/** sesudah ketuk 2x, nilai dari ketukan itu diabaikan selama ini */
const HOLD_MS = 450;
/** ketukan = jari bergeser < TAP_MOVE_PX; ketukan kedua harus < TAP_NEAR_PX dari ketukan pertama */
const TAP_MOVE_PX = 12;
const TAP_NEAR_PX = 40;

/**
 * Slider volume dB (bawaan -24..+6, langkah 0,5): angka dB + kata awam (Pelan / Normal / Keras), ketuk 2x / klik 2x = 0 dB,
 * tombol ↺ kalau ≠ 0. Selama digeser nilainya dikirim berkala (`onChange`) supaya preview langsung terdengar, lalu sekali lagi
 * saat dilepas. Ramah sentuh: tinggi area geser 32 px; di HP 2 baris (nama + angka di atas, slider selebar kartu di bawah).
 */
export default function DbSlider({
  label,
  icon,
  value,
  onChange,
  min = MIX_MIN_DB,
  max = MIX_MAX_DB,
  step = 0.5,
  disabled,
  note,
  testId,
}: {
  label: string;
  icon?: string;
  value: number;
  onChange: (db: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** keterangan kecil di bawah (mis. batas maks file SFX) */
  note?: string | null;
  /** atribut data-mix (untuk uji) */
  testId?: string;
}) {
  const listId = useId();
  const [draft, setDraft] = useState<number | null>(null);
  /**
   * `out` = nilai terakhir yang dikirim ke induk (bisa belum sampai di `value`);
   * `tap` / `tapX` = kapan & di mana ketukan (sentuh tanpa geser) terakhir selesai; `downX` = titik sentuh sekarang;
   * `block` = sentuhan kedua (ketuk 2x) sudah mengembalikan ke 0 → geseran sentuhan itu diabaikan sampai jari diangkat;
   * `hold` = sampai kapan perubahan dari ketukan itu tetap diabaikan (browser HP bisa mengirim nilai ketukan sesudah jari diangkat)
   */
  const live = useRef<{
    last: number;
    sent: number | null;
    out: number | null;
    want: number | null;
    timer: ReturnType<typeof setTimeout> | null;
    tap: number;
    tapX: number;
    downX: number;
    block: boolean;
    hold: number;
  }>({ last: 0, sent: null, out: null, want: null, timer: null, tap: 0, tapX: 0, downX: 0, block: false, hold: 0 });
  const cb = useRef(onChange);
  cb.current = onChange;
  const clampV = (v: number) => Math.min(max, Math.max(min, v));
  const shown = clampV(draft ?? value);

  const send = (v: number) => {
    const L = live.current;
    if (L.timer) clearTimeout(L.timer);
    L.timer = null;
    L.want = null;
    L.last = Date.now();
    // sama dengan yang terakhir dikirim (atau, di awal geseran, dengan nilai sekarang) → tidak dikirim lagi
    if (v === (L.sent ?? value)) return;
    L.sent = v;
    L.out = v;
    cb.current(v);
  };
  /** digeser: kirim paling cepat tiap SEND_MS, nilai terakhir selalu ikut terkirim */
  const move = (v: number) => {
    const L = live.current;
    if (L.block || Date.now() < L.hold) return;
    setDraft(v);
    const wait = SEND_MS - (Date.now() - L.last);
    if (wait <= 0) return send(v);
    L.want = v;
    L.timer ??= setTimeout(() => {
      L.timer = null;
      if (L.want !== null) send(L.want);
    }, wait);
  };
  /** dilepas / keluar: sisa nilai dikirim, tampilan kembali ikut `value` */
  const done = () => {
    const L = live.current;
    L.block = false;
    if (L.want !== null) send(L.want);
    L.sent = null;
    setDraft(null);
  };
  const reset = () => {
    const L = live.current;
    if (L.timer) clearTimeout(L.timer);
    L.timer = null;
    L.want = null;
    L.sent = null;
    setDraft(null);
    // nilai yang baru dikirim (mis. ketukan pertama) bisa belum sampai di `value` → tetap kirim 0
    if (value !== 0 || (L.out !== null && L.out !== 0)) {
      L.out = 0;
      cb.current(0);
    }
  };
  useEffect(() => () => {
    if (live.current.timer) clearTimeout(live.current.timer);
  }, []);

  /**
   * ketuk 2x (sentuh): sentuhan baru dimulai < DOUBLE_TAP_MS sesudah ketukan sebelumnya SELESAI, di dekat titik yang sama.
   * Diukur dari jari diangkat (bukan dari sentuhan pertama) supaya tetap terbaca walau HP lambat memproses ketukan pertama.
   */
  const onDown = (e: PointerEvent<HTMLInputElement>) => {
    if (e.pointerType !== "touch") return;
    const L = live.current;
    const now = Date.now();
    L.downX = e.clientX;
    if (now - L.tap < DOUBLE_TAP_MS && Math.abs(e.clientX - L.tapX) < TAP_NEAR_PX) {
      L.tap = 0;
      e.preventDefault();
      reset();
      // sentuhan ini juga menggeser jempol slider ke titik ketukan → diabaikan sampai jari diangkat (+ sebentar sesudahnya)
      L.block = true;
      L.hold = now + HOLD_MS;
      return;
    }
    L.tap = 0;
  };
  const onUp = (e: PointerEvent<HTMLInputElement>) => {
    const L = live.current;
    if (e.pointerType === "touch") {
      // ketukan = jari diangkat tanpa digeser (bukan ketukan kedua yang baru saja mengembalikan ke 0)
      const tapped = !L.block && Math.abs(e.clientX - L.downX) < TAP_MOVE_PX;
      L.tap = tapped ? Date.now() : 0;
      L.tapX = e.clientX;
    }
    done();
  };

  const name = `Volume ${label}`;
  return (
    <div className="min-w-0" data-mix={testId}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 sm:flex-nowrap">
        <span className="order-1 min-w-0 flex-none truncate text-[11.5px] font-semibold text-zinc-300 sm:w-[68px]" title={label}>
          {icon ? `${icon} ` : ""}
          {label}
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          list={min < 0 && max > 0 ? listId : undefined}
          disabled={disabled}
          aria-label={name}
          aria-valuetext={`${fmtDb(shown)}, ${dbWord(shown).toLowerCase()}`}
          title="Geser untuk atur volume · ketuk / klik 2x = kembali 0 dB"
          className="order-3 h-8 w-full min-w-0 basis-full cursor-pointer accent-orange-500 disabled:cursor-not-allowed disabled:opacity-40 sm:order-2 sm:w-auto sm:flex-1 sm:basis-auto"
          style={{ touchAction: "pan-y" }}
          onChange={(e) => move(clampV(Number(e.target.value)))}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerCancel={done}
          onKeyUp={done}
          onBlur={done}
          onDoubleClick={reset}
        />
        {min < 0 && max > 0 && (
          <datalist id={listId}>
            <option value={0} />
          </datalist>
        )}
        <span className="order-2 ml-auto flex-none text-right text-[11px] leading-tight tabular-nums sm:order-3 sm:ml-0 sm:w-[86px]" data-mix-db>
          <b className={`text-[12px] sm:block ${shown === 0 ? "text-zinc-300" : "text-orange-400"}`}>{fmtDb(shown)}</b>
          <span className="text-zinc-500">
            <span className="sm:hidden"> · </span>
            {dbWord(shown)}
          </span>
        </span>
        <button
          type="button"
          className={`order-2 h-7 w-7 flex-none rounded-lg text-[13px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 sm:order-4 ${shown === 0 ? "invisible" : ""}`}
          aria-label={`Kembalikan ${name.toLowerCase()} ke 0 dB`}
          title="Kembali ke 0 dB"
          disabled={disabled || shown === 0}
          onClick={reset}
        >
          ↺
        </button>
      </div>
      {note && <p className="mt-0.5 text-[10.5px] text-zinc-500 sm:pl-[76px]">{note}</p>}
    </div>
  );
}
