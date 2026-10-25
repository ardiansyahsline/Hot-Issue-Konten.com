"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SMART_HERO } from "@/lib/aiModels";
import { CHIBI_HAIRS, CHIBI_PROPS, CHIBI_SKINS, GROUPS, MBTI_TYPES, isBuiltinHero, registerCustom, typeGroup, typeInfo, type Prop } from "@/lib/aiPersona";
import { registerChar, summarize, type CharAvatar, type CharProfile, type CustomChar } from "@/lib/customChar";
import { CUSTOM_ROLE, QUIZ, QUIZ_QS, ROLES, compileSop, roleOf, scoreQuiz, typeProfile, type RoleQ, type Training } from "@/lib/trainAi";
import HeroArt from "./HeroArt";
import TypeScene from "./TypeScene";

const PROP_LABEL: Record<Prop, string> = {
  orb: "Bola sihir",
  staff: "Tongkat",
  bow: "Busur",
  sword: "Pedang",
  dagger: "Belati",
  shield: "Perisai",
  gun: "Pistol",
  umbrella: "Payung",
  spear: "Tombak",
  fist: "Tinju",
};
const PREVIEW = "__karakter_draft__";
const CALLS = ["kak (sopan & akrab)", "bro / sis (santai)", "langsung nama user", "Bapak / Ibu (formal)"];
const EMOJIS = ["sedikit emoji, bahasa santai", "banyak emoji, bahasa gaul yang sopan", "tanpa emoji, bahasa baku"];

/** potong gambar jadi persegi (tengah), kecilkan ke 256px, simpan sebagai JPEG data URL (maks ±200 KB) */
async function toAvatar(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
  for (const q of [0.86, 0.72, 0.55]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length < 200_000) return url;
  }
  return c.toDataURL("image/jpeg", 0.4);
}

type Page = { k: "intro" } | { k: "quiz"; i: number } | { k: "result" } | { k: "role" } | { k: "train"; i: number } | { k: "identity" } | { k: "summary" };
type Summary = { label: string; role: string; style: string; catchphrase: string; rules: string[]; sop: string };
/** patokan ringkasan otomatis + peran (dan nama peran custom) yang dipakai saat membuatnya */
type Gen = { sum: Summary; roleId: string; roleName: string };
type RoleFields = Pick<Summary, "role" | "rules" | "sop">;
const roleFields = (x: Summary): RoleFields => ({ role: x.role, rules: x.rules, sop: x.sop });
const isRoleField = (k: keyof Summary): k is keyof RoleFields => k === "role" || k === "rules" || k === "sop";
const nameKey = (id: string | undefined, custom: string | undefined) => (id === CUSTOM_ROLE ? (custom ?? "").trim().toLowerCase() : "");
/** pembanding kolom ringkasan (baris kosong / spasi diabaikan) */
const norm = (v: string | string[]) => JSON.stringify(Array.isArray(v) ? v.map((x) => x.trim()).filter(Boolean) : v.trim());

const btnGhost = "rounded-xl border border-zinc-800 px-3.5 py-2 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-600";
const label = "text-[11px] font-bold uppercase tracking-wider text-zinc-500";
/** label baris ringkasan: di HP di atas kolom (kolom selebar layar), di layar lebar di kiri */
const rowLabel = `${label} pt-1.5 sm:pt-0`;
const rowLabelTop = `${label} pt-1.5 sm:self-start sm:pt-2`;

/** teks bantu pertanyaan training (tanpa kalimat "boleh pilih…" yang dobel) */
function hintText(q: RoleQ): string {
  const base = q.multi ? "Boleh pilih lebih dari satu." : "Pilih satu.";
  const h = (q.hint ?? "").replace(/^boleh pilih lebih dari satu[.;]?\s*/i, "").trim();
  if (!h) return base;
  if (/lebih dari satu/i.test(h) || (!q.multi && /^pilih/i.test(h))) return h;
  return `${base} ${h[0].toUpperCase()}${h.slice(1)}`;
}

/**
 * "Train your AI": kuis kepribadian → hasil tipe (animasi) → pilih peran → pertanyaan training per peran →
 * nama & tampilan → ringkasan (bisa diedit) → simpan. Karakter bersifat pribadi (hanya pembuatnya yang bisa lihat & pakai).
 */
