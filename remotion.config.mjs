// Konfigurasi Remotion CLI untuk render Studio di laptop (file JS supaya tidak ikut typecheck Next).
// @remotion/cli tidak dipasang di repo website — pasang di laptop render, lalu jalankan dari ROOT repo:
//   npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json --config=remotion.config.mjs
import path from "node:path";
import { Config } from "@remotion/cli/config";

// root repo = folder tempat perintah dijalankan (config ini di-bundle Remotion, jadi import.meta.url tidak bisa dipakai)
const root = path.resolve(process.cwd());

// tsconfig website memakai "jsx": "preserve" (untuk Next) -> paksa JSX otomatis supaya komponen tanpa `import React` jalan
const withAutoJsx = (rule) => {
  if (!rule || !Array.isArray(rule.use)) return rule;
  return {
    ...rule,
    use: rule.use.map((u) =>
      u && typeof u === "object" && String(u.loader).includes("esbuild-loader")
        ? { ...u, options: { ...u.options, jsx: "automatic", tsconfigRaw: { compilerOptions: { jsx: "react-jsx", strict: true } } } }
        : u,
    ),
  };
};

// alias "@/…" sama dengan tsconfig (paths "@/*" → root repo)
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: { ...(current.resolve?.alias ?? {}), "@": root },
  },
  module: { ...current.module, rules: (current.module?.rules ?? []).map(withAutoJsx) },
}));

// folder public bawaan = assets/audio (berisi sfx/ & music/) — lihat pemetaan alamat di remotion/Root.tsx.
// Worker render boleh menggantinya dengan --public-dir=<folder sementara> yang berisi sfx/, music/, storage/<path>.
Config.setPublicDir(path.join(root, "assets", "audio"));

// laptop biasa: 2 tab render paralel cukup (lebih banyak sering bikin kehabisan RAM)
Config.setConcurrency(2);
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
