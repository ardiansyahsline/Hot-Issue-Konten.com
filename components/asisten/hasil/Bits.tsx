/**
 * Potongan tampilan hasil Asisten Review (tanpa hook → bisa dipakai server component & client component).
 * Data di sini tidak pernah memuat nama / username / link clipper (lihat lib/asistenReview.ts).
 */
import {
  HASIL_POIN_LABEL,
  SARAN_LABEL,
  SERAH_LABEL,
  type CekPoin,
  type HasilMusik,
  type HasilPoin,
  type HasilVisual,
  type KodeSerah,
  type Keputusan,
  type Saran,
} from "@/lib/asistenReview";

const SARAN_CLS: Record<Saran, string> = {
  approve: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  reject: "bg-red-500/10 text-red-300 ring-red-500/30",
  cek_manusia: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
};
const SARAN_ICON: Record<Saran, string> = { approve: "✓", reject: "✕", cek_manusia: "👀" };

/** saran AI + keyakinan */
export function SaranBadge({ saran, yakin }: { saran: Saran | null; yakin?: number | null }) {
  if (!saran) return <span className="badge bg-zinc-800 text-zinc-400 ring-zinc-700">Belum dinilai</span>;
  return (
    <span className={`badge ${SARAN_CLS[saran]}`}>
      <span aria-hidden>{SARAN_ICON[saran]}</span>
      {SARAN_LABEL[saran]}
      {typeof yakin === "number" && <span className="font-medium opacity-80">· {yakin}%</span>}
    </span>
  );
}

/** keputusan manusia (approve / reject) */
export function KeputusanBadge({ v, kosong = "Belum ada" }: { v: Keputusan | null; kosong?: string }) {
  if (!v) return <span className="text-xs text-zinc-500">{kosong}</span>;
  return <span className={`badge ${SARAN_CLS[v]}`}>{v === "approve" ? "Approve" : "Reject"}</span>;
}

/** cocok / tidak dengan kebenaran akhir (null = AI menyerahkan ke manusia / belum ada keputusan) */
export function CocokBadge({ match, saran }: { match: boolean | null; saran: Saran | null }) {
  if (match === true) return <span className="badge bg-emerald-500/10 text-emerald-300 ring-emerald-500/30">✓ Cocok</span>;
  if (match === false) return <span className="badge bg-red-500/10 text-red-300 ring-red-500/30">✕ Tidak cocok</span>;
  return (
    <span className="badge bg-zinc-800 text-zinc-400 ring-zinc-700" title={saran === "cek_manusia" ? "AI menyerahkan ke manusia — tidak dihitung" : "Belum ada keputusan manusia"}>
      – {saran === "cek_manusia" ? "Diserahkan" : "Belum bisa dibanding"}
    </span>
  );
}

const POIN_CLS: Record<HasilPoin, string> = {
  lolos: "text-emerald-300 bg-emerald-500/10 ring-emerald-500/30",
  tidak: "text-red-300 bg-red-500/10 ring-red-500/30",
  tidak_bisa_dinilai: "text-amber-300 bg-amber-500/10 ring-amber-500/30",
};
const POIN_ICON: Record<HasilPoin, string> = { lolos: "✓", tidak: "✕", tidak_bisa_dinilai: "?" };

export function PoinBadge({ hasil }: { hasil: HasilPoin }) {
  return (
    <span className={`badge ${POIN_CLS[hasil] ?? POIN_CLS.tidak_bisa_dinilai}`}>
      <span aria-hidden>{POIN_ICON[hasil] ?? "?"}</span>
      {HASIL_POIN_LABEL[hasil] ?? hasil}
    </span>
  );
}

