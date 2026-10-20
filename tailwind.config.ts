import type { Config } from "tailwindcss";
import colors from "tailwindcss/colors";
import plugin from "tailwindcss/plugin";

/**
 * Tema terang/gelap: semua warna palet dibaca dari CSS variable.
 * Mode gelap = warna asli Tailwind. Mode terang = skala dibalik (950 <-> 50, dst),
 * jadi class yang sama (mis. bg-zinc-900, text-zinc-400) otomatis cocok di dua mode.
 */
const PALETTES = ["zinc", "sky", "amber", "emerald", "red", "orange", "blue", "violet", "indigo"] as const;
const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
const INVERT: Record<string, string> = {
  "50": "950", "100": "900", "200": "800", "300": "700", "400": "600", "500": "500",
  "600": "400", "700": "300", "800": "200", "900": "100", "950": "50",
};
// Netral di mode terang dibuat khusus: background abu muda, kartu putih
const LIGHT_ZINC: Record<string, string> = {
  "950": "#f4f4f5", "900": "#ffffff", "800": "#e4e4e7", "700": "#d4d4d8", "600": "#a1a1aa",
  "500": "#71717a", "400": "#52525b", "300": "#3f3f46", "200": "#27272a", "100": "#18181b", "50": "#09090b",
};

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(" ");
};
const pal = (p: string) => (colors as unknown as Record<string, Record<string, string>>)[p];

const darkVars: Record<string, string> = {};
const lightVars: Record<string, string> = {};
for (const p of PALETTES) {
  for (const s of SHADES) {
    darkVars[`--c-${p}-${s}`] = rgb(pal(p)[s]);
    lightVars[`--c-${p}-${s}`] = rgb(p === "zinc" ? LIGHT_ZINC[s] : pal(p)[INVERT[s]]);
  }
}

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.ts"],
  theme: {
    extend: {
      colors: Object.fromEntries(
        PALETTES.map((p) => [p, Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${p}-${s}) / <alpha-value>)`]))])
      ),
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ":root": { ...darkVars, "color-scheme": "dark" },
        "html.light": { ...lightVars, "color-scheme": "light" },
      });
    }),
  ],
} satisfies Config;
