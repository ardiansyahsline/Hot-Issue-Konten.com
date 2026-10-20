import type { Metadata } from "next";
import "./globals.css";
import { getTheme } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Hot Issues CS — Konten.com",
  description: "Tracker hot issue tim CS Konten.com",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={(await getTheme()) === "light" ? "light" : undefined}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
