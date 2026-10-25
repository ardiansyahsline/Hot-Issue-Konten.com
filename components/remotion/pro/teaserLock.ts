import type { Scene, Timeline } from "@/lib/studio/timeline";

/** adegan premium teaser (layout "teaser", buatan tangan di components/remotion/studio/teaser) */
export const isTeaserScene = (s: Pick<Scene, "layout"> | null | undefined) => s?.layout?.kind === "teaser";

/**
 * Adegan premium teaser: batasnya di ketukan musik (0,6 dtk) & visualnya buatan tangan, jadi durasi, jenis tampilan, latar,
 * kamera & catatan visual TIDAK boleh berubah lewat editor rencana/timeline (mis. tombol "Pas-kan ke ketukan" atau tarik tepi blok).
 * Teks, VO, SFX, transisi & level musik tetap bebas. VO yang lebih panjang dari adegan (VoPanel) lewat jalur lain dan tetap boleh
 * memanjangkan adegan supaya suara tidak terpotong.
 */
export function keepTeaserVisual(prev: Timeline | null, next: Timeline): Timeline {
  if (!prev || prev === next) return next;
  const old = new Map(prev.scenes.filter(isTeaserScene).map((s) => [s.id, s] as const));
  if (!old.size) return next;
  let changed = false;
  const scenes = next.scenes.map((s) => {
    const o = old.get(s.id);
    if (!o || (s.dur === o.dur && s.layout === o.layout && s.bg === o.bg && s.camera === o.camera && s.visual === o.visual)) return s;
    changed = true;
    return { ...s, dur: o.dur, layout: o.layout, bg: o.bg, camera: o.camera, visual: o.visual };
  });
  return changed ? { ...next, scenes } : next;
}
