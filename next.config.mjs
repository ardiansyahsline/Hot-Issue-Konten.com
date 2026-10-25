/** @type {import('next').NextConfig} */
const nextConfig = {
  // penanda versi tiap deploy (dipakai UpdateNotice untuk tahu tab yang terbuka masih versi lama)
  env: { NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA || process.env.VERCEL_DEPLOYMENT_ID || String(Date.now()) },
  experimental: {
    serverActions: { bodySizeLimit: "5mb" }, // untuk import CSV Video Review
    // Halaman yang baru dibuka disimpan 30 detik di browser, jadi bolak-balik menu terasa instan.
    // Setiap kali simpan/edit, cache otomatis di-refresh.
    staleTimes: { dynamic: 30, static: 180 },
  },
  poweredByHeader: false,
  // pptxgenjs (bikin PowerPoint di browser) menyebut modul Node "node:fs"/"node:https" yang tidak dipakai di browser
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:/, (r) => (r.request = r.request.replace(/^node:/, ""))));
      config.resolve.fallback = { ...(config.resolve.fallback ?? {}), fs: false, https: false, http: false, path: false, os: false, zlib: false, stream: false };
    }
    return config;
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};
export default nextConfig;
