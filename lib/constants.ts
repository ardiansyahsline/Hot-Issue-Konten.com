export const CATEGORIES = [
  "Withdraw / Payout",
  "Views tidak update",
  "Bot views",
  "Banding / Reject",
  "Akun / Verifikasi / OTP",
  "Campaign",
  "Bug platform",
  "Lainnya",
] as const;

export const STATUSES = {
  open: { label: "Open", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  in_progress: { label: "In Progress", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  resolved: { label: "Resolved", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
} as const;

export const PRIORITIES = {
  low: { label: "Low", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30" },
  medium: { label: "Medium", cls: "bg-blue-500/15 text-blue-300 ring-blue-500/30" },
  high: { label: "High", cls: "bg-orange-500/15 text-orange-300 ring-orange-500/30" },
  urgent: { label: "Urgent", cls: "bg-red-500/20 text-red-300 ring-red-500/40" },
} as const;

export type StatusKey = keyof typeof STATUSES;
export type PriorityKey = keyof typeof PRIORITIES;

/** Topik Hot Issue otomatis HOT kalau jumlah laporannya (laporan awal + tambahan) mencapai angka ini */
export const REPORT_HOT_THRESHOLD = Math.max(2, Number(process.env.NEXT_PUBLIC_REPORT_HOT_THRESHOLD) || 3);
export const HOT_THRESHOLD = Math.max(1, Number(process.env.NEXT_PUBLIC_HOT_THRESHOLD) || 2);
