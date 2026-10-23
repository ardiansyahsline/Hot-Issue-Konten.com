import { createHash } from "node:crypto";

/** PIN halaman Usage (terpisah dari login). Ubah lewat env AI_USAGE_PIN di Vercel; default 1203. */
export const usagePin = () => (process.env.AI_USAGE_PIN ?? "1203").trim() || "1203";
export const PIN_COOKIE = "ai_usage_pin";
/** nilai cookie: hash dari PIN + id user (ganti PIN = semua sesi lama otomatis tidak berlaku) */
export const pinToken = (userId: string) => createHash("sha256").update(`${usagePin()}:${userId}:cs-tracker-usage`).digest("hex");
