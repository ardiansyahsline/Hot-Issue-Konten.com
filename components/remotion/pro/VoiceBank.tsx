"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  createVoiceJob,
  fileExt,
  friendlyStudioError,
  studioDb,
  studioUid,
  uploadStudioFile,
  useStudioStatus,
  useVoices,
  type StudioVoice,
} from "@/lib/studio/client";
import { STUDIO_BUCKET, storageSrc } from "@/lib/studio/urls";
import { ModelsHint, WarmBadge, warmOf } from "./JobEta";

const MAX_MB = 50;
const AUDIO_EXT = new Set(["wav", "mp3", "m4a"]);
const ACCEPT = ".wav,.mp3,.m4a,audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a";

const STATUS: Record<StudioVoice["status"], { label: string; cls: string }> = {
  baru: { label: "Menunggu laptop", cls: "bg-zinc-500/10 text-zinc-400 ring-zinc-500/30" },
  diproses: { label: "Lagi dibersihkan", cls: "bg-amber-500/10 text-amber-400 ring-amber-500/30" },
  siap: { label: "Siap dipakai", cls: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30" },
  gagal: { label: "Gagal", cls: "bg-red-500/10 text-red-400 ring-red-500/30" },
};
const NOISE: Record<string, { label: string; cls: string; tip?: string }> = {
  rendah: { label: "Bising rendah", cls: "text-emerald-400" },
  sedang: { label: "Bising sedang", cls: "text-amber-400", tip: "Masih bisa dipakai. Hasil lebih bagus kalau rekam ulang di ruangan lebih sepi." },
  tinggi: { label: "Bising tinggi", cls: "text-red-400", tip: "Sebaiknya rekam ulang di ruangan sepi (tanpa kipas / AC / jalan raya)." },
};

/** durasi rekaman (detik) dari metadata audio; null kalau browser tidak bisa membaca */
function audioDur(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    a.src = url;
  });
}

/**
 * Tab "Bank suara": daftar suara (status, skor kualitas, putar asli/bersih) + form tambah rekaman
 * (wajib centang izin pemilik suara). Simpan = upload voices/<uuid>/raw.<ext> → baris studio_voices → job 'clean' untuk laptop.
 */
