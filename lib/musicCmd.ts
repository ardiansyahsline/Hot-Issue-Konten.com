/** 🎵 Perintah musik dari chat AI: AI menulis blok ```music {...}``` -> pemutar di nav menjalankannya. */
export type MusicCmd = {
  source?: "youtube" | "ai";
  action?: "play" | "pause" | "stop";
  /** youtube: judul / artis / genre yang dicari */
  query?: string;
  /** youtube: top 10 trending */
  top?: "id" | "global";
  /** youtube: link langsung */
  url?: string;
  /** musik AI: gaya bawaan */
  preset?: string;
  /** musik AI: deskripsi bebas (bahasa Inggris) */
  prompt?: string;
  bpm?: number;
  /** buka panel pemutar */
  open?: boolean;
};

export const MUSIC_PRESET_IDS = ["piano", "strings", "focus", "guitar", "nylon", "lofi"] as const;

export const MUSIC_INTENT =
  /\b(putar|puterin|puter|putarin|setel|setelin|nyalain|nyalakan|mainkan|mainin|play|stop|stopin|matiin|matikan|pause|jeda|ganti|lanjut(?:in|kan)?)\b[\s\S]{0,50}\b(musik(?:nya)?|music|lagu(?:nya)?|song|playlist|youtube|yt|piano|gitar|lofi|lo-fi|instrumental)\b|\b(musik|lagu|song)\b[\s\S]{0,30}\b(dong|donk|yuk|trending|santai|buat kerja)\b/i;

export const MUSIC_RULES = `🎵 PEMUTAR MUSIK WEBSITE (kamu BISA memutar musik untuk user)
Website punya pemutar musik di menu 🎵: (1) YouTube / YouTube Music (lagu apa saja, ada vokal), (2) Musik AI (instrumental yang dibuat langsung).
Kalau user minta memutar / mengganti / menjeda / mematikan musik, jawab 1 kalimat singkat yang hangat (mis. "Siap, aku puterin ... ya 🎶"), lalu WAJIB tambahkan tepat satu blok di akhir jawaban:
\`\`\`music
{"source":"youtube","query":"Tulus Hati-Hati di Jalan"}
\`\`\`
Bentuk yang boleh:
- Lagu / artis / genre / mood tertentu, atau "lagu" biasa → {"source":"youtube","query":"<kata kunci pencarian YouTube yang pas>"}
- Lagu trending / hits / viral → {"source":"youtube","top":"id"} (Indonesia) atau {"source":"youtube","top":"global"}
- User kasih link YouTube → {"source":"youtube","url":"<link>"}
- Musik AI / instrumental / "bikinin musik" / musik fokus kerja tanpa lirik → {"source":"ai","preset":"piano|strings|focus|guitar|nylon|lofi"} atau {"source":"ai","prompt":"<deskripsi musik dalam bahasa Inggris, instrumental>","bpm":<60-160 opsional>}
- Jeda → {"action":"pause"} · Matikan → {"action":"stop"} · Lanjutkan → {"action":"play"}
Jangan bilang tidak bisa memutar musik. Jangan menulis link atau daftar lagu karangan sendiri. Blok \`music\` tidak ditampilkan ke user.`;

export function splitMusic(text: string): { text: string; cmd: MusicCmd | null; partial: boolean } {
  const m = text.match(/```music\s*\n?([\s\S]*?)```/);
  if (!m) {
    const i = text.indexOf("```music");
    return i >= 0 ? { text: text.slice(0, i).trimEnd(), cmd: null, partial: true } : { text, cmd: null, partial: false };
  }
  let cmd: MusicCmd | null = null;
  try {
    const j = JSON.parse(m[1]) as MusicCmd;
    if (j && typeof j === "object") cmd = j;
  } catch {}
  return { text: (text.slice(0, m.index) + text.slice(m.index! + m[0].length)).trim(), cmd, partial: false };
}

export const playMusic = (cmd: MusicCmd) => window.dispatchEvent(new CustomEvent<MusicCmd>("cs-music", { detail: cmd }));

export function musicLabel(c: MusicCmd): string {
  if (c.action === "pause") return "⏸ Musik dijeda";
  if (c.action === "stop") return "⏹ Musik dimatikan";
  if (c.source === "ai") return `✨ Musik AI · ${c.prompt || c.preset || "santai"}`;
  if (c.top) return `🔥 Top 10 trending ${c.top === "id" ? "Indonesia" : "Global"}`;
  if (c.url) return "▶ Lagu dari link YouTube";
  if (c.query) return `▶ ${c.query}`;
  return "🎵 Musik";
}
