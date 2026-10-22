import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { getTheme } from "@/lib/theme";
import { SpeedInsights } from "@vercel/speed-insights/next";

export const metadata: Metadata = {
  title: "CS Tracker — Konten.com",
  description: "CS Tracker — tools internal tim Customer Service Konten.com (PT Orova Genesis Group) untuk hot issue, video review, serta catatan & saran.",
  robots: { index: false, follow: false, nocache: true },
  applicationName: "CS Tracker",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await getTheme();
  return (
    <html lang="id" className={theme === "light" ? "light" : undefined}>
      <body className="min-h-screen">
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
