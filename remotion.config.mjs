// Konfigurasi Remotion CLI untuk render Studio di laptop (file JS supaya tidak ikut typecheck Next).
// @remotion/cli tidak dipasang di repo website — pasang di laptop render, lalu jalankan dari ROOT repo:
//   npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json --config=remotion.config.mjs
import path from "node:path";
import { Config } from "@remotion/cli/config";

// root repo = folder tempat perintah dijalankan (config ini di-bundle Remotion, jadi import.meta.url tidak bisa dipakai)
const root = path.resolve(process.cwd());

// alias "@/…" sama dengan tsconfig (paths "@/*" → root repo)
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: { ...(current.resolve?.alias ?? {}), "@": root },
  },
}));

// folder public bawaan = assets/audio (berisi sfx/ & music/) — lihat pemetaan alamat di remotion/Root.tsx.
// Worker render boleh menggantinya dengan --public-dir=<folder sementara> yang berisi sfx/, music/, storage/<path>.
Config.setPublicDir(path.join(root, "assets", "audio"));

// laptop biasa: 2 tab render paralel cukup (lebih banyak sering bikin kehabisan RAM)
Config.setConcurrency(2);
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