export default function CharacterWizard({
  initial,
  taken,
  onClose,
  onSaved,
}: {
  initial?: CustomChar | null;
  /** nama karakter buatanmu yang sudah ada (tidak boleh kembar) */
  taken: string[];
  onClose: () => void;
  onSaved: (c: CustomChar) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const ip = initial?.profile;
  const v2 = ip?.version === 2;
  const [quiz, setQuiz] = useState<Record<string, number>>(v2 ? (ip?.quiz ?? {}) : {});
  const [typeOverride, setTypeOverride] = useState<string>(initial?.mbti ?? "");
  const [roleId, setRoleId] = useState<string>(v2 ? (ip?.roleId ?? "") : "");
  const [customRole, setCustomRole] = useState(v2 ? (ip?.roleName ?? "") : "");
  const [training, setTraining] = useState<Training>(v2 && ip?.training ? ip.training : { picks: {}, other: {} });
  const [name, setName] = useState(initial?.name ?? "");
  const [tab, setTab] = useState<"image" | "chibi">(initial?.avatar.kind === "image" ? "image" : "chibi");
  const [chibi, setChibi] = useState(initial?.avatar.kind === "chibi" ? initial.avatar : { kind: "chibi" as const, hair: 3, skin: CHIBI_SKINS[0], hc: CHIBI_HAIRS[1], prop: "orb" as Prop });
  const [img, setImg] = useState<string | null>(initial?.avatar.kind === "image" ? initial.avatar.data : null);
  // karakter versi lama: pakai jawaban "cara memanggil" & "emoji" lamanya kalau cocok dengan pilihan yang ada
  const v1Ans = (k: string) => {
    const a = ip?.answers?.[k];
    return typeof a === "string" ? a : "";
  };
  // isian bebas lama (mis. "Bos") dipakai apa adanya & muncul sebagai chip tambahan
  const seedCall = ip?.call ?? (v1Ans("call") || CALLS[0]);
  const seedEmoji = ip?.emoji ?? (v1Ans("emoji") || EMOJIS[0]);
  const callChips = CALLS.includes(seedCall) ? CALLS : [...CALLS, seedCall];
  const emojiChips = EMOJIS.includes(seedEmoji) ? EMOJIS : [...EMOJIS, seedEmoji];
  const [call, setCall] = useState(seedCall);
  const [emoji, setEmoji] = useState(seedEmoji);
  const [sum, setSum] = useState<Summary | null>(
    initial
      ? { label: ip?.label ?? "", role: ip?.role ?? "", style: ip?.style ?? "", catchphrase: ip?.catchphrase ?? "", rules: ip?.rules ?? [], sop: ip?.sop ?? "" }
      : null
  );
  const [dirty, setDirty] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  /** jawaban training per peran: ganti peran lalu kembali -> jawaban lama muncul lagi */
  const trainCache = useRef<Record<string, Training>>({});
  /** peran bawaan terakhir — kolom "peran lain" dikosongkan lagi -> kembali ke peran ini */
  const lastPreset = useRef(roleId && roleId !== CUSTOM_ROLE ? roleId : "");
  /** ringkasan otomatis terakhir — kolom yang sudah diedit user (beda dari versi otomatis) tidak ditimpa saat ringkasan dibuat ulang */
  const genRef = useRef<Gen | null | undefined>(undefined);
  /** suntingan Peran/Larangan/SOP per peran — ganti peran lalu kembali -> suntingan untuk peran itu muncul lagi */
  const sumCache = useRef<Record<string, { s: RoleFields; base: RoleFields; roleName: string }>>({});
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const role = roleOf(roleId, customRole);
  const pages: Page[] = useMemo(
    () => [
      { k: "intro" },
      ...QUIZ_QS.map((_, i) => ({ k: "quiz" as const, i })),
      { k: "result" },
      { k: "role" },
      ...(role?.questions ?? []).map((_, i) => ({ k: "train" as const, i })),
      { k: "identity" },
      { k: "summary" },
    ],
    [role]
  );
  // edit karakter hasil Train your AI -> langsung ke ringkasan
  const [step, setStep] = useState(() => (initial && v2 ? 1 + QUIZ_QS.length + 2 + (roleOf(ip?.roleId, ip?.roleName ?? "")?.questions.length ?? 0) + 1 : 0));
  const page = pages[Math.min(step, pages.length - 1)];
  const go = (k: Page["k"]) => setStep(Math.max(0, pages.findIndex((p) => p.k === k)));

  const scored = scoreQuiz(quiz);
  const quizType = scored.complete ? scored.type : "";
  // kuis belum lengkap (mis. habis "Ulangi kuis") -> tetap pakai tipe yang tersimpan, bukan tipe asal
  const storedType = initial && MBTI_TYPES.includes(initial.mbti) ? initial.mbti : "";
  const type = MBTI_TYPES.includes(typeOverride) ? typeOverride : quizType || storedType || "INFJ";
  const typeKnown = scored.complete || MBTI_TYPES.includes(typeOverride);
  const prof = typeProfile(type);

  const nm = name.trim();
  const nameErr = !nm
    ? "Isi nama dulu ya."
    : nm.length > 40
      ? "Maksimal 40 huruf."
      : isBuiltinHero(nm) || nm.toLowerCase() === SMART_HERO.toLowerCase()
        ? "Nama ini sudah dipakai hero bawaan — pilih nama lain."
        : taken.some((t) => t.toLowerCase() === nm.toLowerCase() && t !== initial?.name)
          ? "Kamu sudah punya karakter dengan nama ini."
          : null;

  const curAvatar: CharAvatar = tab === "image" && img ? { kind: "image", data: img } : chibi;
  registerCustom(PREVIEW, { type, hair: chibi.hair, skin: chibi.skin, hc: chibi.hc, prop: chibi.prop, img: curAvatar.kind === "image" ? curAvatar.data : undefined });
  const g = GROUPS[typeGroup(type)];
  const av = (size: number) => <HeroArt hero={PREVIEW} size={size} title={nm || "AI-mu"} />;

  /** maju otomatis ke halaman berikutnya (klik dobel tidak melompati pertanyaan) */
  const advanceFrom = (from: number, ms: number) => setTimeout(() => setStep((s) => (s === from ? from + 1 : s)), ms);
  const answerQuiz = (qid: string, i: number) => {
    // ketuk ulang jawaban yang sama = lanjut saja (tipe yang dipilih manual tidak dibatalkan)
    if (quiz[qid] !== i) {
      setQuiz((a) => ({ ...a, [qid]: i }));
      setTypeOverride("");
      setDirty(true);
    }
    advanceFrom(step, 160);
  };
  const pick = (qid: string, lab: string, multi: boolean) => {
    setTraining((t) => {
      const cur = t.picks[qid] ?? [];
      const nextPicks = multi ? (cur.includes(lab) ? cur.filter((x) => x !== lab) : [...cur, lab]) : [lab];
      return { picks: { ...t.picks, [qid]: nextPicks }, other: multi ? t.other : { ...t.other, [qid]: "" } };
    });
    setDirty(true);
    if (!multi) advanceFrom(step, 180);
  };
  /** ganti peran -> pertanyaan training ikut ganti; jawaban peran lama disimpan dulu (kalau balik, muncul lagi) */
  const chooseRole = (id: string) => {
    if (id !== roleId) {
      if (roleId) trainCache.current[roleId] = training;
      if (roleId && roleId !== CUSTOM_ROLE) lastPreset.current = roleId;
      setTraining(trainCache.current[id] ?? { picks: {}, other: {} });
    }
    setRoleId(id);
    setDirty(true);
    setErr(null);
  };
  /** karakter lama: ubah nama & tampilan saja -> lepas peran yang mungkin sempat dipilih, tipe kembali ke tipe tersimpan */
  const quickEdit = () => {
    if (roleId) {
      trainCache.current[roleId] = training;
      if (roleId !== CUSTOM_ROLE) lastPreset.current = roleId;
      setRoleId("");
      setTraining({ picks: {}, other: {} });
      setDirty(true);
    }
    if (initial) setTypeOverride(initial.mbti);
    setErr(null);
    setStep(1 + QUIZ_QS.length + 2); // halaman nama & tampilan (tanpa halaman latihan)
  };
  /** semua pertanyaan latihan wajib (pilih satu) sudah dijawab */
  const trainingDone = !!role && role.questions.every((q) => q.multi || (training.picks[q.id]?.length ?? 0) > 0 || !!training.other[q.id]?.trim());
  const setOther = (qid: string, v: string) => {
    setTraining((t) => ({ picks: t.picks, other: { ...t.other, [qid]: v } }));
    setDirty(true);
  };

  /** jawaban karakter lama + chip yang benar-benar diganti (isian bebas lama tidak tertimpa nilai bawaan chip) */
  const v1Answers = (): CharProfile["answers"] => ({ ...(ip?.answers ?? {}), ...(call !== seedCall ? { call } : {}), ...(emoji !== seedEmoji ? { emoji } : {}) });
  const buildSummary = (): Summary => {
    const r = role;
    const larangan = r?.questions.filter((q) => q.topic === "larangan").flatMap((q) => training.picks[q.id] ?? []) ?? [];
    return {
      label: typeInfo(type).label,
      // belum pilih peran (edit cepat karakter lama) -> peran, larangan & SOP lama dipertahankan
      role: r ? `${r.name} — ${r.mission}` : sum?.role || "Asisten serba bisa",
      // karakter lama tanpa latih ulang: gaya dibuat dengan rumus lamanya (energi, saat user panik, panjang jawaban tetap ada)
      style: r || v2 || !initial ? `Panggil user: ${call}; ${emoji}` : summarize(nm || initial.name, v1Answers(), type).style,
      catchphrase: sum?.catchphrase ?? "",
      rules: r ? larangan : (sum?.rules ?? []),
      sop: r ? compileSop(r, training) : (sum?.sop ?? ""),
    };
  };
  // patokan "versi otomatis" (kolom yang beda dari patokan = diedit manual): karakter Train your AI = ringkasan otomatis yang
  // ikut tersimpan (gen); karakter lama = hasil rumus lamanya dari jawaban tersimpan
  if (genRef.current === undefined)
    genRef.current = !initial
      ? null
      : v2
        ? { sum: ip?.gen ? { ...ip.gen, rules: ip.gen.rules ?? [] } : (sum as Summary), roleId: ip?.roleId ?? "", roleName: nameKey(ip?.roleId, ip?.roleName) }
        : { sum: { ...summarize(initial.name, ip?.answers ?? {}, initial.mbti), sop: "" }, roleId: "", roleName: "" };
  const toSummary = () => {
    if (!typeKnown && !storedType) return go("quiz");
    if (roleId === CUSTOM_ROLE && !customRole.trim()) {
      go("role");
      return setErr("Tulis nama perannya dulu.");
    }
    if (dirty || !sum) {
      const fresh = buildSummary();
      const rn = nameKey(roleId, customRole);
      const base = genRef.current;
      // peran diganti -> peran, larangan & SOP ikut peran baru (suntingan peran lama disimpan, tidak terbawa);
      // kembali ke peran yang pernah disunting -> suntingannya dipakai lagi.
      // nama peran custom diganti -> hanya teks Peran yang ikut (pertanyaan & SOP-nya sama)
      const idChanged = !!base && base.roleId !== roleId;
      const nameChanged = !!base && !idChanged && base.roleName !== rn;
      const cached = idChanged ? sumCache.current[roleId] : undefined;
      if (sum && base && idChanged) sumCache.current[base.roleId] = { s: roleFields(sum), base: roleFields(base.sum), roleName: base.roleName };
      setSum((s) => {
        if (!s || !base) return fresh;
        const out: Summary = { ...fresh };
        for (const k of Object.keys(fresh) as (keyof Summary)[]) {
          if (idChanged && isRoleField(k)) {
            if (cached && !(k === "role" && cached.roleName !== rn) && norm(cached.s[k]) !== norm(cached.base[k])) Object.assign(out, { [k]: cached.s[k] });
            continue;
          }
          if (nameChanged && k === "role") continue;
          if (norm(s[k]) !== norm(base.sum[k])) Object.assign(out, { [k]: s[k] });
        }
        return out;
      });
      genRef.current = { sum: fresh, roleId, roleName: rn };
      setDirty(false);
    }
    go("summary");
  };

  const next = () => {
    if (page.k === "identity") {
      if (nameErr) return setErr(nameErr);
      if (tab === "image" && !img) return setErr("Upload gambar dulu, atau pilih tab Racik chibi.");
      setErr(null);
      return toSummary();
    }
    if (page.k === "role" && !role) return setErr("Pilih peran dulu ya.");
    if (page.k === "role" && roleId === CUSTOM_ROLE && !customRole.trim()) return setErr("Tulis nama perannya dulu.");
    setErr(null);
    setStep((s) => Math.min(pages.length - 1, s + 1));
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setErr("File harus gambar (JPG / PNG / WEBP).");
    if (f.size > 8 * 1024 * 1024) return setErr("Gambar maksimal 8 MB.");
    setErr(null);
    setImgBusy(true);
    try {
      setImg(await toAvatar(f));
      setTab("image");
    } catch {
      setErr("Gambar gagal dibaca — coba file lain.");
    } finally {
      setImgBusy(false);
    }
  };

  const save = async () => {
    if (!sum) return;
    if (nameErr) {
      go("identity");
      return setErr(nameErr);
    }
    setSaving(true);
    setErr(null);
    const edited = {
      label: sum.label.trim(),
      role: sum.role.trim(),
      style: sum.style.trim(),
      catchphrase: sum.catchphrase.trim(),
      rules: sum.rules.map((r) => r.trim()).filter(Boolean),
    };
    // karakter lama yang hanya diubah nama/tampilan (belum dilatih ulang) tetap versi lama — jawaban lamanya tidak hilang
    const profile: CharProfile = initial && !v2 && !role ? { ...initial.profile, ...edited, answers: v1Answers() } : {
      version: 2,
      answers: {},
      quiz,
      roleId: roleId || undefined,
      roleName: roleId === CUSTOM_ROLE ? customRole.trim() : undefined,
      roleLabel: role?.name,
      training,
      call,
      emoji,
      ...edited,
      sop: sum.sop.trim(),
      gen: genRef.current?.sum,
    };
    const row = { name: nm, mbti: type, avatar: curAvatar, profile };
    const sel = "id, name, mbti, avatar, profile, created_at";
    const r = initial
      ? await supabase.from("ai_characters").update({ ...row, updated_at: new Date().toISOString() }).eq("id", initial.id).select(sel).single()
      : await supabase.from("ai_characters").insert(row).select(sel).single();
    setSaving(false);
    if (r.error || !r.data) {
      const m = r.error?.message ?? "Gagal menyimpan";
      return setErr(/ai_characters|schema cache|does not exist/i.test(m) ? "Fitur karakter belum aktif — admin perlu menjalankan supabase/migration-19-karakter-sendiri.sql." : m);
    }
    const c = r.data as CustomChar;
    registerChar(c);
    onSaved(c);
  };

  // fokus masuk ke dialog saat dibuka, kembali ke tombol pemicu saat ditutup
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus({ preventScroll: true });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);
  // pindah halaman: gulir ke atas; tombol yang tadi diklik hilang -> fokus dipindah ke isi halaman baru (keyboard tidak "nyasar")
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = 0;
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) body.focus({ preventScroll: true });
  }, [step]);

  /* ---------- tampilan per halaman ---------- */
  const qq = page.k === "quiz" ? QUIZ_QS[page.i] : null;
  const tq = page.k === "train" && role ? role.questions[page.i] : null;
  const stage = page.k === "intro" ? 0 : page.k === "quiz" || page.k === "result" ? 1 : page.k === "role" || page.k === "train" ? 2 : 3;
  const STAGES = ["Mulai", "Kenali kepribadianmu", "Latih perannya", "Nama & simpan"];
  const canNext = page.k === "quiz" ? quiz[qq!.id] !== undefined : page.k === "train" ? tq!.multi || (training.picks[tq!.id]?.length ?? 0) > 0 || !!training.other[tq!.id]?.trim() : page.k === "identity" ? !nameErr && !imgBusy : true;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Train your AI">
      <div ref={panelRef} tabIndex={-1} className="flex max-h-[92dvh] w-full max-w-[540px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 outline-none" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="min-w-0">
            <div className="font-display text-[15px] font-bold">{initial ? `✎ Latih ulang ${initial.name}` : "🧠 Train your AI"}</div>
            <div className="truncate text-[11.5px] text-zinc-500">
              {STAGES[stage]}
              {page.k === "quiz" && ` · ${page.i + 1}/${QUIZ_QS.length}`}
              {page.k === "train" && role && ` · ${page.i + 1}/${role.questions.length}`}
            </div>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="grid grid-cols-4 gap-1 px-4 pt-3">
          {STAGES.map((s, i) => (
            <span key={s} className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <span
                className="block h-full rounded-full bg-orange-500 transition-all"
                style={{
                  width:
                    i < stage
                      ? "100%"
                      : i > stage
                        ? "0%"
                        : page.k === "quiz"
                          ? `${((page.i + 1) / (QUIZ_QS.length + 1)) * 100}%`
                          : page.k === "role"
                            ? `${100 / ((role?.questions.length ?? 10) + 1)}%`
                            : page.k === "train" && role
                              ? `${((page.i + 2) / (role.questions.length + 1)) * 100}%`
                            : page.k === "summary" || page.k === "result"
                              ? "100%"
                              : "40%",
                }}
              />
            </span>
          ))}
        </div>

        <div ref={bodyRef} tabIndex={-1} className="flex-1 overflow-y-auto px-4 py-4 outline-none">
          {page.k === "intro" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="flex h-16 w-16 shrink-0 items-end justify-center rounded-2xl" style={{ background: g.soft }}>
                  {av(60)}
                </span>
                <div>
                  <div className="text-[16px] font-bold leading-snug">Latih AI yang cara mikirnya mirip kamu</div>
                  <div className="text-[12.5px] text-zinc-500">± 5 menit · bisa diulang kapan saja</div>
                </div>
              </div>
              <ol className="space-y-2 text-[13px]">
                {[
                  ["🧩", "Kenali kepribadianmu", `${QUIZ_QS.length} pertanyaan singkat (energi, cara menerima info, cara memutuskan, gaya kerja)`],
                  ["✨", "Lihat hasil tipemu", "tipe MBTI + karakter animasi + penjelasan singkat"],
                  ["🎯", "Pilih peran AI-mu", "Manager, CS, Video Editor, SEO, GEO, Programmer, Product Manager, dll."],
                  ["🧠", "Latih cara berpikirnya", "cara ambil keputusan, prioritas, mindset, hal yang wajib diwaspadai"],
                ].map(([i, t, d]) => (
                  <li key={t} className="flex gap-3 rounded-xl border border-zinc-800 px-3 py-2">
                    <span className="text-[18px]">{i}</span>
                    <span>
                      <b className="block">{t}</b>
                      <span className="text-[12px] text-zinc-500">{d}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {initial && !v2 && (
                <div className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-[12px] text-zinc-400">
                  Karakter ini dibuat dengan versi lama. Jalankan Train your AI sampai selesai untuk menambahkan peran & SOP-nya.{" "}
                  <button type="button" onClick={quickEdit} className="font-semibold text-orange-500 hover:underline">
                    Atau ubah nama & tampilan saja »
                  </button>
                </div>
              )}
              <p className="text-[11px] text-zinc-500">Kuis berdasarkan teori tipe kepribadian 4 dimensi (Extroversion–Introversion, Sensing–Intuition, Thinking–Feeling, Judging–Perceiving). Hasilnya kecenderungan, bukan ukuran kemampuan.</p>
            </div>
          )}

          {qq && (
            <div key={qq.id} className="ts-fade">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider" style={{ color: g.color }}>
                {qq.dimTitle}
              </div>
              <div className="mb-3 text-[15.5px] font-bold leading-snug">{qq.q}</div>
              <div className="space-y-2">
                {qq.options.map((o, i) => {
                  const on = quiz[qq.id] === i;
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => answerQuiz(qq.id, i)}
                      className={`flex w-full items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition ${on ? "border-orange-500 bg-orange-500/10 text-orange-300" : "border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/50"}`}
                      aria-pressed={on}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${on ? "bg-orange-500 text-white" : "border border-zinc-700 text-zinc-500"}`}>{String.fromCharCode(65 + i)}</span>
                      {o.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 text-[11.5px] text-zinc-500">Pilih yang paling sering terjadi, bukan yang paling ideal.</p>
            </div>
          )}

          {page.k === "result" && (
            <div className="space-y-3">
              <TypeScene hero={PREVIEW} type={type} headline={prof?.headline} />
              <div className="text-center">
                <div className="text-[12px] text-zinc-500">Karakter kamu</div>
                <div className="font-display text-[20px] font-black leading-tight">
                  {type} · <span style={{ color: g.color }}>{typeInfo(type).label}</span>
                </div>
              </div>
              {prof && <p className="text-[13px] leading-relaxed text-zinc-300">{prof.desc}</p>}
              {!scored.complete && <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-[12px] text-zinc-500">Kuis belum lengkap — tipe di atas diambil dari karakter tersimpan / pilihanmu.</p>}
              <div className={`space-y-2 rounded-xl border border-zinc-800 p-3 ${scored.complete ? "" : "hidden"}`}>
                {scored.dims.map((d) => {
                  const dim = QUIZ.find((x) => x.dim === d.dim)!;
                  const [la, lb] = dim.letters;
                  return (
                    <div key={d.dim}>
                      <div className="flex justify-between text-[11.5px]">
                        <span className={d.win === la.letter ? "font-bold" : "text-zinc-500"}>
                          {la.letter} · {la.name} {d.pa}%
                        </span>
                        <span className={d.win === lb.letter ? "font-bold" : "text-zinc-500"}>
                          {100 - d.pa}% {lb.name} · {lb.letter}
                        </span>
                      </div>
                      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-zinc-800">
                        <span className="ts-bar h-full rounded-full" style={{ width: `${d.pa}%`, background: g.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              {prof && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-zinc-800 p-3">
                    <div className={label}>💪 Kekuatan</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-zinc-300">
                      {prof.strengths.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-zinc-800 p-3">
                    <div className={label}>🌱 Perlu dijaga</div>
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-zinc-300">
                      {prof.watchouts.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
              {prof && <p className="text-[12px] text-zinc-500">🤖 AI-mu nanti: {prof.aiStyle}</p>}
              <div className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-zinc-500">Kurang pas?</span>
                <select value={type} onChange={(e) => (setTypeOverride(e.target.value), setDirty(true))} className="input w-auto py-1 text-[12.5px]" aria-label="Ganti tipe">
                  {MBTI_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} · {typeInfo(t).label}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={() => (setQuiz({}), setTypeOverride(""), setDirty(true), go("quiz"))} className="font-semibold text-orange-500 hover:underline">
                  ↻ Ulangi kuis
                </button>
              </div>
            </div>
          )}

          {page.k === "role" && (
            <div className="space-y-3">
              <div className="text-[15.5px] font-bold leading-snug">Mau dilatih jadi apa AI-mu?</div>
              <div className="grid grid-cols-2 gap-2">
                {ROLES.map((r) => {
                  const on = roleId === r.id;
                  const fit = prof?.fitRoles.includes(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => chooseRole(r.id)}
                      className={`min-w-0 rounded-xl border p-2.5 text-left transition ${on ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 hover:border-zinc-600"}`}
                      aria-pressed={on}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-[18px]">{r.icon}</span>
                        <b className="min-w-0 text-[13px] leading-tight">{r.name}</b>
                      </div>
                      <div className="mt-1 text-[11.5px] leading-snug text-zinc-500">{r.desc}</div>
                      {fit && <div className="mt-1 text-[10.5px] font-bold" style={{ color: g.color }}>✓ cocok dengan tipe {type}</div>}
                    </button>
                  );
                })}
                <div className={`col-span-2 rounded-xl border p-2.5 ${roleId === CUSTOM_ROLE ? "border-orange-500 bg-orange-500/10" : "border-dashed border-zinc-800"}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[18px]">✍️</span>
                    <input
                      value={customRole}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustomRole(v);
                        setDirty(true);
                        // baru dianggap pilih "peran lain" setelah benar-benar mengetik (sekadar diketuk tidak menghapus jawaban)
                        if (v.trim()) chooseRole(CUSTOM_ROLE);
                        else if (roleId === CUSTOM_ROLE && lastPreset.current) chooseRole(lastPreset.current);
                      }}
                      // nama peran sudah ada -> ketuk / Enter memilihnya lagi (jawaban latihannya kembali)
                      onClick={() => customRole.trim() && roleId !== CUSTOM_ROLE && chooseRole(CUSTOM_ROLE)}
                      onKeyDown={(e) => e.key === "Enter" && customRole.trim() && roleId !== CUSTOM_ROLE && chooseRole(CUSTOM_ROLE)}
                      maxLength={60}
                      placeholder="Peran lain… mis. Admin keuangan, Social media specialist"
                      className="input py-1.5 text-[13px]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {tq && role && (
            <div key={tq.id} className="ts-fade">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-orange-500">
                {role.icon} Latih jadi {role.name}
              </div>
              <div className="mb-1 text-[15.5px] font-bold leading-snug">{tq.q}</div>
              <div className="mb-3 text-[11.5px] text-zinc-500">{hintText(tq)}</div>
              <div className="space-y-2">
                {tq.options.map((o, i) => {
                  const on = (training.picks[tq.id] ?? []).includes(o.label);
                  return (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => pick(tq.id, o.label, tq.multi)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] transition ${on ? "border-orange-500 bg-orange-500/10 text-orange-300" : "border-zinc-800 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/50"}`}
                      aria-pressed={on}
                    >
                      <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center text-[11px] font-bold ${tq.multi ? "rounded-md" : "rounded-full"} ${on ? "bg-orange-500 text-white" : "border border-zinc-700 text-zinc-500"}`}>{tq.multi && on ? "✓" : i + 1}</span>
                      {o.label}
                    </button>
                  );
                })}
                <input
                  value={training.other[tq.id] ?? ""}
                  onChange={(e) => setOther(tq.id, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canNext && next()}
                  maxLength={300}
                  placeholder="✍️ Lainnya… tulis caramu sendiri"
                  className="input w-full border-dashed py-2 text-[13px]"
                />
              </div>
            </div>
          )}

          {page.k === "identity" && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-[104px] w-[104px] shrink-0 items-end justify-center rounded-2xl" style={{ background: `linear-gradient(180deg, ${g.soft}, transparent)` }}>
                  {av(96)}
                </div>
                <div className="min-w-0 flex-1">
                  <label className={label} htmlFor="char-name">
                    Nama AI-mu
                  </label>
                  <input id="char-name" autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="mis. Kak Rara" className="input mt-1 py-2 text-[14px]" />
                  {name && nameErr && <p className="mt-1 text-[11.5px] text-red-400">{nameErr}</p>}
                  <p className="mt-1 text-[11px] text-zinc-500">🔒 Pribadi — hanya kamu yang bisa lihat & pakai.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className={label}>Cara memanggil user</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {callChips.map((c) => (
                      <button key={c} type="button" onClick={() => c !== call && (setCall(c), setDirty(true))} className={`rounded-full border px-2.5 py-1 text-[12px] ${call === c ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}>
                        {c.split(" (")[0]}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className={label}>Emoji & gaya bahasa</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {emojiChips.map((c) => (
                      <button key={c} type="button" onClick={() => c !== emoji && (setEmoji(c), setDirty(true))} className={`rounded-full border px-2.5 py-1 text-[12px] ${emoji === c ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}>
                        {c.split(",")[0]}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex rounded-xl border border-zinc-800 p-0.5 text-[12.5px] font-semibold">
                {(["chibi", "image"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setTab(t)} className={`flex-1 rounded-lg py-1.5 ${tab === t ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`} aria-pressed={tab === t}>
                    {t === "image" ? "⬆ Upload gambar" : "🎨 Racik chibi"}
                  </button>
                ))}
              </div>
              {tab === "image" ? (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-zinc-700 p-4 text-[12.5px] text-zinc-400 hover:border-orange-500/60"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    onFile(e.dataTransfer.files?.[0]);
                  }}
                >
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={img} alt="" className="h-14 w-14 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-[22px]">🖼️</span>
                  )}
                  <span>
                    {imgBusy ? "Memproses gambar…" : img ? "Ganti gambar (klik / tarik ke sini)" : "Klik atau tarik foto / ilustrasi ke sini"}
                    <span className="block text-[11px] text-zinc-500">JPG / PNG · otomatis dipotong bulat & dikecilkan</span>
                  </span>
                </label>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className={`mb-1 ${label}`}>Model rambut</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: 10 }, (_, h) => (
                        <button key={h} type="button" onClick={() => setChibi((c) => ({ ...c, hair: h }))} className={`h-8 w-8 rounded-lg border text-[12px] font-bold ${chibi.hair === h ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}>
                          {h + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className={`mb-1 ${label}`}>Warna rambut</div>
                      <div className="flex flex-wrap gap-1.5">
                        {CHIBI_HAIRS.map((c) => (
                          <button key={c} type="button" onClick={() => setChibi((x) => ({ ...x, hc: c }))} className={`h-7 w-7 rounded-full ${chibi.hc === c ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-zinc-700"}`} style={{ background: c }} aria-label={`Rambut ${c}`} />
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className={`mb-1 ${label}`}>Warna kulit</div>
                      <div className="flex flex-wrap gap-1.5">
                        {CHIBI_SKINS.map((c) => (
                          <button key={c} type="button" onClick={() => setChibi((x) => ({ ...x, skin: c }))} className={`h-7 w-7 rounded-full ${chibi.skin === c ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-zinc-700"}`} style={{ background: c }} aria-label={`Kulit ${c}`} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className={`mb-1 ${label}`}>Benda yang dibawa</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CHIBI_PROPS.map((p) => (
                        <button key={p} type="button" onClick={() => setChibi((x) => ({ ...x, prop: p }))} className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${chibi.prop === p ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}>
                          {PROP_LABEL[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500">Warna baju mengikuti kelompok kepribadian {type} ({g.name}).</p>
                </div>
              )}
            </div>
          )}

          {page.k === "summary" && sum && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${g.color}55`, background: g.soft }}>
                <span className="flex h-16 w-16 shrink-0 items-end justify-center">{av(64)}</span>
                <div className="min-w-0">
                  <div className="text-[16px] font-bold">{nm || "AI-mu"}</div>
                  <div className="text-[12px] font-semibold" style={{ color: g.color }}>
                    {g.icon} {type} · {sum.label || typeInfo(type).label}
                  </div>
                  <div className="truncate text-[11.5px] text-zinc-500">{role ? `${role.icon} ${role.name}` : sum.role || "Peran belum dipilih"}</div>
                </div>
              </div>
              <p className="text-[11.5px] text-zinc-500">✎ Semua bisa diedit sebelum disimpan.{(role || sum.sop) && " SOP di bawah dikirim ke AI setiap kali ia menjawab."}</p>
              <div className="grid grid-cols-1 gap-y-1 text-[12.5px] sm:grid-cols-[84px_1fr] sm:items-center sm:gap-x-3 sm:gap-y-2">
                <span className={rowLabel}>Tipe</span>
                <select
                  value={type}
                  onChange={(e) => {
                    const v = e.target.value;
                    const lab = typeInfo(v).label;
                    const auto = [genRef.current?.sum.label, typeInfo(type).label];
                    setTypeOverride(v);
                    // julukan bawaan ikut tipe baru; julukan ketikan sendiri dipertahankan
                    setSum((s) => (s ? { ...s, label: auto.includes(s.label) ? lab : s.label } : s));
                    if (genRef.current) genRef.current = { ...genRef.current, sum: { ...genRef.current.sum, label: lab } };
                  }}
                  className="input py-1.5 text-[13px]"
                >
                  {MBTI_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} · {typeInfo(t).label}
                    </option>
                  ))}
                </select>
                <span className={rowLabel}>Julukan</span>
                <input value={sum.label} maxLength={60} onChange={(e) => setSum({ ...sum, label: e.target.value })} className="input py-1.5 text-[13px]" />
                <span className={rowLabel}>Peran</span>
                <textarea value={sum.role} rows={3} maxLength={600} onChange={(e) => setSum({ ...sum, role: e.target.value.replace(/\n/g, " ") })} className="input resize-y py-1.5 text-[13px] leading-snug" />
                <span className={rowLabelTop}>Gaya</span>
                <textarea value={sum.style} rows={2} maxLength={800} onChange={(e) => setSum({ ...sum, style: e.target.value })} className="input resize-y py-1.5 text-[13px] leading-snug" />
                {(role || sum.sop) && (
                  <>
                    <span className={rowLabelTop}>SOP</span>
                    <textarea value={sum.sop} rows={9} maxLength={12000} onChange={(e) => setSum({ ...sum, sop: e.target.value })} className="input resize-y py-1.5 font-mono text-[12px] leading-relaxed" placeholder="Cara berpikir & SOP dari pelatihanmu" />
                  </>
                )}
                <span className={rowLabel}>Ciri khas</span>
                <input value={sum.catchphrase} maxLength={120} onChange={(e) => setSum({ ...sum, catchphrase: e.target.value })} placeholder="kata andalan (opsional)" className="input py-1.5 text-[13px]" />
                <span className={rowLabelTop}>Larangan</span>
                <textarea value={sum.rules.join("\n")} rows={3} maxLength={1200} onChange={(e) => setSum({ ...sum, rules: e.target.value.split("\n") })} placeholder="satu larangan per baris" className="input resize-y py-1.5 text-[13px]" />
              </div>
              <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-[11.5px] leading-snug text-zinc-400">
                Setelah disimpan, AI-mu makin pintar kalau kamu isi <b>🧠 Otak</b>-nya (SOP tim, contoh jawaban bagus) dan koreksi jawabannya langsung dari chat.
              </p>
            </div>
          )}
          {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{err}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800/80 px-4 py-3">
          {step > 0 ? (
            <button type="button" onClick={() => (setErr(null), page.k === "identity" && initial && !v2 && !role ? go("intro") : setStep((s) => s - 1))} className={btnGhost}>
              ← Kembali
            </button>
          ) : (
            <button type="button" onClick={onClose} className={btnGhost}>
              Batal
            </button>
          )}
          {initial && v2 && page.k !== "summary" && trainingDone && typeKnown && !(roleId === CUSTOM_ROLE && !customRole.trim()) && (
            <button type="button" onClick={toSummary} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-300">
              Ke ringkasan »
            </button>
          )}
          {page.k === "summary" ? (
            <button type="button" onClick={save} disabled={saving} className="ml-auto rounded-xl bg-orange-500 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
              {saving ? "Menyimpan…" : initial ? "💾 Simpan perubahan" : `✓ Simpan ${nm || "AI-mu"}`}
            </button>
          ) : (
            <button type="button" onClick={next} disabled={!canNext} className="ml-auto rounded-xl bg-orange-500 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50">
              {page.k === "intro" ? "Mulai kuis →" : page.k === "quiz" && page.i === QUIZ_QS.length - 1 ? "Lihat hasil →" : page.k === "identity" ? "Lihat ringkasan →" : "Lanjut →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