/** daftar checklist apa adanya dari database (tahan banting: field hilang / tipe beda) */
export function cekList(v: unknown): CekPoin[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
    .map((x, i) => ({
      poin_id: typeof x.poin_id === "string" ? x.poin_id : `p${i + 1}`,
      kategori: typeof x.kategori === "string" ? x.kategori : "",
      teks: typeof x.teks === "string" ? x.teks : "",
      wajib: x.wajib !== false,
      hasil: (["lolos", "tidak", "tidak_bisa_dinilai"].includes(x.hasil as string) ? x.hasil : "tidak_bisa_dinilai") as HasilPoin,
      bukti: typeof x.bukti === "string" ? x.bukti : "",
      bukti_frame: Array.isArray(x.bukti_frame) ? x.bukti_frame.filter((n): n is number => typeof n === "number") : [],
      bukti_detik: Array.isArray(x.bukti_detik) ? x.bukti_detik.filter((n): n is number => typeof n === "number") : [],
      oleh: (["ai", "kode", "manusia"].includes(x.oleh as string) ? x.oleh : "ai") as CekPoin["oleh"],
    }));
}

/** jumlah lolos / tidak / tidak bisa dinilai */
export function hitungCek(list: CekPoin[]) {
  const n = { lolos: 0, tidak: 0, tidak_bisa_dinilai: 0 };
  for (const c of list) n[c.hasil] += 1;
  return n;
}

export function RingkasCek({ list }: { list: CekPoin[] }) {
  if (!list.length) return <span className="text-xs text-zinc-500">Tanpa checklist</span>;
  const n = hitungCek(list);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="font-semibold text-emerald-400">{n.lolos} lolos</span>
      <span className="font-semibold text-red-400">{n.tidak} tidak</span>
      <span className="font-semibold text-amber-400">{n.tidak_bisa_dinilai} tak bisa dinilai</span>
    </span>
  );
}

const OLEH: Record<CekPoin["oleh"], string> = { ai: "AI", kode: "Cek otomatis", manusia: "Butuh manusia" };

/** angka detik → "0:12" */
export const detik = (s: number | null | undefined) => {
  if (typeof s !== "number" || !Number.isFinite(s) || s < 0) return "-";
  const m = Math.floor(s / 60);
  const d = Math.floor(s % 60);
  return `${m}:${String(d).padStart(2, "0")}`;
};

