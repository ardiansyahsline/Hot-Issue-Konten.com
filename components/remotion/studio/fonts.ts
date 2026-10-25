/**
 * Font Studio untuk render MP4 di browser (@remotion/web-renderer).
 * Teks di dalam <svg> (angka 3D, label chart) digambar sebagai gambar terpisah yang tidak bisa memakai font halaman,
 * jadi font @fontsource yang sudah dimuat halaman didaftarkan ulang ke Remotion (loadFont) supaya ikut tertanam.
 * Laptop (Remotion CLI) & preview tidak butuh ini.
 */
import { loadFont } from "@remotion/fonts";

const FAMILIES = new Set(["Inter Variable", "Plus Jakarta Sans Variable", "Inter Tight Variable"]);
/** cukup huruf latin & latin-ext (bahasa Indonesia / Inggris), subset lain tidak diunduh */
const LATIN = /U\+0+-0*FF\b|U\+0*100-/i;

let done: Promise<void> | null = null;

export function registerStudioFonts(): Promise<void> {
  if (done) return done;
  done = (async () => {
    const jobs: Promise<unknown>[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // stylesheet beda origin
      }
      for (const r of Array.from(rules)) {
        if (!(r instanceof CSSFontFaceRule)) continue;
        const family = r.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
        const range = r.style.getPropertyValue("unicode-range");
        if (!FAMILIES.has(family) || (range && !LATIN.test(range))) continue;
        const m = r.style.getPropertyValue("src").match(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/);
        if (!m) continue;
        jobs.push(
          loadFont({
            family,
            url: new URL(m[1], sheet.href ?? location.href).href,
            weight: r.style.getPropertyValue("font-weight") || undefined,
            style: r.style.getPropertyValue("font-style") || undefined,
            unicodeRange: range || undefined,
          }).catch(() => {}), // gagal -> teks svg pakai font cadangan, render tetap jalan
        );
      }
    }
    await Promise.all(jobs);
  })();
  return done;
}
