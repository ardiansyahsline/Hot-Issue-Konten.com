/**
 * Rapikan teks jawaban AI sebelum ditampilkan / disalin (berlaku juga untuk jawaban lama):
 * - buang deretan strip acak yang kadang ditulis model gratis ("–‑ ‑ – ‑ ‑ – …")
 * - angka ribuan pakai spasi ("4 028,84") -> titik ("4.028,84")
 */
const DASH = "[-\\u2010-\\u2015\\u2212]";
const DASH_RUN = new RegExp(`(?:${DASH}[ \\u00A0\\u202F\\u2009]*){4,}`, "g");
const DASH_SOLID = /[‐-―−]{4,}/g;

export function tidyAnswer(text: string): string {
  // jangan sentuh blok kode
  return text
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return (
        part
          // deretan strip (ada strip unicode di dalamnya); "-----" biasa milik tabel/garis markdown dibiarkan
          .replace(DASH_RUN, (m) => (/^[-\s]+$/.test(m) ? m : " "))
          .replace(DASH_SOLID, "")
          // spasi tipis / spasi biasa sebagai pemisah ribuan: 4 028,84 · 1 250 000
          .replace(/(?<![\d.,])\d{1,3}(?:[\u00A0\u202F\u2009 ]\d{3})+(?!\d)/g, (m) => m.split(/[\u00A0\u202F\u2009 ]/).join("."))
          .replace(/[ \t]+$/gm, "")
      );
    })
    .join("");
}