/** checklist per poin brief + bukti (frame / detik / kutipan) */
export function ChecklistView({ list, ringkas = false }: { list: CekPoin[]; ringkas?: boolean }) {
  if (!list.length) return <p className="text-sm text-zinc-500">Tidak ada poin brief yang dinilai.</p>;
  return (
    <ol className="space-y-2">
      {list.map((c) => (
        <li key={c.poin_id} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5 sm:p-3">
          <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
            <PoinBadge hasil={c.hasil} />
            {!c.wajib && <span className="badge bg-zinc-800 text-zinc-400 ring-zinc-700">opsional</span>}
            <span className="min-w-0 flex-1 basis-48 break-words text-sm">{c.teks || <i className="text-zinc-500">(poin tanpa teks)</i>}</span>
          </div>
          {(c.bukti || !ringkas) && (
            <p className="mt-1.5 break-words text-xs text-zinc-400">
              <span className="font-semibold text-zinc-500">Bukti: </span>
              {c.bukti || <i>tidak ada</i>}
            </p>
          )}
          {!ringkas && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500">
              <span>Dinilai: {OLEH[c.oleh]}</span>
              {c.kategori && <span>Jenis: {c.kategori.replace(/_/g, " ")}</span>}
              {!!c.bukti_frame?.length && <span>Frame {c.bukti_frame.join(", ")}</span>}
              {!!c.bukti_detik?.length && <span>Detik {c.bukti_detik.map(detik).join(", ")}</span>}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

const MUSIK_LABEL: Record<NonNullable<HasilMusik["status"]>, string> = {
  cocok: "Musik campaign ketemu",
  tidak_cocok: "Musik campaign tidak ketemu",
  tidak_ada_referensi: "Lagu referensi belum ada",
  gagal: "Cek musik gagal",
  nonaktif: "Cek musik dimatikan",
};

/** ringkasan hasil cocok musik (satu baris) */
export function MusikRingkas({ m }: { m: HasilMusik | null | undefined }) {
  const st = m?.status;
  if (!st) return <span className="text-xs text-zinc-500">🎵 Belum dicek</span>;
  const t = m?.terbaik;
  const cls = st === "cocok" ? "text-emerald-400" : st === "tidak_cocok" ? "text-red-400" : "text-amber-400";
  return (
    <span className={`text-xs ${cls}`}>
      🎵 {MUSIK_LABEL[st] ?? st}
      {st === "cocok" && t && (
        <span className="text-zinc-400">
          {" "}
          · detik {detik(t.mulai)}–{detik(t.selesai)} · skor {Math.round((t.yakin ?? 0) * 100)}%
        </span>
      )}
    </span>
  );
}

/** detail hasil musik (halaman detail) */
export function MusikView({ m }: { m: HasilMusik | null | undefined }) {
  const all = (m?.semua?.length ? m.semua : m?.terbaik ? [m.terbaik] : []).slice(0, 5);
  return (
    <div className="space-y-2 text-sm">
      <MusikRingkas m={m} />
      {all.length > 0 && (
        <ul className="space-y-1.5">
          {all.map((t, i) => (
            <li key={`${t.material_id}-${i}`} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-2.5 text-xs">
              <div className="break-all font-semibold">{t.nama || "Lagu referensi"}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-zinc-400">
                <span>
                  Di video: {detik(t.mulai)}–{detik(t.selesai)}
                </span>
                <span>
                  Di lagu: {detik(t.ref_mulai)}–{detik(t.ref_selesai)}
                </span>
                <span>Yakin {Math.round((t.yakin ?? 0) * 100)}%</span>
                {typeof t.faktor_tempo === "number" && Math.abs(t.faktor_tempo - 1) > 0.005 && <span>Tempo ×{t.faktor_tempo.toFixed(2)}</span>}
                {typeof t.faktor_nada === "number" && Math.abs(t.faktor_nada - 1) > 0.005 && <span>Nada ×{t.faktor_nada.toFixed(2)}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-zinc-500">
        Mesin: {m?.mesin ?? "-"}
        {m?.demucs ? " · vokal dipisah (Demucs)" : ""}
        {m?.catatan ? ` · ${m.catatan}` : ""}
      </p>
    </div>
  );
}

const VISUAL_LABEL: Record<NonNullable<HasilVisual["status"]>, string> = {
  ada: "Poster / trailer campaign terlihat",
  tidak_ada: "Poster / trailer tidak terlihat",
  tidak_ada_referensi: "Poster / trailer referensi belum ada",
  gagal: "Cek visual gagal",
  nonaktif: "Cek visual dimatikan",
};

export function VisualView({ v }: { v: HasilVisual | null | undefined }) {
  const st = v?.status;
  if (!st) return <p className="text-xs text-zinc-500">🖼️ Belum dicek</p>;
  const cls = st === "ada" ? "text-emerald-400" : st === "tidak_ada" ? "text-red-400" : "text-amber-400";
  return (
    <div className="space-y-1.5 text-xs">
      <p className={cls}>🖼️ {VISUAL_LABEL[st] ?? st}</p>
      {!!v?.cocok?.length && (
        <ul className="flex flex-wrap gap-1.5">
          {v.cocok.slice(0, 8).map((c, i) => (
            <li key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2 py-1 text-zinc-400">
              {c.jenis} · frame {c.frame_idx} ({detik(c.detik)}) · mirip {Math.round((c.skor ?? 0) * 100)}%
            </li>
          ))}
        </ul>
      )}
      {v?.catatan && <p className="text-zinc-500">{v.catatan}</p>}
    </div>
  );
}

/** alasan diserahkan ke manusia */
export function SerahList({ list }: { list: KodeSerah[] | null | undefined }) {
  const xs = (list ?? []).filter(Boolean);
  if (!xs.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {xs.map((k) => (
        <li key={k} className="badge bg-amber-500/10 text-amber-300 ring-amber-500/30">
          {SERAH_LABEL[k] ?? k.replace(/_/g, " ")}
        </li>
      ))}
    </ul>
  );
}

const PIPE_LABEL: Record<string, string> = {
  tidak_bisa_diakses: "Video tidak bisa diakses",
  gagal: "Proses gagal",
  dilewati_biaya: "Dilewati: batas biaya harian",
};

/** status pipeline bukan "ok" → pita peringatan */
export function PipelineNote({ status, error }: { status: string; error: string | null }) {
  if (status === "ok") return null;
  return (
    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">
      ⚠️ {PIPE_LABEL[status] ?? status}
      {error ? ` — ${error}` : ""}
    </p>
  );
}
