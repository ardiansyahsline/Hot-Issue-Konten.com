export const SG_CATEGORIES = {
  fitur: { label: "Fitur", desc: "Ide / permintaan fitur baru", icon: "✨", cls: "bg-violet-500/15 text-violet-300 ring-violet-500/30" },
  keluhan_clipper: { label: "Keluhan clipper", desc: "Keluhan yang sering datang dari clipper", icon: "💬", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  brief_campaign: { label: "Brief campaign", desc: "Masukan soal brief / aturan campaign", icon: "📋", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
} as const;
export type SgCategory = keyof typeof SG_CATEGORIES;

export const SG_STATUSES = {
  baru: { label: "Baru", cls: "bg-zinc-500/15 text-zinc-300 ring-zinc-500/30", dot: "bg-zinc-400" },
  in_progress: { label: "In Progress", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30", dot: "bg-amber-400" },
  done: { label: "Done", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", cls: "bg-red-500/15 text-red-300 ring-red-500/30", dot: "bg-red-500" },
} as const;
export type SgStatus = keyof typeof SG_STATUSES;

export const isSgCategory = (c: unknown): c is SgCategory => typeof c === "string" && c in SG_CATEGORIES;
export const isSgStatus = (s: unknown): s is SgStatus => typeof s === "string" && s in SG_STATUSES;

export type SuggestionRow = {
  id: number;
  category: SgCategory;
  title: string;
  body: string | null;
  status: SgStatus;
  status_reason: string | null;
  status_changed_by: string | null;
  status_changed_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
  status_changed_by_name: string | null;
  comment_count: number;
  last_comment_at: string | null;
};
