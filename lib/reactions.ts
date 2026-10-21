// Reaksi emoji — dipakai di Hot Issue, Catatan & Saran, dan Chat
export const QUICK_EMOJI = ["👍", "❤️", "😂", "😮", "🙏", "🔥", "✅", "👀"] as const;

export const EMOJI_GROUPS: [string, string[]][] = [
  ["Sering dipakai", ["👍", "🙏", "✅", "🔥", "😂", "❤️", "👀", "💯", "🙌", "👏", "🎉", "🫡"]],
  [
    "Wajah",
    ["😀", "😁", "😄", "😅", "🤣", "😊", "🙂", "😉", "😍", "🥰", "😘", "🤗", "🤔", "🤨", "😐", "😶", "🙄", "😏", "😮", "😯", "😲", "😳", "🥺", "😢", "😭", "😤", "😡", "🤯", "😱", "😴", "🥲", "🙃", "😎", "🤓", "😇", "🤐", "🤫", "🫠", "😵", "🤒"],
  ],
  [
    "Tangan",
    ["👍", "👎", "👌", "🤌", "✌️", "🤞", "🤙", "👋", "🙌", "👏", "🤝", "🙏", "💪", "☝️", "👆", "👇", "👉", "👈", "✍️", "🫶"],
  ],
  [
    "Kerja & status",
    ["✅", "☑️", "❌", "⚠️", "❗", "❓", "⏳", "⌛", "⏰", "📌", "📎", "📝", "📊", "📈", "📉", "💸", "💰", "🧾", "📞", "💬", "📣", "🔔", "🔒", "🔑", "🛠️", "🐞", "🚀", "🎯", "🏆", "🎉"],
  ],
  ["Simbol", ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "💔", "💯", "🔥", "✨", "⭐", "🌟", "💡", "🟢", "🟡", "🔴", "🔵", "⬆️", "⬇️", "➡️", "🔁", "🆗"]],
];

export type ReactionKind = "issue" | "issue_note" | "suggestion" | "suggestion_comment" | "chat_message";
export type ReactionTarget = { kind: ReactionKind; id: number };

export const REACTION_COLUMN = {
  issue: "issue_id",
  issue_note: "issue_note_id",
  suggestion: "suggestion_id",
  suggestion_comment: "suggestion_comment_id",
  chat_message: "chat_message_id",
} as const;

export type ReactionRow = { emoji: string; user_id: string };
export type ReactionSummary = { emoji: string; count: number; mine: boolean; names: string[] };

/** emoji tunggal (boleh dengan modifier / gabungan), bukan teks biasa */
export const isEmoji = (s: string) => s.length > 0 && s.length <= 16 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) && !/[a-z0-9<>]/i.test(s);

/** gabungkan baris reaksi jadi ringkasan per emoji (urutan sesuai yang pertama diberikan) */
export function summarize(rows: ReactionRow[] | null | undefined, meId: string, names?: Map<string, string>): ReactionSummary[] {
  const map = new Map<string, ReactionSummary>();
  for (const r of rows ?? []) {
    const s = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    s.count += 1;
    if (r.user_id === meId) s.mine = true;
    const n = r.user_id === meId ? "Kamu" : names?.get(r.user_id);
    if (n) s.names.push(n);
    map.set(r.emoji, s);
  }
  return [...map.values()];
}

/** "Alif, Fatir & 2 lainnya" */
export function whoText(names: string[], total: number) {
  if (!total) return "";
  const shown = names.slice(0, 3);
  const rest = total - shown.length;
  if (!shown.length) return `${total} orang`;
  if (rest > 0) return `${shown.join(", ")} & ${rest} lainnya`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} & ${shown.at(-1)}` : shown[0];
}
