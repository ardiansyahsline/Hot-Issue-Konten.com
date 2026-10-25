// Konfigurasi Remotion CLI untuk render Studio di laptop (file JS supaya tidak ikut typecheck Next).
// @remotion/cli tidak dipasang di repo website — pasang di laptop render, lalu jalankan dari root repo:
//   npx remotion render remotion/index.ts StudioVideo out.mp4 --props=props.json --config=remotion.config.mjs
import path from "node:path";
import { Config } from "@remotion/cli/config";

// alias "@/…" sama dengan tsconfig (paths "@/*" → root repo)
const root = path.resolve(process.cwd());

Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: { ...(current.resolve?.alias ?? {}), "@": root },
  },
}));

// laptop biasa: 2 tab render paralel cukup (lebih banyak sering bikin kehabisan RAM)
Config.setConcurrency(2);
Config.setVideoImageFormat("jpeg");
Config.setCodec("h264");
