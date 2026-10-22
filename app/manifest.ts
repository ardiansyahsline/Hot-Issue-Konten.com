import type { MetadataRoute } from "next";

// supaya bisa "Add to Home Screen" (iPhone butuh ini untuk notifikasi push)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CS Tracker — Konten.com",
    short_name: "CS Tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f4f5",
    theme_color: "#ea580c",
    icons: [{ src: "/icon.png", sizes: "256x256", type: "image/png" }],
  };
}
