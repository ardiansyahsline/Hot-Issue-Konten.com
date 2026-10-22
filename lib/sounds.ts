// Bunyi notifikasi — dibuat langsung di browser (Web Audio), tanpa file audio
export const SOUNDS = {
  ding: "Ding",
  pop: "Pop",
  chime: "Chime",
  bell: "Bell",
  tritone: "Tri-tone",
  alarm: "Alarm",
  off: "Tanpa bunyi",
} as const;
export type SoundName = keyof typeof SOUNDS;
export type SoundKind = "chat" | "mention" | "issue";

export type SoundPrefs = {
  sound_on: boolean;
  sound_chat: SoundName;
  sound_mention: SoundName;
  sound_issue: SoundName;
  sound_volume: number; // 0-100
};
export const DEFAULT_SOUND: SoundPrefs = {
  sound_on: true,
  sound_chat: "pop",
  sound_mention: "tritone",
  sound_issue: "alarm",
  sound_volume: 70,
};
export const isSound = (s: unknown): s is SoundName => typeof s === "string" && s in SOUNDS;

export function normalizeSoundPrefs(p: Partial<Record<keyof SoundPrefs, unknown>> | null | undefined): SoundPrefs {
  const v = Number(p?.sound_volume);
  return {
    sound_on: p?.sound_on === undefined || p?.sound_on === null ? DEFAULT_SOUND.sound_on : !!p.sound_on,
    sound_chat: isSound(p?.sound_chat) ? p.sound_chat : DEFAULT_SOUND.sound_chat,
    sound_mention: isSound(p?.sound_mention) ? p.sound_mention : DEFAULT_SOUND.sound_mention,
    sound_issue: isSound(p?.sound_issue) ? p.sound_issue : DEFAULT_SOUND.sound_issue,
    sound_volume: Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : DEFAULT_SOUND.sound_volume,
  };
}

let ctx: AudioContext | null = null;

/** AudioContext dibuat/diaktifkan setelah ada klik / ketik (aturan browser) */
export function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}
export const audioReady = () => !!ctx && ctx.state === "running";

type Note = { f: number; t: number; d: number; type?: OscillatorType; g?: number; to?: number };

const PATTERNS: Record<Exclude<SoundName, "off">, Note[]> = {
  ding: [
    { f: 1318.5, t: 0, d: 0.7, g: 0.9 },
    { f: 2637, t: 0, d: 0.35, g: 0.15 },
  ],
  pop: [{ f: 420, to: 920, t: 0, d: 0.14, type: "sine", g: 1 }],
  chime: [
    { f: 784, t: 0, d: 0.45, g: 0.8 },
    { f: 1174.7, t: 0.13, d: 0.6, g: 0.8 },
  ],
  bell: [
    { f: 660, t: 0, d: 1.3, g: 0.8 },
    { f: 1320, t: 0, d: 0.9, g: 0.35 },
    { f: 1980, t: 0, d: 0.6, g: 0.18 },
  ],
  tritone: [
    { f: 1046.5, t: 0, d: 0.22, type: "triangle", g: 0.9 },
    { f: 1318.5, t: 0.11, d: 0.22, type: "triangle", g: 0.9 },
    { f: 1568, t: 0.22, d: 0.35, type: "triangle", g: 0.9 },
  ],
  alarm: [
    { f: 880, t: 0, d: 0.12, type: "square", g: 0.35 },
    { f: 660, t: 0.15, d: 0.12, type: "square", g: 0.35 },
    { f: 880, t: 0.3, d: 0.12, type: "square", g: 0.35 },
    { f: 660, t: 0.45, d: 0.16, type: "square", g: 0.35 },
  ],
};

/** Putar bunyi. Mengembalikan true kalau benar-benar diputar. */
export function playSound(name: SoundName, volume = 70): boolean {
  if (name === "off" || volume <= 0) return false;
  const ac = audio();
  if (!ac) return false;
  if (ac.state !== "running") {
    ac.resume().catch(() => {});
    if ((ac.state as string) !== "running") return false;
  }
  const master = ac.createGain();
  master.gain.value = Math.pow(volume / 100, 1.6) * 0.5;
  master.connect(ac.destination);
  const now = ac.currentTime + 0.02;
  for (const n of PATTERNS[name]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = n.type ?? "sine";
    o.frequency.setValueAtTime(n.f, now + n.t);
    if (n.to) o.frequency.exponentialRampToValueAtTime(n.to, now + n.t + n.d * 0.5);
    g.gain.setValueAtTime(0.0001, now + n.t);
    g.gain.exponentialRampToValueAtTime(n.g ?? 0.8, now + n.t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + n.t + n.d);
    o.connect(g).connect(master);
    o.start(now + n.t);
    o.stop(now + n.t + n.d + 0.05);
  }
  return true;
}

// ---- satu "pengatur" bunyi untuk seluruh halaman (supaya tidak dobel) ----
let prefs: SoundPrefs = DEFAULT_SOUND;
const last: Record<"chat" | "issue", number> = { chat: 0, issue: 0 };
const GAP = 8000; // bunyi jenis yang sama paling cepat tiap 8 detik

export function setSoundPrefs(p: SoundPrefs) {
  prefs = p;
}
export function getSoundPrefs() {
  return prefs;
}

/**
 * Minta bunyi untuk notifikasi jenis tertentu.
 * Mengembalikan true kalau bunyi sudah ditangani aplikasi (diputar sekarang / baru saja diputar),
 * supaya notifikasi sistem tidak ikut berbunyi.
 */
export function notifySound(kind: SoundKind): boolean {
  if (!prefs.sound_on) return true; // bunyi dimatikan: pop-up sistem juga tanpa bunyi
  const group = kind === "issue" ? "issue" : "chat";
  const now = Date.now();
  if (now - last[group] < GAP) return true;
  const name = kind === "chat" ? prefs.sound_chat : kind === "mention" ? prefs.sound_mention : prefs.sound_issue;
  if (name === "off") return true;
  const ok = playSound(name, prefs.sound_volume);
  if (ok) last[group] = now;
  return ok;
}
