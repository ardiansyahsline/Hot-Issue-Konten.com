"use client";

/**
 * Potongan UI "sebelum CS Tracker" untuk adegan Hook teaser:
 * - sheet "Video Review WA" (header asli lib/videoReview.ts sheetToReviews: Tanggal Report, Penjelasan, Email/link, Penyelesaian, Catatan, Kategori;
 *   teks Penyelesaian "belum ada respons" = status Menunggu asli)
 * - panel "Mirip topik yang sudah ada" (components/SimilarTopics.tsx) dengan topik kembar
 * - notifikasi chat grup generik yang menumpuk (bukan tampilan aplikasi chat mana pun)
 * Identitas clipper (email / link TikTok) TIDAK pernah digambar sebagai teks asli: hanya placeholder tersamar ("•••••@gmail.com",
 * "tiktok.com/@•••••/video/••••") + blur hiasan, jadi tetap aman di render browser (filter anak bisa menggantikan filter induk).
 * Kompatibel @remotion/web-renderer: tanpa box-shadow spread / inset (pakai border / outline / latar opak hasil mix),
 * tanpa latar berlapis "gradien, #warna", tanpa z-index (urutan DOM yang menentukan).
 */
import type { CSSProperties, ReactNode } from "react";
import { Blur, FONT, Icon, Z } from "../../screens/ui";
import { mix, rgba } from "../../theme";
import { RED, softBlur } from "./intro-parts";

// ---------------------------------------------------------------------------------------------
// Sheet "Video Review WA"
// ---------------------------------------------------------------------------------------------
export const SHEET_COLS: { k: string; w: number }[] = [
  { k: "Tanggal Report", w: 220 },
  { k: "Penjelasan", w: 450 },
  { k: "Email/link", w: 240 },
  { k: "Penyelesaian", w: 300 },
  { k: "Catatan", w: 180 },
  { k: "Kategori", w: 380 },
];
export const SHEET_NUM_W = 78;
export const SHEET_ROW_H = 68;
export const SHEET_W = SHEET_NUM_W + SHEET_COLS.reduce((a, c) => a + c.w, 0);
/** tinggi bagian atas sheet sebelum baris data: judul + formula + huruf kolom + header */
export const SHEET_HEAD_H = 74 + 58 + 46 + SHEET_ROW_H;

type Cell = string;
/** [tanggal, penjelasan, kontak (e = email, u = link), penyelesaian, catatan, kategori] */
export const SHEET_ROWS: Cell[][] = [
  ["12/10/2026", "Saldo dibekukan, udah 3 hari", "e", "belum ada respons", "??", ""],
  ["12 okt", "saldo dibekukan jg kak", "u", "belum ada respons", "dobel?", "Saldo dibekukan (cek/menanyakan)"],
  ["", "Minta review video ulang", "e", "diproses", "", "Permintaan review video"],
  ["13-10", "Views ga update 2 hari", "u", "belum ada respons", "cek lagi", ""],
  ["13/10", "Banding video ditolak", "e", "ditolak (Irsyad)", "", "Pengajuan banding"],
  ["", "(sama kyk atas)", "u", "", "", ""],
  ["14/10", "Review lewat estimasi waktu", "e", "belum ada respons", "!!!", "Review/rilis melewati estimasi waktu"],
  ["14/10", "Saldo dibekukan, udah 3 hari", "e", "belum ada respons", "DOBEL", ""],
  ["15 okt", "Video ga sesuai brief?", "u", "???", "", "Lainnya"],
  ["", "Refresh views top clipper", "e", "belum ada respons", "", ""],
  ["16/10", "Saldo blm cair", "u", "belum ada respons", "?", ""],
  ["16/10", "minta cek video", "e", "", "siapa yg pegang?", ""],
  ["17/10", "Views ga update 2 hari", "u", "belum ada respons", "dobel", ""],
  ["", "", "e", "", "", ""],
];
export const DUP_ROWS = new Set([0, 7]);
const FIRST_ROW = 212;

const GRID = "#2a2a2f";
const ink = { head: Z[200], cell: "#b9b9c1", dim: Z[500] };

