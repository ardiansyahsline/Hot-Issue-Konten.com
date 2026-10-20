import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { getTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Hot Issues CS — Konten.com",
  description: "Tools internal tim Customer Service Konten.com (PT Orova Genesis Group) untuk mencatat hot issue dan video review.",
  robots: { index: false, follow: false, nocache: true },
  applicationName: "Hot Issues CS",
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
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
