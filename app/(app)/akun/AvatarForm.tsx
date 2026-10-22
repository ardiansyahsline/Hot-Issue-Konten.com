"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import UserAvatar from "@/components/UserAvatar";
import { setAvatar } from "./actions";

/** potong jadi persegi di tengah, kecilkan ke 320px, simpan WebP */
async function squareWebp(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const size = Math.min(320, side);
  const c = document.createElement("canvas");
  c.width = c.height = size;
  c.getContext("2d")!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/webp", 0.88));
  if (!blob) throw new Error("Gagal memproses foto");
  return blob;
}

export default function AvatarForm({ userId, name, url }: { userId: string; name: string; url: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [preview, setPreview] = useState<string | null>(url);
  const [msg, setMsg] = useState<{ ok?: string; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  async function pick(file?: File) {
    if (!file) return;
    if (!/^image\//.test(file.type)) return setMsg({ error: "Pilih file gambar (JPG / PNG / WebP)." });
    setBusy(true);
    setMsg(null);
    try {
      const blob = await squareWebp(file);
      const path = `${userId}/${crypto.randomUUID()}.webp`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("avatar").upload(path, await blob.arrayBuffer(), { contentType: "image/webp", upsert: false });
      if (error) throw new Error(/bucket/i.test(error.message) ? "Penyimpanan foto belum aktif (migration-09 belum dijalankan)." : error.message);
      const publicUrl = supabase.storage.from("avatar").getPublicUrl(path).data.publicUrl;
      const r = await setAvatar(publicUrl);
      setMsg(r ?? null);
      if (r?.ok) {
        setPreview(publicUrl);
        start(() => router.refresh());
      }
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "Upload gagal" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex items-center gap-4 p-5">
      <UserAvatar name={name} url={preview} size={72} />
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="font-semibold">Foto profil</h2>
        <p className="text-[12.5px] text-zinc-500">Tampil di chat, komentar, dan menu atas. Otomatis dipotong persegi.</p>
        <div className="flex flex-wrap gap-2">
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="btn-primary px-3 py-1.5 text-xs">
            {busy ? "Mengupload…" : preview ? "Ganti foto" : "Upload foto"}
          </button>
          {preview && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const r = await setAvatar(null);
                setMsg(r ?? null);
                if (r?.ok) {
                  setPreview(null);
                  router.refresh();
                }
              }}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Hapus
            </button>
          )}
        </div>
        {msg?.error && <p className="text-xs text-red-400">{msg.error}</p>}
        {msg?.ok && <p className="text-xs text-emerald-400">✓ {msg.ok}</p>}
      </div>
    </div>
  );
}