/** kontak clipper: placeholder tersamar (bukan data asli), blur hanya hiasan */
const CONTACT_MASK: Record<string, string> = { e: "•••••••@gmail.com", u: "tiktok.com/@•••••/video/••••" };

function Contact({ kind, size }: { kind: string; size: number }) {
  return (
    <Blur px={4}>
      <span style={{ color: "#7dd3fc", textDecoration: "underline", fontSize: size, letterSpacing: "0.02em" }}>{CONTACT_MASK[kind] ?? CONTACT_MASK.e}</span>
    </Blur>
  );
}

/** cincin merah baris kembar: border (bukan box-shadow inset) + tint + glow luar biasa (tanpa spread) */
function RowRing({ style }: { style?: CSSProperties }) {
  return <div style={{ position: "absolute", left: 0, top: 0, right: 0, height: SHEET_ROW_H, boxSizing: "border-box", border: `3px solid ${RED}`, background: rgba(RED, 0.05), boxShadow: `0 0 36px ${rgba(RED, 0.6)}`, pointerEvents: "none", ...style }} />;
}

function cellStyle(ci: number, v: string, ri: number): CSSProperties {
  const isWait = ci === 3 && v === "belum ada respons";
  const isNote = ci === 4 && v !== "";
  const isQ = ci === 3 && v === "???";
  return {
    background: isWait ? rgba(RED, 0.16) : isNote ? rgba("#f59e0b", 0.16) : isQ ? rgba(RED, 0.08) : ri % 2 ? "#141417" : "#111114",
    color: isWait ? "#fca5a5" : isNote ? "#fcd34d" : v.startsWith("ditolak") ? "#fca5a5" : v === "diproses" ? "#fcd34d" : ink.cell,
    fontWeight: isWait || isNote ? 650 : 450,
  };
}

/** satu baris sheet (dipakai juga sebagai serpihan "data kececer") */
export function SheetRow({ ri, fs = 25, cols = [0, 1, 2, 3, 4, 5], num = true, outline, blur = 0 }: { ri: number; fs?: number; cols?: number[]; num?: boolean; outline?: boolean; blur?: number }) {
  const r = SHEET_ROWS[ri % SHEET_ROWS.length];
  return (
    <div style={{ display: "flex", height: SHEET_ROW_H, position: "relative", fontFamily: FONT, fontSize: fs, filter: blur > 0.3 ? softBlur(blur) : undefined, opacity: blur > 0.3 ? 0.55 : undefined }}>
      {num && <div style={{ width: SHEET_NUM_W, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "#1c1c20", color: ink.dim, borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, fontSize: fs * 0.82 }}>{FIRST_ROW + ri}</div>}
      {cols.map((ci) => {
        const v = r[ci] ?? "";
        return (
          <div key={ci} style={{ width: SHEET_COLS[ci].w, flex: "none", display: "flex", alignItems: "center", padding: "0 16px", borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, whiteSpace: "nowrap", overflow: "hidden", ...cellStyle(ci, v, ri) }}>
            {ci === 2 ? <Contact kind={v} size={fs} /> : v}
          </div>
        );
      })}
      {outline && <RowRing />}
    </div>
  );
}

/**
 * sheet lengkap: judul file, bar formula, huruf kolom, header asli, baris data berantakan.
 * `focus` = baris yang tetap tajam (rack focus), baris lain diburamkan `blur` px; `fs` = ukuran teks sel.
 */
