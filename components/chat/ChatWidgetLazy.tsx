"use client";

import dynamic from "next/dynamic";

// Widget chat dimuat belakangan (setelah halaman tampil) supaya tidak memperlambat halaman lain
const ChatWidget = dynamic(() => import("./ChatWidget"), { ssr: false });

export default function ChatWidgetLazy({ meId }: { meId: string }) {
  return <ChatWidget meId={meId} />;
}
