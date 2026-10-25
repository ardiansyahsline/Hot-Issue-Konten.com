"use client";

import dynamic from "next/dynamic";

// Remotion cukup dimuat di halaman ini saja (tidak ikut memperberat halaman lain)
const RemotionStudio = dynamic(() => import("./RemotionStudio"), {
  ssr: false,
  loading: () => <div className="card h-[60vh] animate-pulse" />,
});

export default RemotionStudio;