export function Sheet({ rows = SHEET_ROWS.length, sel = 3, fs = 25, focus, blur = 0 }: { rows?: number; sel?: number; fs?: number; focus?: number[]; blur?: number }) {
  const letters = "ABCDEF";
  const soft = blur > 0.3 ? softBlur(blur * 0.5) : undefined;
  return (
    <div style={{ position: "relative", width: SHEET_W, background: "#111114", borderRadius: 18, overflow: "hidden", border: `1px solid ${GRID}`, boxShadow: "0 40px 120px -30px rgba(0,0,0,0.9)", fontFamily: FONT }}>
      {/* judul file */}
      <div style={{ filter: soft, height: 74, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 16, padding: "0 26px", background: "#18181b", borderBottom: `1px solid ${GRID}` }}>
        <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={Z[400]} strokeWidth={1.8}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
          <path d="M3.5 9h17M3.5 14.5h17M9.5 3.5v17" />
        </svg>
        <span style={{ fontSize: 30, fontWeight: 650, color: Z[200] }}>Video Review WA</span>
        <span style={{ fontSize: 22, color: Z[500] }}>· terakhir diedit 2 menit lalu</span>
      </div>
      {/* bar formula */}
      <div style={{ filter: soft, height: 58, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 18, padding: "0 26px", background: "#141417", borderBottom: `1px solid ${GRID}`, fontSize: 24, color: Z[300] }}>
        <span style={{ color: Z[500], fontStyle: "italic", fontWeight: 600 }}>fx</span>
        <span style={{ width: 1, height: 30, background: GRID }} />
        <span>belum ada respons</span>
      </div>
      {/* huruf kolom */}
      <div style={{ filter: soft, display: "flex", height: 46, background: "#1c1c20", color: ink.dim, fontSize: 21 }}>
        <div style={{ width: SHEET_NUM_W, flex: "none", borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}` }} />
        {SHEET_COLS.map((c, i) => (
          <div key={i} style={{ width: c.w, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", borderRight: `1px solid ${GRID}`, borderBottom: `1px solid ${GRID}`, background: i === sel ? "#26262b" : undefined, color: i === sel ? Z[300] : undefined }}>
            {letters[i]}
          </div>
        ))}
      </div>
      {/* header asli sheet */}
      <div style={{ display: "flex", height: SHEET_ROW_H, background: "#1a1a1e", fontSize: Math.max(25, fs), fontWeight: 750, color: ink.head }}>
        <div style={{ width: SHEET_NUM_W, flex: "none", display: "flex", alignItems: "center", justifyContent: "center", background: "#1c1c20", color: ink.dim, fontWeight: 450, fontSize: 21, borderRight: `1px solid ${GRID}`, borderBottom: `2px solid #3a3a41` }}>{FIRST_ROW - 1}</div>
        {SHEET_COLS.map((c, i) => (
          <div key={i} style={{ width: c.w, flex: "none", display: "flex", alignItems: "center", padding: "0 16px", borderRight: `1px solid ${GRID}`, borderBottom: `2px solid #3a3a41` }}>
            {c.k}
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, ri) => (
        <SheetRow key={ri} ri={ri} fs={fs} blur={focus && !focus.includes(ri) ? blur : 0} />
      ))}
      {/* cincin baris kembar digambar SETELAH semua baris (glow di atas baris tetangga; web-renderer mengabaikan z-index) */}
      {Array.from(DUP_ROWS)
        .filter((ri) => ri < rows)
        .map((ri) => {
          const b = focus && !focus.includes(ri) ? blur : 0;
          return <RowRing key={ri} style={{ top: SHEET_HEAD_H + ri * SHEET_ROW_H, filter: b > 0.3 ? softBlur(b) : undefined, opacity: b > 0.3 ? 0.55 : undefined }} />;
        })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Panel "Mirip topik yang sudah ada" (SimilarTopics.tsx) — skala video
// ---------------------------------------------------------------------------------------------
export const SIMILAR = [
  { title: "Saldo dibekukan, belum bisa WD", cat: "Withdraw / Payout", st: "Open", n: 3 },
  { title: "saldo dibekukan blm cair", cat: "Withdraw / Payout", st: "Open", n: 2 },
  { title: "Saldo di bekukan??", cat: "Lainnya", st: "Open", n: 1 },
  { title: "Saldo dibekukan (lagi)", cat: "Withdraw / Payout", st: "In Progress", n: 2 },
];
/** heatLevel asli (lib/utils.ts, REPORT_HOT_THRESHOLD 3) */
const heat = (n: number) => (n >= 9 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : n >= 2 ? 1 : 0);

export function SimilarItem({ i, k = 2.2, style }: { i: number; k?: number; style?: CSSProperties }) {
  const it = SIMILAR[i % SIMILAR.length];
  const hot = it.n >= 2;
  return (
    <div style={{ borderRadius: 12 * k, border: `1px solid ${rgba(Z[800], 0.8)}`, background: Z[900], padding: `${8 * k}px ${12 * k}px`, fontFamily: FONT, boxShadow: "0 20px 50px -24px rgba(0,0,0,0.9)", ...style }}>
      <div style={{ fontSize: 13.5 * k, fontWeight: 650, color: Z[100], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.title}</div>
      <div style={{ marginTop: 2 * k, display: "flex", alignItems: "center", gap: 4 * k, fontSize: 11.5 * k, color: Z[500], whiteSpace: "nowrap" }}>
        <span>
          {it.cat} · {it.st} ·
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 1 * k, color: hot ? "#f87171" : undefined, fontWeight: hot ? 650 : 450 }}>
          {Array.from({ length: Math.max(1, heat(it.n)) }, (_, j) => (
            <Icon key={j} name="flame" size={12 * k} color={hot ? "#f87171" : Z[500]} />
          ))}
          {it.n} laporan
        </span>
      </div>
      <div style={{ marginTop: 6 * k, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10 * k }}>
        <span style={{ fontSize: 12 * k, color: Z[400] }}>Lihat</span>
        <span style={{ fontSize: 12 * k, fontWeight: 650, color: "#fb923c", background: rgba("#f97316", 0.15), borderRadius: 8 * k, padding: `${4 * k}px ${10 * k}px` }}>+ Tambahkan sebagai laporan</span>
      </div>
    </div>
  );
}

/** panel amber "Mirip topik yang sudah ada." + daftar topik kembar; `items[i]` = progres muncul tiap item (0..1) */
export function SimilarPanel({ w, k = 2.2, items }: { w: number; k?: number; items: number[] }) {
  return (
    <div style={{ width: w, borderRadius: 16 * k, border: `1px solid ${rgba("#f59e0b", 0.3)}`, background: `linear-gradient(180deg, ${mix("#0d0d10", "#f59e0b", 0.09)} 0%, ${mix("#0d0d10", "#f59e0b", 0.05)} 100%)`, padding: 12 * k, fontFamily: FONT, boxShadow: "0 50px 120px -40px rgba(0,0,0,0.95)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 * k }}>
        <p style={{ margin: 0, fontSize: 12.5 * k, lineHeight: 1.4, color: "#fcd34d" }}>
          <b>Mirip topik yang sudah ada.</b> Kalau kasusnya sama, tambahkan sebagai laporan
        </p>
        <span style={{ fontSize: 12 * k, color: Z[500] }}>✕</span>
      </div>
      <div style={{ marginTop: 8 * k, display: "flex", flexDirection: "column", gap: 6 * k }}>
        {items.map((p, i) => (
          <div key={i} style={{ maxHeight: Math.max(0, Math.min(1, p * 1.25)) * 84 * k, marginTop: i ? -6 * k * (1 - Math.min(1, p * 1.25)) : 0, overflow: "visible" }}>
            <div style={{ opacity: Math.min(1, p * 2), transform: `translateY(${((1 - p) * -38).toFixed(1)}px) scale(${(1.06 - 0.06 * p).toFixed(4)})`, transformOrigin: "50% 0" }}>
              <SimilarItem i={i} k={k} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Notifikasi chat grup (generik)
// ---------------------------------------------------------------------------------------------
export const NOTIFS: { who: string; msg: string }[] = [
  { who: "Natasha", msg: "Ini topik yang sama kan??" },
  { who: "Irsyad", msg: "Link clipper-nya mana ya" },
  { who: "Derencalibur", msg: "Sheet yang mana sih?" },
  { who: "Nengok", msg: "Udah dibalas belum?" },
  { who: "Alif", msg: "@Natasha cek baris 214" },
  { who: "Natasha", msg: "Kok dobel lagi" },
  { who: "Irsyad", msg: "Siapa yang pegang ini?" },
  { who: "Derencalibur", msg: "Datanya kececer di mana?" },
  { who: "Nengok", msg: "Tolong cek DM juga" },
  { who: "Alif", msg: "Belum ada yang respons" },
  { who: "Natasha", msg: "Masuk lagi 3 laporan" },
  { who: "Irsyad", msg: "Ulang dari awal deh" },
];
export const UNREAD = [7, 12, 18, 23, 31, 38, 46, 57, 64, 78, 89, 99];
export const NOTIF_H = 150;

function ChatGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />
    </svg>
  );
}

export function NotifCard({ i, w = 840, time = "baru saja" }: { i: number; w?: number; time?: string }) {
  const n = NOTIFS[i % NOTIFS.length];
  const unread = UNREAD[i % UNREAD.length];
  return (
    <div style={{ width: w, height: NOTIF_H, boxSizing: "border-box", borderRadius: 34, background: "linear-gradient(180deg, #2b2b30 0%, #232327 100%)", border: `1px solid ${rgba(Z[600], 0.45)}`, display: "flex", alignItems: "center", gap: 24, padding: "0 28px", fontFamily: FONT, boxShadow: "0 24px 60px -20px rgba(0,0,0,0.85)" }}>
      <span style={{ width: 84, height: 84, flex: "none", borderRadius: 999, background: Z[700], color: Z[100], display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 36, fontWeight: 700 }}>{n.who[0]}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, color: Z[400] }}>
          <ChatGlyph size={22} color={Z[400]} />
          <span style={{ fontWeight: 600 }}>Grup CS</span>
          <span>· {time}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 31, fontWeight: 700, color: Z[50], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {n.who}: <span style={{ fontWeight: 450, color: Z[300] }}>{n.msg}</span>
        </div>
      </div>
      <span style={{ flex: "none", minWidth: 58, height: 46, padding: "0 12px", boxSizing: "border-box", borderRadius: 999, background: RED, color: "#fff", fontSize: 25, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{unread >= 99 ? "99+" : unread}</span>
    </div>
  );
}

/** lencana merah status Menunggu (teks kolom Penyelesaian asli) */
export function WaitTag({ size = 30, children = "belum ada respons" }: { size?: number; children?: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.3, borderRadius: 999, padding: `${size * 0.25}px ${size * 0.7}px`, fontFamily: FONT, fontSize: size, fontWeight: 700, color: "#fca5a5", background: rgba(RED, 0.16), border: `1px solid ${rgba(RED, 0.4)}`, whiteSpace: "nowrap" }}>
      <Icon name="clock" size={size * 0.95} color="#fca5a5" />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------
// Chip UI asli untuk serpihan outro (components/Badges.tsx + lib/constants.ts STATUSES, UserAvatar)
// ---------------------------------------------------------------------------------------------
const STATUS_TONE: Record<string, [string, string]> = {
  Open: ["#7dd3fc", "#0ea5e9"],
  "In Progress": ["#fcd34d", "#f59e0b"],
  Resolved: ["#6ee7b7", "#10b981"],
};

/** StatusBadge: bg-*-500/15 text-*-300 ring-*-500/30 */
export function StatusChip({ label, size = 30 }: { label: "Open" | "In Progress" | "Resolved"; size?: number }) {
  const [fg, c] = STATUS_TONE[label];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: `${size * 0.22 - 2}px ${size * 0.62 - 2}px`, fontFamily: FONT, fontSize: size, fontWeight: 650, color: fg, background: mix("#121214", c, 0.15), border: `2px solid ${rgba(c, 0.32)}`, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

/** HotBadge: bg-red-600/20 text-red-300 ring-red-500/40, "🔥 HOT" (ikon api, bukan emoji) */
export function HotChip({ size = 32 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.2, borderRadius: 999, padding: `${size * 0.22 - 2}px ${size * 0.6 - 2}px`, fontFamily: FONT, fontSize: size, fontWeight: 800, color: "#fca5a5", background: mix("#160b0b", "#dc2626", 0.2), border: `2px solid ${rgba(RED, 0.4)}`, whiteSpace: "nowrap", letterSpacing: "0.02em" }}>
      <Icon name="flame" size={size * 0.95} color="#fca5a5" />
      HOT
    </span>
  );
}

/** UserAvatar: inisial di zinc-800 (akun sendiri oranye) */
export function InitialAvatar({ name, size = 84, me }: { name: string; size?: number; me?: boolean }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: me ? "#3a2312" : Z[800], color: me ? "#fb923c" : Z[100], fontFamily: FONT, fontSize: size * 0.42, fontWeight: 750, boxSizing: "border-box", border: `2px solid ${rgba(me ? "#f97316" : Z[600], 0.45)}` }}>
      {name[0]}
    </span>
  );
}
