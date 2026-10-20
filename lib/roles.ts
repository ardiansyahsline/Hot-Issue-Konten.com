export const ROLES = {
  admin: { label: "Admin", desc: "Semua akses + kelola user & hapus data", cls: "text-orange-400" },
  cs: { label: "CS", desc: "Input & edit Hot Issues dan Video Review", cls: "text-sky-400" },
  video_review: { label: "Video Review", desc: "Input & edit Video Review dan Hot Issues", cls: "text-violet-400" },
  discord_mod: { label: "Discord Moderator", desc: "Input & edit Hot Issues, lihat Video Review", cls: "text-indigo-400" },
  user: { label: "User", desc: "Hanya bisa melihat (read-only)", cls: "text-zinc-400" },
} as const;

export type Role = keyof typeof ROLES;

export function isRole(r: unknown): r is Role {
  return typeof r === "string" && r in ROLES;
}

// HARUS sama dengan fungsi can_write_issues() / can_write_reviews() di SQL
export function canWriteIssues(role: string | null | undefined) {
  return role === "admin" || role === "cs" || role === "video_review" || role === "discord_mod";
}

export function canWriteReviews(role: string | null | undefined) {
  return role === "admin" || role === "cs" || role === "video_review";
}

export function roleLabel(role: string | null | undefined) {
  return isRole(role) ? ROLES[role].label : role ?? "-";
}
