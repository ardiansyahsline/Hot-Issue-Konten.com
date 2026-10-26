import { NextResponse, type NextRequest } from "next/server";
import { studioGuard } from "@/lib/studio/access.server";
import { normSkill, skillSections, SKILL_MAX_BYTES, type SkillLibraryRow } from "@/lib/studio/skill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Library tim Skill Studio (tabel studio_skills, migration-21).
 * GET  -> daftar skill (terbaru dulu). Tabel belum ada -> { skills: [], needsMigration: true } (unduh / impor file tetap jalan).
 * POST -> simpan skill baru atas nama sendiri. Isi divalidasi ulang dengan normSkill (JSON dari browser tidak dipercaya).
 * Wajib login + akses Studio (studioGuard); RLS menjaga lapis kedua.
 */

const LIMIT = 100;
const NO_STORE = { "Cache-Control": "no-store" };
const MIGRATE = "Library tim belum aktif — jalankan migration-21.";

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42P01" || e.code === "PGRST205" || e.code === "PGRST204" || /schema cache|does not exist|could not find the table/i.test(e.message ?? ""));
const denied = (e: { code?: string; message?: string } | null | undefined) => !!e && (e.code === "42501" || /row-level security|permission denied/i.test(e.message ?? ""));

export async function GET() {
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const { supabase, user, profile } = g;
  const admin = profile?.role === "admin";
  try {
    const { data, error } = await supabase.from("studio_skills").select("id, owner, name, description, data, created_at").order("created_at", { ascending: false }).limit(LIMIT);
    if (error) {
      if (missingTable(error)) return NextResponse.json({ skills: [], needsMigration: true, message: MIGRATE }, { headers: NO_STORE });
      console.log("[studio] gagal baca library skill:", error.message);
      return NextResponse.json({ skills: [], error: "Gagal memuat Library tim. Coba lagi sebentar." }, { status: 500, headers: NO_STORE });
    }
    const rows = (data ?? []) as { id: string; owner: string; name: string; description: string | null; data: unknown; created_at: string }[];
    // nama pembuat (gagal dibaca -> kosong, daftar tetap tampil)
    const owners = [...new Set(rows.map((r) => r.owner).filter(Boolean))];
    const names = new Map<string, string>();
    if (owners.length) {
      try {
        const { data: ps } = await supabase.from("profiles").select("id, full_name, email").in("id", owners);
        for (const p of (ps ?? []) as { id: string; full_name: string | null; email: string | null }[]) names.set(p.id, p.full_name || p.email?.split("@")[0] || "");
      } catch {}
    }
    const skills: SkillLibraryRow[] = [];
    for (const r of rows) {
      // isi dari database juga divalidasi ulang (baris rusak dilewati)
      const n = normSkill(r.data);
      if (!n.ok) continue;
      skills.push({
        id: r.id,
        name: n.skill.name,
        desc: n.skill.desc ?? null,
        owner: r.owner,
        ownerName: names.get(r.owner) || (r.owner === user.id ? "Kamu" : "Anggota tim"),
        mine: r.owner === user.id,
        canDelete: r.owner === user.id || admin,
        created_at: r.created_at,
        sections: skillSections(n.skill),
        skill: n.skill,
      });
    }
    return NextResponse.json({ skills }, { headers: NO_STORE });
  } catch (e) {
    console.log("[studio] library skill error:", e);
    return NextResponse.json({ skills: [], error: "Gagal memuat Library tim. Coba lagi sebentar." }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(req: NextRequest) {
  const g = await studioGuard();
  if (!g.ok) return g.res;
  const { supabase, user } = g;
  let text = "";
  try {
    text = await req.text();
  } catch {
    return fail(400, "Permintaan tidak valid");
  }
  // body = skill JSON (sedikit lebih longgar dari batas skill untuk spasi/format), lalu normSkill memeriksa 64 KB-nya
  if (text.length > SKILL_MAX_BYTES * 2) return fail(413, "Skill terlalu besar (maks 64 KB).");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail(400, "Permintaan tidak valid");
  }
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const n = normSkill(body.skill ?? raw);
  if (!n.ok) return fail(400, n.error);
  const skill = n.skill;
  try {
    const { data, error } = await supabase
      .from("studio_skills")
      .insert({ owner: user.id, name: skill.name, description: skill.desc ?? null, data: skill })
      .select("id, created_at")
      .single();
    if (error || !data) {
      if (missingTable(error)) return fail(503, MIGRATE, { needsMigration: true });
      if (denied(error)) return fail(403, "Kamu belum punya akses Studio untuk menyimpan ke Library tim.");
      console.log("[studio] gagal simpan skill:", error?.message);
      return fail(500, "Gagal menyimpan ke Library tim. Coba lagi sebentar.");
    }
    const row = data as { id: string; created_at: string };
    return NextResponse.json({ ok: true, id: row.id, created_at: row.created_at, skill }, { headers: NO_STORE });
  } catch (e) {
    console.log("[studio] simpan skill error:", e);
    return fail(500, "Gagal menyimpan ke Library tim. Coba lagi sebentar.");
  }
}
