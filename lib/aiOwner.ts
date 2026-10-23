/**
 * Pemilik tab AI (default: Alif). Hanya akun ini yang melihat info teknis:
 * "↪ dibantu hero lain", status hero gagal/tersambung, tombol cek hero, dan halaman Usage.
 * Bisa diganti tanpa ubah kode lewat env AI_OWNER_EMAILS (pisahkan dengan koma).
 */
export function isAiOwner(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.AI_OWNER_EMAILS ?? "alif.ardiansyah@orovagroup.id")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}
