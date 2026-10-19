import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hot Issues CS — Konten.com",
  description: "Tracker hot issue tim CS Konten.com",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
