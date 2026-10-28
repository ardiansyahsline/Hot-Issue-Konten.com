/**
 * Contoh rencana bawaan (defaultTimeline: "Masih kerja manual?" → CS Tracker) yang belum diubah user. Proyek "mulai dari contoh"
 * dan timeline kosong yang dinormalisasi berisi contoh ini — sutradara diberi tahu bahwa isinya CONTOH, bukan subjek user,
 * supaya brief baru (mis. promo Konten.com) dibuat dari nol, bukan merevisi contoh CS Tracker. Aman di server & browser.
 */
import { defaultTimeline, normalizeTimeline, type Timeline } from "./timeline";

/** judul proyek contoh di Studio Pro (StudioPro.tsx → "atau mulai dari contoh rencana") */
export const EXAMPLE_PROJECT_TITLE = "Contoh video";

type Sig = { name: string; text: string; kind: string; title: string };
let starter: Sig[] | null = null;
const sigOf = (tl: Pick<Timeline, "scenes">): Sig[] =>
  tl.scenes.map((s) => ({ name: s.name, text: s.text.join(" | "), kind: s.layout.kind, title: String(s.layout.title ?? "") }));

/** true kalau timeline ini masih persis contoh bawaan (judul, nama & teks adegan, jenis tampilan; belum ada VO) */
export function isStarterTimeline(tl: Pick<Timeline, "title" | "scenes" | "vo"> | null | undefined): boolean {
  if (!tl || !Array.isArray(tl.scenes) || tl.vo?.lines?.length) return false;
  starter ??= sigOf(normalizeTimeline(defaultTimeline()));
  if (tl.title !== "Video baru" || tl.scenes.length !== starter.length) return false;
  const mine = sigOf(tl);
  return mine.every((s, i) => s.name === starter![i].name && s.text === starter![i].text && s.kind === starter![i].kind && s.title === starter![i].title && !tl.scenes[i].vo);
}

/** subjek timeline sekarang untuk membandingkan dengan permintaan user (research.ts → wantsNewSubject / sameSubject) */
export const timelineAbout = (tl: Pick<Timeline, "title" | "concept" | "goal"> | null | undefined): string =>
  tl ? [tl.title, tl.concept, tl.goal].map((x) => String(x ?? "").trim()).filter(Boolean).join(" · ") : "";
