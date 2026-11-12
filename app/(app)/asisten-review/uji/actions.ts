"use server";

import { revalidatePath } from "next/cache";
import { arErrorText, parseVideoRef, type VideoRef } from "@/lib/asistenReview";
import { asistenGuard, type ArCtx } from "@/lib/asistenReview.server";

/**
 * Antrikan pekerjaan untuk laptop (review_jobs, RLS migration-23: hanya admin / user yang dibuka, milik sendiri, status antri).
 * Link mentah TIDAK pernah disimpan: "tempel ID / link" diubah dulu ke id Konten.com / id platform (parseVideoRef, tanpa username).
 */

export type AksiState = { ok?: true; error?: string };
export type VideoState = { ok?: true; error?: string; jumlah?: number; ditolak?: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAKS_BARIS = 20;
const SIAP = "Jalankan supabase/migration-23-asisten-review.sql dulu di Supabase (SQL Editor), lalu muat ulang halaman.";

async function guard() {
  const g = await asistenGuard();
  if (!g.ok) return { error: g.error } as const;
  if (!g.ctx.ready) return { error: SIAP } as const;
  return { ctx: g.ctx } as const;
}

const selesai = () => {
  revalidatePath("/asisten-review/uji");
};

/** sudah ada uji yang menunggu / berjalan? → pesan awam (unik di database juga menjaga "menunggu") */
async function ujiAktif(ctx: ArCtx) {
  const { data } = await ctx.supabase.from("review_jobs").select("id, status").eq("kind", "uji").in("status", ["antri", "proses"]).limit(1);
  const row = (data ?? [])[0] as { status: string } | undefined;
  if (!row) return null;
  return row.status === "antri"
    ? "Sudah ada uji yang menunggu laptop. Tunggu selesai atau batalkan dulu."
    : "Uji lain sedang berjalan. Tunggu selesai atau batalkan dulu.";
}

/** tombol "Jalankan uji 50 video" / "Jalankan uji 500 video" */
export async function antrikanUji(jumlah: 50 | 500): Promise<AksiState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  if (jumlah !== 50 && jumlah !== 500) return { error: "Jumlah uji hanya 50 atau 500 video." };
  const sibuk = await ujiAktif(g.ctx);
  if (sibuk) return { error: sibuk };
  const { error } = await g.ctx.supabase.from("review_jobs").insert({ kind: "uji", params: { jumlah }, created_by: g.ctx.user.id });
  if (error) return { error: arErrorText(error, "Gagal mengantrikan uji. Coba lagi sebentar.") };
  selesai();
  return { ok: true };
}

/** run yang terhenti (batas biaya / gagal / dibatalkan) dilanjutkan dari video berikutnya */
export async function lanjutkanRun(runId: string): Promise<AksiState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  if (typeof runId !== "string" || !UUID.test(runId)) return { error: "Run tidak valid. Muat ulang halaman." };
  const { data: run, error: rErr } = await g.ctx.supabase.from("review_runs").select("id, status").eq("id", runId).maybeSingle();
  if (rErr) return { error: arErrorText(rErr) };
  if (!run) return { error: "Run tidak ditemukan. Muat ulang halaman." };
  if (!["berhenti_biaya", "gagal", "batal"].includes(run.status as string)) return { error: "Run ini tidak sedang terhenti." };
  const sibuk = await ujiAktif(g.ctx);
  if (sibuk) return { error: sibuk };
  const { error } = await g.ctx.supabase.from("review_jobs").insert({ kind: "uji", params: { lanjut_run: runId.toLowerCase() }, created_by: g.ctx.user.id });
  if (error) return { error: arErrorText(error, "Gagal mengantrikan. Coba lagi sebentar.") };
  selesai();
  return { ok: true };
}

/** ulangi SAMPEL video yang sama dengan rubrik terbaru (hasil per versi rubrik bisa dibandingkan di Ringkasan) */
export async function ulangRun(runId: string): Promise<AksiState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  if (typeof runId !== "string" || !UUID.test(runId)) return { error: "Run tidak valid. Muat ulang halaman." };
  const { data: run, error: rErr } = await g.ctx.supabase.from("review_runs").select("id, status, sample_size").eq("id", runId).maybeSingle();
  if (rErr) return { error: arErrorText(rErr) };
  if (!run) return { error: "Run tidak ditemukan. Muat ulang halaman." };
  if (run.status === "proses") return { error: "Run ini masih berjalan. Tunggu selesai dulu." };
  const sibuk = await ujiAktif(g.ctx);
  if (sibuk) return { error: sibuk };
  const { error } = await g.ctx.supabase.from("review_jobs").insert({ kind: "uji", params: { ulang_run: runId.toLowerCase() }, created_by: g.ctx.user.id });
  if (error) return { error: arErrorText(error, "Gagal mengantrikan. Coba lagi sebentar.") };
  selesai();
  return { ok: true };
}

/** potong baris yang ditolak supaya pesan tidak kepanjangan (hanya dikembalikan ke browser pengirim, tidak disimpan) */
const potong = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
const kunciRef = (r: VideoRef) => (r.jenis === "id" ? `id:${r.nilai}` : `${r.platform}:${r.nilai}`);

/** kotak "Tempel ID / link video": 1 baris = 1 video (maks 20) → 1 job per video */
export async function antrikanVideo(teks: string): Promise<VideoState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  const baris = (typeof teks === "string" ? teks : "")
    .slice(0, 20_000)
    .split(/[\r\n]+/)
    .flatMap((l) => l.split(/[\s,;]+/))
    .map((l) => l.trim())
    .filter(Boolean);
  if (!baris.length) return { error: "Tempel minimal satu ID atau link video." };
  if (baris.length > MAKS_BARIS) return { error: `Maksimal ${MAKS_BARIS} video sekali kirim (ada ${baris.length}).` };

  const ditolak: string[] = [];
  const refs = new Map<string, VideoRef>();
  for (const b of baris) {
    const r = parseVideoRef(b);
    if (r) refs.set(kunciRef(r), r);
    else ditolak.push(potong(b));
  }
  if (!refs.size) return { error: "Tidak ada ID / link yang dikenali. Pakai ID video Konten.com atau link TikTok / Instagram / YouTube.", ditolak };

  const uid = g.ctx.user.id;
  const rows = [...refs.values()].map((ref) => ({ kind: "video", params: { ref }, created_by: uid }));
  const { error } = await g.ctx.supabase.from("review_jobs").insert(rows);
  if (error) return { error: arErrorText(error, "Gagal mengantrikan. Coba lagi sebentar."), ditolak };
  selesai();
  return { ok: true, jumlah: rows.length, ditolak };
}

/** batalkan pekerjaan yang menunggu / sedang diproses (milik sendiri; admin semua). Laptop berhenti sesudah video yang sedang jalan. */
export async function batalkanJob(id: string): Promise<AksiState> {
  const g = await guard();
  if ("error" in g) return { error: g.error };
  if (typeof id !== "string" || !UUID.test(id)) return { error: "Pekerjaan tidak valid. Muat ulang halaman." };
  const { data, error } = await g.ctx.supabase
    .from("review_jobs")
    .update({ status: "batal", message: "Dibatalkan dari website", finished_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["antri", "proses"])
    .select("id");
  if (error) return { error: arErrorText(error, "Gagal membatalkan. Coba lagi sebentar.") };
  if (!data?.length) return { error: "Pekerjaan ini sudah selesai atau bukan milikmu." };
  selesai();
  return { ok: true };
}
