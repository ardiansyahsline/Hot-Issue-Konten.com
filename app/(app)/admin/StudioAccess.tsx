"use client";

import { useState, useTransition } from "react";
import { grantStudioAccess, revokeStudioAccess, type StudioState } from "./studioActions";

export type StudioMember = { id: string; name: string; email: string | null; since: string; by: string; admin: boolean };
export type StudioCandidate = { id: string; name: string; email: string | null };
export type StudioLogItem = { id: number; action: "grant" | "revoke"; user: string; by: string; at: string };

/** Bagian "Akses Studio" di halaman Admin. Tanggal sudah diformat di server (hindari beda format server/HP). */
export default function StudioAccess({
  members,
  candidates,
  log,
  max,
  setup,
}: {
  members: StudioMember[];
  candidates: StudioCandidate[];
  log: StudioLogItem[];
  max: number;
  /** pesan kalau tabel Studio belum siap (migration belum dijalankan) */
  setup: string | null;
}) {
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState<StudioState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const used = members.length;
  const full = used >= max;
  const picked = candidates.some((c) => c.id === pick) ? pick : "";

  const run = (key: string, fn: () => Promise<StudioState>, after?: () => void) => {
    setBusy(key);
    setMsg(null);
    start(async () => {
      try {
        const res = await fn();
        setMsg(res);
        if (res.ok) after?.();
      } catch {
        setMsg({ error: "Gagal terhubung. Coba lagi." });
      } finally {
        setBusy(null);
      }
    });
  };

  const grant = () => picked && run("grant", () => grantStudioAccess(picked), () => setPick(""));
  const revoke = (m: StudioMember) => {
    if (!confirm(`Cabut akses Studio untuk ${m.name}?`)) return;
    run(m.id, () => revokeStudioAccess(m.id));
  };

  return (
    <section className="card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">🎬 Akses Studio</h2>
          <p className="mt-0.5 text-xs text-zinc-400">Admin selalu punya akses dan tidak dihitung.</p>
        </div>
        {!setup && (
          <span
            className={`badge ${full ? "bg-amber-500/10 text-amber-300 ring-amber-500/30" : "bg-zinc-800 text-zinc-300 ring-zinc-700"}`}
          >
            {used}/{max} terpakai
          </span>
        )}
      </div>

      {setup ? (
        <div className="rounded-xl border border-amber-800 bg-amber-500/10 p-3 text-sm text-amber-300">{setup}</div>
      ) : (
        <>
          {members.length ? (
            <ul className="divide-y divide-zinc-800 rounded-xl border border-zinc-800">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                      <span className="min-w-0 break-words">{m.name}</span>
                      {m.admin && <span className="badge bg-orange-500/10 text-orange-400 ring-orange-500/30">sudah admin</span>}
                    </div>
                    {m.email && m.email !== m.name && <div className="break-all text-xs text-zinc-400">{m.email}</div>}
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      Sejak {m.since} · oleh {m.by}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(m)}
                    disabled={pending}
                    className="btn-danger shrink-0 px-3 py-1.5 text-xs"
                  >
                    {pending && busy === m.id ? "Mencabut…" : "Cabut"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 p-3 text-center text-xs text-zinc-500">
              Belum ada user yang diberi akses.
            </p>
          )}

          <div className="space-y-2">
            <label className="label" htmlFor="studio-pick">Beri akses ke</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                id="studio-pick"
                value={picked}
                onChange={(e) => setPick(e.target.value)}
                disabled={full || pending || !candidates.length}
                className="input min-w-0 sm:flex-1"
              >
                <option value="">{candidates.length ? "Pilih user…" : "Tidak ada user lain"}</option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email && c.email !== c.name ? ` — ${c.email}` : ""}
                  </option>
                ))}
              </select>
              <button type="button" onClick={grant} disabled={full || !picked || pending} className="btn-primary shrink-0">
                {pending && busy === "grant" ? "Memberi…" : "Beri akses"}
              </button>
            </div>
            {full && <p className="text-xs text-amber-400">Sudah {max} orang. Cabut salah satu dulu kalau mau menambah.</p>}
            {msg && (msg.error || msg.ok) && (
              <p role="status" className={`text-xs ${msg.error ? "text-red-400" : "text-emerald-400"}`}>
                {msg.error ?? msg.ok}
              </p>
            )}
          </div>

          <div>
            <div className="label">Riwayat (20 terakhir)</div>
            {log.length ? (
              <ul className="space-y-2 text-xs">
                {log.map((l) => (
                  <li key={l.id} className="flex gap-2">
                    <span aria-hidden>{l.action === "grant" ? "✅" : "⛔"}</span>
                    <span className="min-w-0 flex-1 break-words text-zinc-300">
                      <b className="font-semibold">{l.user}</b> {l.action === "grant" ? "diberi akses" : "dicabut aksesnya"}
                      <span className="text-zinc-500"> · oleh {l.by}</span>
                      <span className="block text-zinc-500 sm:ml-2 sm:inline">{l.at}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-500">Belum ada riwayat.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
