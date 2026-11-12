"use client";

import { useEffect, useRef, useState } from "react";
import { ROLES, isRole } from "@/lib/roles";
import { OPT_IN_TABS, TABS, effectiveClosed, firstOpenHome, type TabId } from "@/lib/tabs";
import { saveTabBlocks } from "./tabActions";

/** blocked = tab biasa yang DITUTUP, granted = tab khusus (optIn) yang DIBUKA */
export type TabUser = { id: string; name: string; email: string | null; role: string; admin: boolean; self: boolean; blocked: TabId[]; granted: TabId[] };
type Acc = { blocked: TabId[]; granted: TabId[] };

type Status = { kind: "saving" } | { kind: "ok" } | { kind: "error"; text: string };

/** salinan tanpa kunci `id` */
const without = <T,>(r: Record<string, T>, id: string) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== id));

/**
 * Bagian "Akses tab per user" di halaman Admin: tiap user = satu kartu berisi chip per tab.
 * Chip menyala = tab boleh dibuka. Klik = langsung tersimpan (tanpa tombol Simpan).
 * Tab khusus (optIn, mis. 🤖 Asisten Review (Uji)) bawaannya mati — chipnya menyimpan ke `granted`, bukan `blocked`.
 */
export default function TabAccess({
  users,
  setup,
  optInSetup = null,
}: {
  users: TabUser[];
  /** pesan kalau tabel belum siap (migration-22 belum dijalankan) */
  setup: string | null;
  /** pesan kalau kolom tab khusus belum ada (migration-23 belum dijalankan) -> chip tab khusus dikunci */
  optInSetup?: string | null;
}) {
  // daftar tab yang DITUTUP per user (tampilan) + yang terakhir pasti tersimpan di server (untuk dikembalikan kalau gagal)
  const initOf = (u: TabUser): Acc => ({ blocked: u.blocked, granted: u.granted ?? [] });
  const [rows, setRows] = useState<Record<string, Acc>>(() => Object.fromEntries(users.map((u) => [u.id, initOf(u)])));
  const [status, setStatus] = useState<Record<string, Status>>({});
  const saved = useRef<Record<string, Acc>>(Object.fromEntries(users.map((u) => [u.id, initOf(u)])));
  const seq = useRef<Record<string, number>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const t = timers.current;
    return () => Object.values(t).forEach(clearTimeout);
  }, []);

  const accOf = (u: TabUser) => rows[u.id] ?? initOf(u);
  const setRow = (id: string, v: Acc) => setRows((r) => ({ ...r, [id]: v }));
  const setSt = (id: string, v: Status) => setStatus((s) => ({ ...s, [id]: v }));

  const save = async (u: TabUser, next: Acc) => {
    const n = (seq.current[u.id] = (seq.current[u.id] ?? 0) + 1);
    clearTimeout(timers.current[u.id]);
    setRow(u.id, next);
    setSt(u.id, { kind: "saving" });
    let res: Awaited<ReturnType<typeof saveTabBlocks>>;
    try {
      res = await saveTabBlocks(u.id, next.blocked, next.granted);
    } catch {
      res = { error: "Gagal terhubung. Coba lagi." };
    }
    if (res.ok) saved.current[u.id] = { blocked: res.blocked ?? next.blocked, granted: res.granted ?? next.granted };
    // sudah ada klik yang lebih baru untuk user ini -> hasil lama tidak ditampilkan
    if (seq.current[u.id] !== n) return;
    if (res.ok) {
      setRow(u.id, saved.current[u.id]);
      setSt(u.id, { kind: "ok" });
      // "Tersimpan" cukup sebentar, lalu kembali ke ringkasan
      timers.current[u.id] = setTimeout(() => setStatus((s) => (s[u.id]?.kind === "ok" ? without(s, u.id) : s)), 2500);
    } else {
      setRow(u.id, saved.current[u.id] ?? initOf(u));
      setSt(u.id, { kind: "error", text: res.error ?? "Gagal menyimpan. Coba lagi." });
    }
  };

  /** chip: tab biasa -> ubah daftar tutup; tab khusus -> ubah daftar buka */
  const toggle = (u: TabUser, id: TabId) => {
    const cur = accOf(u);
    const flip = (list: TabId[]) => (list.includes(id) ? list.filter((x) => x !== id) : TABS.map((t) => t.id).filter((t) => t === id || list.includes(t)));
    save(u, OPT_IN_TABS.includes(id) ? { ...cur, granted: flip(cur.granted) } : { ...cur, blocked: flip(cur.blocked) });
  };

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="min-w-0">
        <h2 className="font-semibold">🔐 Akses tab per user</h2>
        <p className="mt-0.5 text-xs text-zinc-400">
          Chip menyala = tab boleh dibuka. Klik untuk membuka / menutup — langsung tersimpan. Admin selalu bisa membuka semua tab.
          Izin tulis tetap ikut role (mis. + Issue Baru butuh tab Dashboard <i>dan</i> role CS / Video Review / Discord Moderator).
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          🤖 <b className="font-semibold text-zinc-400">Asisten Review (Uji)</b> = tab khusus: bawaannya tertutup untuk semua user, buka hanya untuk orang
          yang ikut menguji. &quot;Buka semua&quot; tidak ikut membukanya.
        </p>
        {optInSetup && <p className="mt-1 text-xs text-amber-400">{optInSetup}</p>}
        <p className="mt-1 text-xs text-zinc-500">🎬 Studio tidak diatur di sini — pakai bagian <b className="font-semibold text-zinc-400">Akses Studio</b> di bawah (maks 3 orang).</p>
      </div>

      {setup ? (
        <div className="rounded-xl border border-amber-800 bg-amber-500/10 p-3 text-sm text-amber-300">{setup}</div>
      ) : (
        <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
          {users.map((u) => {
            const acc = accOf(u);
            const blocked = acc.blocked;
            // tutup efektif = blocked + tab khusus yang belum dibuka (sama dengan perhitungan server)
            const closed = effectiveClosed(acc.blocked, acc.granted);
            const st = status[u.id];
            const role = isRole(u.role) ? ROLES[u.role] : null;
            // semua tab ditutup, atau semua HALAMAN ditutup tapi tombol 🎵 Musik masih boleh
            const allClosed = closed.length === TABS.length;
            const pagesClosed = !allClosed && blocked.length > 0 && !firstOpenHome(closed);
            // "Buka semua" = semua tab BIASA dibuka (tab khusus tetap seperti semula, dibuka satu per satu dengan sadar).
            // Tidak memakai `disabled` (fokus keyboard tidak hilang ke <body> sesudah diklik)
            const openAllOff = !blocked.length || st?.kind === "saving";
            const nGranted = acc.granted.length;
            return (
              // HP: nama -> chip -> ringkasan + "Buka semua"; layar lebar: nama + ringkasan sebaris, chip di bawahnya
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                <div className="min-w-0 basis-full sm:flex-1 sm:basis-auto">
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold">
                    <span className="min-w-0 break-words">{u.name}</span>
                    {u.self && <span className="text-xs font-normal text-zinc-500">(kamu)</span>}
                    {role && <span className={`text-[11px] font-semibold ${role.cls}`}>{role.label}</span>}
                  </div>
                  {u.email && u.email !== u.name && <div className="break-all text-xs text-zinc-400">{u.email}</div>}
                </div>
                {u.admin ? (
                  <span className="badge bg-orange-500/10 text-orange-400 ring-orange-500/30">Semua tab (admin)</span>
                ) : (
                  <>
                    <div className="order-3 flex basis-full items-center justify-between gap-2 sm:order-none sm:basis-auto sm:justify-end">
                      <span
                        role="status"
                        aria-live="polite"
                        className={`text-[11px] font-medium ${st?.kind === "error" ? "text-red-400" : st?.kind === "ok" ? "text-emerald-400" : "text-zinc-500"}`}
                      >
                        {st?.kind === "saving"
                          ? "Menyimpan…"
                          : st?.kind === "ok"
                            ? "✓ Tersimpan"
                            : `${blocked.length ? `${blocked.length} tab ditutup` : `Semua tab biasa terbuka`}${nGranted ? ` · ${nGranted} tab khusus dibuka` : ""}`}
                      </span>
                      <button
                        type="button"
                        onClick={() => !openAllOff && save(u, { ...acc, blocked: [] })}
                        aria-disabled={openAllOff}
                        className={`btn-ghost px-2.5 py-1 text-xs ${openAllOff ? "cursor-not-allowed opacity-50" : ""}`}
                      >
                        Buka semua
                      </button>
                    </div>
                    <div role="group" aria-label={`Tab yang boleh dibuka ${u.name}`} className="order-2 flex basis-full flex-wrap gap-1.5 sm:order-none">
                      {TABS.map((t) => {
                        const open = !closed.includes(t.id);
                        // tab khusus: bawaan mati (bukan "dicoret"), dikunci kalau migration-23 belum dijalankan
                        const special = !!t.optIn;
                        const locked = special && !!optInSetup;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            aria-pressed={open}
                            aria-disabled={locked || undefined}
                            onClick={() => !locked && toggle(u, t.id)}
                            title={locked ? optInSetup! : `${t.hint} — klik untuk ${open ? "menutup" : "membuka"}`}
                            className={`inline-flex min-w-0 items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-medium leading-none transition active:scale-[0.97] ${
                              open
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                                : special
                                  ? "border-dashed border-violet-500/40 bg-zinc-950 text-zinc-400 hover:border-violet-500/60 hover:text-zinc-200"
                                  : "border-zinc-700 bg-zinc-950 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                            } ${locked ? "cursor-not-allowed opacity-50" : ""}`}
                          >
                            <span aria-hidden>{open ? "✓" : special ? "＋" : "✕"}</span>
                            <span aria-hidden>{t.icon}</span>
                            <span className={open || special ? "" : "line-through decoration-zinc-600"}>{t.label}</span>
                            {special && !open && <span className="text-[10px] font-semibold text-violet-400">khusus</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
                {st?.kind === "error" && <p role="alert" className="order-4 basis-full text-xs text-red-400">{st.text}</p>}
                {(allClosed || pagesClosed) && (
                  <p className="order-4 basis-full text-xs text-amber-400">
                    {allClosed ? "Semua tab ditutup" : "Semua halaman ditutup (tombol 🎵 Musik masih boleh)"} — user ini hanya bisa membuka halaman
                    Akun (dan Studio kalau diberi akses).
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
