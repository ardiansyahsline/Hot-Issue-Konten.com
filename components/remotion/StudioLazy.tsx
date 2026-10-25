"use client";

import dynamic from "next/dynamic";

// Remotion & Studio cukup dimuat di halaman ini saja (tidak ikut memperberat halaman lain)
const RemotionStudio = dynamic(() => import("./RemotionStudio"), {
  ssr: false,
  loading: () => <div className="card h-[60vh] animate-pulse" />,
});

/** Studio Pro: chat Harley, rencana, preview, timeline, suara, export */
export const StudioPro = dynamic(() => import("./pro/StudioPro"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <div className="card h-16 animate-pulse" />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card h-[60vh] animate-pulse" />
        <div className="card h-[60vh] animate-pulse" />
      </div>
    </div>
  ),
});

/** Bank suara (rekaman referensi untuk VO) */
export const VoiceBank = dynamic(() => import("./pro/VoiceBank"), {
  ssr: false,
  loading: () => <div className="card h-[40vh] animate-pulse" />,
});

export default RemotionStudio;
