"use client";

import { useState } from "react";
import UserAvatar, { isOnline, lastSeenText } from "@/components/UserAvatar";
import { DocIcon } from "@/components/attach/AttachmentPicker";
import { Lightbox } from "@/components/attach/AttachmentGallery";
import { isViewableImage } from "@/lib/attachments";
import { ROLES, isRole } from "@/lib/roles";
import { personName, type ChatFile, type ChatPerson } from "./useChat";

/** urutkan: online dulu, lalu yang terakhir dilihat paling baru */
export function sortByPresence(list: ChatPerson[]) {
  return [...list].sort((a, b) => {
    const oa = isOnline(a.last_seen_at) ? 1 : 0;
    const ob = isOnline(b.last_seen_at) ? 1 : 0;
    if (oa !== ob) return ob - oa;
    return (b.last_seen_at ?? "").localeCompare(a.last_seen_at ?? "");
  });
}

/** Panel kanan halaman Chat: anggota + status online, dan file yang pernah dikirim di room ini */
export default function ChatMembers({ members, meId, files }: { members: ChatPerson[]; meId: string; files: ChatFile[] }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const imgs = files.filter((f) => isViewableImage(f.mime) && f.url);
  const docs = files.filter((f) => !(isViewableImage(f.mime) && f.url));
  return (
    <div className="space-y-6">
      <div>
        <div className="label">Anggota · {members.length}</div>
        <ul className="mt-2 space-y-3">
          {sortByPresence(members).map((p) => {
            const role = isRole(p.role) ? ROLES[p.role] : null;
            const on = isOnline(p.last_seen_at);
            return (
              <li key={p.id} className="flex items-center gap-3">
                <UserAvatar name={personName(p)} url={p.avatar_url} size={32} online={on} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-semibold">
                    {personName(p)}
                    {p.id === meId && <span className="font-medium text-zinc-500"> (kamu)</span>}
                    {role && <span className="ml-1 text-[11px] font-medium text-zinc-500">{role.label}</span>}
                  </div>
                  <div className={`truncate text-[11.5px] ${on ? "text-emerald-500" : "text-zinc-500"}`}>{lastSeenText(p.last_seen_at)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <div className="label">File di room ini{files.length ? ` · ${files.length}${files.length >= 12 ? "+" : ""}` : ""}</div>
        {files.length === 0 && <p className="mt-1 text-[12px] text-zinc-500">Belum ada file. Klik 📎 atau Ctrl+V di kolom pesan.</p>}
        {imgs.length > 0 && (
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {imgs.map((f, i) => (
              <button key={f.id} type="button" onClick={() => setViewer(i)} className="aspect-square overflow-hidden rounded-lg ring-1 ring-zinc-800" title={f.name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url!} alt={f.name} loading="lazy" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {docs.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {docs.map((f) => (
              <li key={f.id}>
                <a href={f.url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg p-1 hover:bg-zinc-800/50">
                  <DocIcon name={f.name} mime={f.mime} size={26} />
                  <span className="truncate text-[12.5px]">{f.name}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {viewer !== null && imgs[viewer] && <Lightbox images={imgs} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </div>
  );
}
