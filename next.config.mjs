/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "5mb" }, // untuk import CSV Video Review
    // Halaman yang baru dibuka disimpan 30 detik di browser, jadi bolak-balik menu terasa instan.
    // Setiap kali simpan/edit, cache otomatis di-refresh.
    staleTimes: { dynamic: 30, static: 180 },
  },
};
export default nextConfig;