export default function VoiceBank({ active = true }: { active?: boolean }) {
  const uid = useId();
  const status = useStudioStatus();
  const { voices, reload, loaded, error } = useVoices();
  const [me, setMe] = useState<{ id: string | null; admin: boolean }>({ id: null, admin: false });
  const [playing, setPlaying] = useState<{ id: string; kind: "raw" | "clean" } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // form
  const [name, setName] = useState("");
  const [style, setStyle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dur, setDur] = useState<number | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const online = !!status?.worker.online;

  // pindah tab -> rekaman yang sedang diputar berhenti (tab tetap terpasang, cuma disembunyikan)
  useEffect(() => {
    if (!active) setPlaying(null);
  }, [active]);

  // siapa saya (untuk tombol hapus: pemilik / admin)
  useEffect(() => {
    let alive = true;
    void (async () => {
      const id = await studioUid().catch(() => null);
      let admin = false;
      if (id) {
        const { data } = await studioDb().from("profiles").select("role").eq("id", id).maybeSingle();
        admin = (data as { role?: string } | null)?.role === "admin";
      }
      if (alive) setMe({ id, admin });
    })();
    return () => {
      alive = false;
    };
  }, []);

  const pickFile = async (f: File | null) => {
    setFileErr(null);
    setDur(null);
    setFile(null);
    if (!f) return;
    if (!AUDIO_EXT.has(fileExt(f.name))) return setFileErr("Pakai file WAV, MP3, atau M4A.");
    if (f.size > MAX_MB * 1024 * 1024) return setFileErr(`File maksimal ${MAX_MB} MB.`);
    setFile(f);
    if (!name.trim()) setName(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60));
    setDur(await audioDur(f));
  };

  const resetForm = () => {
    setName("");
    setStyle("");
    setTranscript("");
    setFile(null);
    setDur(null);
    setConsent(false);
    setFileErr(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const save = async () => {
    if (!file || !consent || !name.trim() || saving) return;
    setSaving(true);
    setMsg(null);
    let path: string | null = null;
    try {
      const owner = await studioUid();
      if (!owner) throw new Error("Sesi login habis. Muat ulang halaman lalu coba lagi.");
      const up = await uploadStudioFile(file, "voices");
      path = up.path;
      const id = up.path.split("/")[1];
      const { error: insErr } = await studioDb()
        .from("studio_voices")
        .insert({ id, name: name.trim().slice(0, 60), style: style.trim().slice(0, 80) || null, transcript: transcript.trim().slice(0, 2000) || null, consent: true, raw_path: up.path, owner });
      if (insErr) throw insErr;
      path = null; // sudah tercatat, jangan dihapus
      try {
        await createVoiceJob({ kind: "clean", voice_id: id });
        setMsg({ ok: true, text: online ? "Rekaman tersimpan. Laptop sedang membersihkan suaranya…" : "Rekaman tersimpan. Akan dibersihkan otomatis saat mesin suara laptop nyala." });
      } catch {
        setMsg({ ok: true, text: "Rekaman tersimpan, tapi antrian pembersih gagal dibuat. Klik “Proses ulang” nanti." });
      }
      resetForm();
      reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error && !("code" in e) ? e.message : friendlyStudioError(e) });
      // file sudah terupload tapi baris gagal dibuat -> coba bersihkan (admin saja yang diizinkan hapus di folder voices)
      if (path) void studioDb().storage.from(STUDIO_BUCKET).remove([path]).catch(() => {});
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v: StudioVoice) => {
    if (!window.confirm(`Hapus suara "${v.name}" dari bank?`)) return;
    setBusyId(v.id);
    setMsg(null);
    try {
      const { error: delErr } = await studioDb().from("studio_voices").delete().eq("id", v.id);
      if (delErr) throw delErr;
      const files = [v.raw_path, v.clean_path].filter((x): x is string => !!x && x.startsWith("voices/"));
      if (files.length) void studioDb().storage.from(STUDIO_BUCKET).remove(files).catch(() => {});
      if (playing?.id === v.id) setPlaying(null);
      setMsg({ ok: true, text: `Suara "${v.name}" dihapus.` });
      reload();
    } catch (e) {
      setMsg({ ok: false, text: friendlyStudioError(e) });
    } finally {
      setBusyId(null);
    }
  };

  const reprocess = async (v: StudioVoice) => {
    setBusyId(v.id);
    setMsg(null);
    try {
      await createVoiceJob({ kind: "clean", voice_id: v.id });
      setMsg({ ok: true, text: online ? `"${v.name}" masuk antrian pembersih.` : `"${v.name}" masuk antrian — diproses saat laptop nyala.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : friendlyStudioError(e) });
    } finally {
      setBusyId(null);
    }
  };

  const canSave = !!file && consent && !!name.trim() && !saving;

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      {/* daftar suara */}
      <div className="min-w-0 space-y-3">
        <div className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite" data-bank-laptop>
            <span className={`h-2.5 w-2.5 flex-none rounded-full ${online ? "bg-emerald-400" : "bg-zinc-500"}`} />
            <span className="font-semibold">
              {status === null
                ? "Cek mesin suara laptop…"
                : online
                  ? `Mesin suara laptop${warmOf(status) === undefined ? ": nyala" : ""}${status.worker.gpu ? ` (GPU ${status.worker.gpu})` : ""}`
                  : "Mesin suara laptop: mati"}
            </span>
            <WarmBadge warm={warmOf(status)} />
          </div>
          <ModelsHint status={status} className="text-xs" />
          <p className="text-xs text-zinc-500">
            {online ? "Rekaman baru langsung dibersihkan otomatis." : "Rekaman tetap bisa disimpan — dibersihkan otomatis saat laptop nyala. Selama mati, VO pakai suara cadangan."}
          </p>
          <p className="text-xs text-zinc-500">Saat mesin suara laptop pertama kali jalan, bank ini otomatis diisi “Alif - Energik” &amp; “Alif - Tenang”.</p>
        </div>

        {msg && <div className={`rounded-xl px-3 py-2 text-xs ${msg.ok ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>{msg.text}</div>}

        {!loaded ? (
          <div className="card h-28 animate-pulse" />
        ) : error ? (
          <div className="card p-4 text-sm text-amber-400">{error}</div>
        ) : !voices.length ? (
          <div className="card p-6 text-center text-sm text-zinc-500">Bank suara masih kosong. Tambah rekaman lewat form “Tambah suara”, atau nyalakan mesin suara laptop.</div>
        ) : (
          voices.map((v) => {
            const st = STATUS[v.status] ?? STATUS.baru;
            const q = v.quality;
            const noise = q?.noise ? NOISE[q.noise] : undefined;
            const canDel = me.admin || (!!me.id && v.owner === me.id);
            const tip = q?.saran || noise?.tip;
            return (
              <div key={v.id} className="card card-flat space-y-2 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold">{v.name}</span>
                      {v.seed_key && <span className="badge bg-orange-500/10 text-orange-400 ring-orange-500/30">Bawaan</span>}
                    </div>
                    {v.style && <div className="text-xs text-zinc-500">{v.style}</div>}
                  </div>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </div>

                {q && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                    {noise && <span className={`font-semibold ${noise.cls}`}>{noise.label}</span>}
                    {typeof q.snr_db === "number" && <span>Jernih {Math.round(q.snr_db)} dB</span>}
                    {typeof q.dur === "number" && <span>{q.dur.toFixed(1).replace(".", ",")} dtk</span>}
                  </div>
                )}
                {tip && <p className={`text-[11px] ${q?.noise === "tinggi" ? "text-red-300" : "text-zinc-400"}`}>💡 {tip}</p>}
                {v.status === "gagal" && !tip && <p className="text-[11px] text-red-300">Rekaman tidak bisa diproses. Coba proses ulang atau rekam ulang.</p>}

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setPlaying(playing?.id === v.id && playing.kind === "raw" ? null : { id: v.id, kind: "raw" })}>
                    {playing?.id === v.id && playing.kind === "raw" ? "■ Stop" : "▶ Asli"}
                  </button>
                  {v.clean_path && (
                    <button type="button" className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setPlaying(playing?.id === v.id && playing.kind === "clean" ? null : { id: v.id, kind: "clean" })}>
                      {playing?.id === v.id && playing.kind === "clean" ? "■ Stop" : "▶ Bersih"}
                    </button>
                  )}
                  {(v.status === "gagal" || v.status === "baru") && canDel && (
                    <button type="button" className="text-xs font-semibold text-zinc-400 hover:text-zinc-200" disabled={busyId === v.id} onClick={() => reprocess(v)}>
                      ↻ Proses ulang
                    </button>
                  )}
                  {canDel && (
                    <button type="button" className="ml-auto text-xs font-semibold text-zinc-500 hover:text-red-400" disabled={busyId === v.id} onClick={() => remove(v)}>
                      {busyId === v.id ? "…" : "Hapus"}
                    </button>
                  )}
                </div>
                {playing?.id === v.id && (
                  <audio
                    key={`${v.id}-${playing.kind}`}
                    className="h-9 w-full"
                    src={storageSrc(playing.kind === "clean" && v.clean_path ? v.clean_path : v.raw_path)}
                    controls
                    autoPlay
                    preload="none"
                    onEnded={() => setPlaying(null)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* form tambah */}
      <div className="card h-fit min-w-0 space-y-3 p-4">
        <div className="label mb-0">Tambah suara</div>
        <div>
          <label htmlFor={`${uid}-name`} className="mb-1 block text-xs font-semibold text-zinc-400">
            Nama
          </label>
          <input id={`${uid}-name`} className="input py-2 text-[13px]" value={name} maxLength={60} placeholder="mis. Rina - Ceria" disabled={saving} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-style`} className="mb-1 block text-xs font-semibold text-zinc-400">
            Gaya
          </label>
          <input id={`${uid}-style`} className="input py-2 text-[13px]" value={style} maxLength={80} placeholder="mis. energik, semangat" disabled={saving} onChange={(e) => setStyle(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-tr`} className="mb-1 block text-xs font-semibold text-zinc-400">
            Isi ucapan di rekaman <span className="font-normal text-zinc-500">(opsional)</span>
          </label>
          <textarea id={`${uid}-tr`} className="input min-h-[72px] py-2 text-[13px]" value={transcript} maxLength={2000} placeholder="Tulis kalimat yang diucapkan di rekaman" disabled={saving} onChange={(e) => setTranscript(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${uid}-file`} className="mb-1 block text-xs font-semibold text-zinc-400">
            File rekaman (WAV / MP3 / M4A, maks {MAX_MB} MB)
          </label>
          <input
            id={`${uid}-file`}
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            disabled={saving}
            className="block w-full text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-zinc-200 hover:file:bg-zinc-700"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
          {fileErr && <p className="mt-1 text-[11px] text-red-400">{fileErr}</p>}
          {file && (
            <p className="mt-1 text-[11px] text-zinc-500">
              {(file.size / 1e6).toFixed(1).replace(".", ",")} MB{dur !== null ? ` · ${dur.toFixed(1).replace(".", ",")} dtk` : ""}
              {dur !== null && dur < 5 && <span className="text-amber-400"> — terlalu pendek, idealnya 10–20 detik</span>}
              {dur !== null && dur > 300 && <span className="text-amber-400"> — panjang sekali, cukup 10–20 detik</span>}
            </p>
          )}
          <div className="mt-1.5 rounded-lg bg-zinc-950/50 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400" data-ref-tips>
            <p className="font-semibold text-zinc-300">💡 Biar hasilnya natural (nggak kedengeran AI):</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>Rekam 10–20 detik, satu orang, ruangan sepi (tanpa kipas / AC), HP ±20 cm dari mulut.</li>
              <li>Gaya bicaranya sama dengan videonya — promo: semangat; penjelasan: tenang. Mesin suara meniru nada rekaman ini.</li>
              <li>Ngomong kayak ngobrol: intonasi naik-turun, ada jeda napas wajar. Jangan datar seperti membaca.</li>
            </ul>
          </div>
        </div>

        <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${consent ? "border-orange-500/60 bg-orange-500/10" : "border-zinc-700"}`}>
          <input type="checkbox" className="mt-0.5 h-4 w-4 flex-none accent-orange-500" checked={consent} disabled={saving} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            Saya pemilik suara ini / sudah dapat izin pemiliknya <span className="text-red-400">*</span>
          </span>
        </label>
        <p className="text-[11px] text-red-300/80">Dilarang meniru suara orang lain tanpa izin.</p>

        <button type="button" className="btn-primary w-full" disabled={!canSave} onClick={save}>
          {saving ? "Menyimpan…" : "💾 Simpan ke bank suara"}
        </button>
      </div>
    </div>
  );
}
