import Link from "next/link";
import type { CampaignMateriStatus } from "@/lib/asistenReview";
import { Kosong } from "./BelumSiap";
import MateriPanel, { type MateriItem } from "./MateriPanel";
import { STATUS_CAMPAIGN } from "./materiAturan";

/**
 * Tampilan halaman Materi referensi (server-safe, data dari props) — dipakai materi/page.tsx dan harness uji UI.
 * Cari + saring status lewat alamat (?q=&status=&hal=), ?c=<id> = satu campaign (boleh yang belum pernah dicek laptop).
 */

const BASE = "/asisten-review/materi";
const CAMPAIGN_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const FILTER_MATERI: { id: "" | CampaignMateriStatus; label: string }[] = [
  { id: "", label: "Semua" },
  { id: "belum_ada", label: "Materi belum ada" },
  { id: "sebagian", label: "Sebagian" },
  { id: "ada", label: "Lengkap" },
  { id: "belum_dicek", label: "Belum dicek" },
  { id: "gagal", label: "Gagal" },
];

type Props = {
  items: MateriItem[];
  q: string;
  status: "" | CampaignMateriStatus;
  c: string;
  hal: number;
  total: number;
  perHal: number;
  /** jumlah campaign per materi_status (untuk angka di chip saring) */
  hitung: Record<string, number>;
  peringatan: string | null;
};

export default function MateriView({ items, q, status, c, hal, total, perHal, hitung, peringatan }: Props) {
  const FILTER = FILTER_MATERI;
  const halMaks = Math.max(1, Math.ceil(total / perHal));
  const link = (o: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ q, status, ...o })) if (v !== undefined && v !== "" && !(k === "hal" && Number(v) === 1)) u.set(k, String(v));
    return u.size ? `${BASE}?${u}` : BASE;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="section-title">Materi referensi</h2>
        <p className="page-sub">
          Lagu, poster, dan potongan trailer per campaign untuk mencocokkan video. Laptop mencoba mengunduh otomatis dari link Google Drive di brief; kalau
          gagal atau private, upload manual di sini.
        </p>
      </div>

      <form action={BASE} className="flex flex-wrap gap-2" role="search">
        <input
          name="q"
          defaultValue={c || q}
          placeholder="Cari judul / brand / ID campaign"
          className="input min-w-0 flex-1 basis-56 py-2"
          aria-label="Cari campaign"
        />
        {status && <input type="hidden" name="status" value={status} />}
        <button className="btn-ghost px-4 py-2">Cari</button>
      </form>

      <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Saring status materi">
        {FILTER.map((f) => {
          const on = !c && f.id === status;
          const n = f.id ? hitung[f.id] ?? 0 : Object.values(hitung).reduce((a, b) => a + b, 0);
          return (
            <Link
              key={f.id || "semua"}
              href={link({ status: f.id, hal: undefined, q: q || undefined })}
              className={`badge shrink-0 py-1 ${on ? "bg-orange-500/15 text-orange-300 ring-orange-500/40" : "bg-zinc-900 text-zinc-400 ring-zinc-700 hover:text-zinc-200"}`}
              aria-current={on ? "true" : undefined}
            >
              {f.label}
              <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>

      {peringatan && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-300">{peringatan}</p>}

      {items.length ? (
        <MateriPanel items={items} />
      ) : !peringatan ? (
        <Kosong ikon="🎵" judul={q || status ? "Tidak ada campaign yang cocok" : "Belum ada campaign"}>
          {q || status ? (
            <>
              Coba kata lain, atau{" "}
              <Link className="font-semibold text-orange-400 hover:underline" href={BASE}>
                lihat semua
              </Link>
              .
              {CAMPAIGN_RE.test(q) && (
                <>
                  {" "}
                  Campaign belum pernah dicek laptop?{" "}
                  <Link className="font-semibold text-orange-400 hover:underline" href={`${BASE}?c=${encodeURIComponent(q)}`}>
                    Upload materi untuk ID {q}
                  </Link>
                </>
              )}
            </>
          ) : (
            "Daftar ini diisi laptop saat pertama kali mengecek video dari sebuah campaign (uji 50 video atau cek video tertentu)."
          )}
        </Kosong>
      ) : null}

      {!c && halMaks > 1 && (
        <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Halaman">
          {hal > 1 ? (
            <Link className="btn-ghost px-3 py-2" href={link({ hal: hal - 1 })}>
              ← Sebelumnya
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">
            Hal {hal} / {halMaks} · {total} campaign
          </span>
          {hal < halMaks ? (
            <Link className="btn-ghost px-3 py-2" href={link({ hal: hal + 1 })}>
              Berikutnya →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <p className="text-xs text-zinc-500">
        Status: {Object.values(STATUS_CAMPAIGN).map((s) => s.label).join(" · ")}. Tanpa materi, poin brief “wajib pakai materi” dinilai{" "}
        <b>butuh cek manusia</b>.
      </p>
    </div>
  );
}
