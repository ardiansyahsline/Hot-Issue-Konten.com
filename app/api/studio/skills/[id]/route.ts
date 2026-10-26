import { NextResponse } from "next/server";
import { studioGuard } from "@/lib/studio/access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hapus satu skill dari Library tim. Hanya milik sendiri atau admin — RLS (policy studio_skills_delete) yang menentukan;
 * baris yang tidak boleh dihapus tidak ikut terhapus (0 baris) → 404.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { "Cache-Control": "no-store" };
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const { id } = await params;
  if (!UUID.test(id ?? "")) return fail(404, "Skill tidak ditemukan.");
  try {
    const { data, error } = await g.supabase.from("studio_skills").delete().eq("id", id).select("id");
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205" || /schema cache|does not exist|could not find the table/i.test(error.message ?? ""))
        return fail(503, "Library tim belum aktif — jalankan migration-21.", { needsMigration: true });
      if (error.code === "42501" || /row-level security|permission denied/i.test(error.message ?? "")) return fail(403, "Hanya pembuat skill atau admin yang boleh menghapus.");
      console.log("[studio] gagal hapus skill:", error.message);
      return fail(500, "Gagal menghapus skill. Coba lagi sebentar.");
    }
    if (!Array.isArray(data) || !data.length) return fail(404, "Skill tidak ditemukan atau bukan milikmu.");
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (e) {
    console.log("[studio] hapus skill error:", e);
    return fail(500, "Gagal menghapus skill. Coba lagi sebentar.");
  }
}
