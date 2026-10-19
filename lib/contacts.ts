export const CONTACT_TYPES = {
  phone: { label: "No. HP / WA", short: "WA", placeholder: "0812xxxx / +62812xxxx" },
  instagram: { label: "Instagram", short: "IG", placeholder: "@username atau link profil" },
  discord: { label: "Discord", short: "DC", placeholder: "username discord" },
  email: { label: "Email", short: "Email", placeholder: "nama@email.com" },
} as const;

export type ContactType = keyof typeof CONTACT_TYPES;

export function isContactType(t: string): t is ContactType {
  return t in CONTACT_TYPES;
}

// HARUS sama dengan public.normalize_contact() di schema.sql
export function normalizeContact(type: ContactType, value: string): string {
  let v = (value ?? "").trim().toLowerCase();
  if (type === "phone") {
    v = v.replace(/[^0-9]/g, "");
    if (v.startsWith("0")) v = "62" + v.slice(1);
    else if (v.startsWith("8")) v = "62" + v;
  } else if (type === "instagram") {
    v = v.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//, "");
    v = v.replace(/[/?#].*$/, "");
    v = v.replace(/^@+/, "");
  } else if (type === "discord") {
    v = v.replace(/^@+/, "").replace(/#0$/, "");
  }
  return v;
}

export function displayContact(type: ContactType, normalized: string): string {
  if (type === "phone") return "+" + normalized;
  if (type === "instagram") return "@" + normalized;
  return normalized;
}

export function contactLink(type: ContactType, normalized: string): string | null {
  if (type === "phone") return `https://wa.me/${normalized}`;
  if (type === "instagram") return `https://instagram.com/${normalized}`;
  if (type === "email") return `mailto:${normalized}`;
  return null;
}

/** Tebak tipe kontak dari input bebas di kolom pencarian */
export function guessContactType(q: string): ContactType {
  const s = q.trim();
  if (/@.+\..+/.test(s) && !s.startsWith("@")) return "email";
  if (/instagram\.com/i.test(s)) return "instagram";
  if (/^\+?[\d\s\-()]{7,}$/.test(s)) return "phone";
  return "instagram";
}
