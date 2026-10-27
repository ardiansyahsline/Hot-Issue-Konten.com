"use client";

import dynamic from "next/dynamic";
import { useClosedTabs } from "@/components/TabAccessProvider";

// Widget chat dimuat belakangan (setelah halaman tampil) supaya tidak memperlambat halaman lain
const ChatWidget = dynamic(() => import("./ChatWidget"), { ssr: false });

export default function ChatWidgetLazy({ meId }: { meId: string }) {
  // tab Chat ditutup admin -> widget tidak dipasang (kode tidak dimuat, tidak berlangganan pesan);
  // daftar tab diperbarui di browser, jadi widget ikut hilang / muncul tanpa muat ulang
  if (useClosedTabs().includes("chat")) return null;
  return <ChatWidget meId={meId} />;
}
