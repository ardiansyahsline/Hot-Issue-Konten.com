"use client";

import { useMemo, useState } from "react";
import { applyActions, ensureWrite, expandPlan, undoActions, type Done, type FilePlan, type Scan } from "@/lib/localFolder";

const LIMIT = 120;

/** Kartu rencana rapikan file: tinjau → jalankan (di browser) → bisa dibatalkan */
export default function FilePlanCard({ plan, scan, onConnect, onChanged }: { plan: FilePlan; scan: Scan | null; onConnect: () => void; onChanged: () => void }) {
  const live = useMemo(() => (scan ? expandPlan(plan, scan) : null), [plan, scan]);
  // setelah dijalankan, daftar dibekukan (folder sudah berubah)
  const [snap, setSnap] = useState<typeof live>(null);
  const exp = snap ?? live;
  const [off, setOff] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [state, setState] = useState<"idle" | "run" | "done" | "undo" | "undone">("idle");
  const [prog, setProg] = useState({ i: 0, n: 0 });
  const [done, setDone] = useState<Done[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  if (!scan || !exp)
    return (
      <div className="ai-card mt-3">
        <div className="ai-body text-[13px]">
          <b>📁 Rencana rapikan file</b>
          {plan.summary && <p className="mt-1 text-zinc-400">{plan.summary}</p>}
          <p className="mt-2 text-zinc-500">Hubungkan lagi folder yang sama untuk meninjau & menjalankan rencana ini.</p>
          <button type="button" onClick={onConnect} className="mt-2 rounded-lg bg-orange-500 px-3 py-1.5 text-[12.5px] font-bold text-white">
            📁 Hubungkan folder
          </button>
        </div>
      </div>
    );

  if (scan.root.readonly)
    return (
      <div className="ai-card mt-3">
        <div className="ai-body text-[13px]">
          <b>📁 Rencana rapikan file</b>
          {plan.summary && <p className="mt-1 text-zinc-400">{plan.summary}</p>}
          <p className="mt-2 text-zinc-500">Di perangkat ini file cuma bisa dibaca. Untuk memindah / ganti nama / hapus file, buka 💼 Cowork pakai Chrome atau Edge di laptop.</p>
        </div>
      </div>
    );
  const acts = exp.actions;
  const chosen = acts.filter((_, i) => !off.has(i));
  const dir = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const nMove = chosen.filter((a) => a.kind === "move" && dir(a.from) !== dir(a.to!)).length;
  const nRename = chosen.filter((a) => a.kind === "move" && dir(a.from) === dir(a.to!)).length;
  const nDel = chosen.filter((a) => a.kind === "delete").length;

  const run = async () => {
    if (nDel && !confirmDel) return setConfirmDel(true);
    if (!(await ensureWrite(scan.root))) return setErrors(["Izin edit folder ditolak browser. Hubungkan folder lagi lalu pilih 'Izinkan edit'."]);
    setConfirmDel(false);
    setSnap(exp);
    setState("run");
    setProg({ i: 0, n: chosen.length });
    const r = await applyActions(scan.root, chosen, (i) => setProg({ i, n: chosen.length }));
    setDone(r.done);
    setErrors(r.errors);
    setState("done");
    onChanged();
  };
  const undo = async () => {
    const moves = done.filter((d) => d.kind === "move");
    setState("undo");
    setProg({ i: 0, n: moves.length });
    const e = await undoActions(scan.root, done, (i) => setProg({ i, n: moves.length }));
    setErrors(e);
    setState("undone");
    onChanged();
  };
  const csv = () => {
    const rows = [["aksi", "dari", "ke"], ...done.map((d) => [d.kind === "delete" ? "hapus" : "pindah", d.from, d.to ?? ""])];
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `catatan-perubahan-${scan.root.name}.csv`;
    a.click();
  };

  return (
    <div className="ai-card mt-3">
      <div className="ai-body text-[13px]">
        <div className="flex flex-wrap items-center gap-2">
          <b>📁 Rencana untuk folder “{scan.root.name}”</b>
          <span className="text-[11.5px] text-zinc-500">belum ada yang berubah sebelum kamu klik Jalankan</span>
        </div>
        {plan.summary && <p className="mt-1 text-zinc-400">{plan.summary}</p>}
        <div className="ai-tiles mt-2">
          <div className="ai-tile neutral">
            <span className="ai-k">Dipindah</span>
            <b className="ai-v">{nMove}</b>
          </div>
          <div className="ai-tile neutral">
            <span className="ai-k">Ganti nama</span>
            <b className="ai-v">{nRename}</b>
          </div>
          <div className={`ai-tile ${nDel ? "down" : "neutral"}`}>
            <span className="ai-k">Dihapus</span>
            <b className="ai-v">{nDel}</b>
            {nDel > 0 && <span className="ai-n">permanen</span>}
          </div>
          {exp.skipped.length > 0 && (
            <div className="ai-tile neutral" title={exp.skipped.join("\n")}>
              <span className="ai-k">Tidak ketemu</span>
              <b className="ai-v">{exp.skipped.length}</b>
              <span className="ai-n">dilewati</span>
            </div>
          )}
        </div>

        {acts.length === 0 ? (
          <p className="mt-3 text-zinc-500">Tidak ada file yang cocok dengan rencana ini (mungkin sudah rapi / sudah dipindah).</p>
        ) : (
          <div className="ai-table mt-3 max-h-[340px] overflow-y-auto">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>
                    <input
                      type="checkbox"
                      checked={off.size === 0}
                      disabled={state !== "idle"}
                      onChange={(e) => setOff(e.target.checked ? new Set() : new Set(acts.map((_, i) => i)))}
                      aria-label="Pilih semua"
                    />
                  </th>
                  <th>File</th>
                  <th>→ Jadi</th>
                </tr>
              </thead>
              <tbody>
                {(all ? acts : acts.slice(0, LIMIT)).map((a, i) => (
                  <tr key={a.from + i} className={off.has(i) ? "opacity-40" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!off.has(i)}
                        disabled={state !== "idle"}
                        onChange={() =>
                          setOff((s) => {
                            const n = new Set(s);
                            if (n.has(i)) n.delete(i);
                            else n.add(i);
                            return n;
                          })
                        }
                        aria-label={`Pilih ${a.from}`}
                      />
                    </td>
                    <td className="break-all" style={{ fontWeight: 500 }}>
                      {a.from}
                    </td>
                    <td className="break-all">{a.kind === "delete" ? <span className="text-red-400">🗑 hapus permanen</span> : <span className="text-emerald-400">{a.to}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!all && acts.length > LIMIT && (
          <button type="button" onClick={() => setAll(true)} className="mt-1 text-[12px] font-semibold text-orange-400 hover:underline">
            Tampilkan semua {acts.length} baris
          </button>
        )}

        {(state === "run" || state === "undo") && (
          <div className="mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${prog.n ? (prog.i / prog.n) * 100 : 0}%` }} />
            </div>
            <p className="mt-1 text-[12px] text-zinc-500">
              {state === "run" ? "Mengerjakan" : "Mengembalikan"} {prog.i} / {prog.n}… jangan tutup tab ini
            </p>
          </div>
        )}
        {state === "done" && (
          <p className="mt-3 font-semibold text-emerald-400">
            ✅ Selesai — {done.length} perubahan{errors.length ? `, ${errors.length} gagal` : ""}.
          </p>
        )}
        {state === "undone" && <p className="mt-3 font-semibold text-zinc-300">↶ Sudah dikembalikan ke posisi semula{done.some((d) => d.kind === "delete") ? " (file yang dihapus tidak bisa kembali)" : ""}.</p>}
        {errors.length > 0 && (
          <details className="mt-1 text-[12px] text-red-400">
            <summary>{errors.length} masalah</summary>
            <ul className="mt-1 list-disc pl-5">
              {errors.slice(0, 30).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </details>
        )}

        {confirmDel && state === "idle" && (
          <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-[12.5px] text-red-300">
            ⚠️ {nDel} file akan <b>dihapus permanen</b> dari laptop (tidak masuk Recycle Bin & tidak bisa dibatalkan). Yakin?
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={run} className="rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white">
                Ya, hapus & jalankan
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className="rounded-lg border border-zinc-700 px-3 py-1.5 font-bold text-zinc-300">
                Batal
              </button>
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {state === "idle" && !confirmDel && (
            <button type="button" onClick={run} disabled={!chosen.length} className="rounded-lg bg-orange-500 px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50">
              ✓ Jalankan {chosen.length} perubahan
            </button>
          )}
          {state === "done" && done.some((d) => d.kind === "move") && (
            <button type="button" onClick={undo} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-500">
              ↶ Batalkan semua
            </button>
          )}
          {(state === "done" || state === "undone") && done.length > 0 && (
            <button type="button" onClick={csv} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-500">
              ⬇ Catatan perubahan (.csv)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
