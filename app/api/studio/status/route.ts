import { NextResponse } from "next/server";
import { studioGuard } from "@/lib/studio/access.server";
import { elevenEnabled } from "@/lib/studio/elevenlabs.server";
import { studioAdmin } from "@/lib/studio/storage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Status mesin suara: worker laptop dianggap online kalau detak terakhirnya < 60 dtk.
 * Semua error (tabel belum ada, Supabase lambat) -> nilai aman: offline, antrian 0.
 */

const ONLINE_MS = 60_000;
type Info = { gpu?: unknown; engine?: unknown; render?: unknown };
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);

export async function GET() {
  const g = await studioGuard();
  if (!g.ok) return g.res;

  const sb = studioAdmin() ?? g.supabase; // service role -> antrian semua user; tanpa itu yang terlihat lewat RLS
  let lastSeen: string | null = null;
  let info: Info = {};
  let queue = 0;

  const [w, q] = await Promise.allSettled([
    sb.from("studio_workers").select("last_seen, info").order("last_seen", { ascending: false }).limit(1).maybeSingle(),
    sb.from("studio_voice_jobs").select("id", { count: "exact", head: true }).eq("status", "antri"),
  ]);
  if (w.status === "fulfilled" && !w.value.error && w.value.data) {
    const d = w.value.data as { last_seen?: string | null; info?: Info | null };
    lastSeen = typeof d.last_seen === "string" ? d.last_seen : null;
    info = d.info && typeof d.info === "object" ? d.info : {};
  }
  if (q.status === "fulfilled" && !q.value.error) queue = q.value.count ?? 0;

  const t = lastSeen ? Date.parse(lastSeen) : NaN;
  // detak dari "masa depan" (jam tidak sinkron) dianggap mati, supaya job tidak menumpuk di antrian laptop yang sudah mati
  const online = Number.isFinite(t) && Date.now() - t < ONLINE_MS && t < Date.now() + 30_000;

  return NextResponse.json(
    {
      worker: { online, lastSeen, gpu: str(info.gpu), engine: str(info.engine), queue },
      // bank suara hanya kalau worker melaporkan mesin yang siap (engine kosong = chatterbox & pocket sama-sama mati)
      engines: { bank: online && !!str(info.engine), edge: true, elevenlabs: elevenEnabled() },
      freesound: !!process.env.FREESOUND_API_KEY?.trim(),
      renderWorker: online && info.render === true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
