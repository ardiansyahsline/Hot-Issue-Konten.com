"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SMART_HERO } from "@/lib/aiModels";
import { CHIBI_HAIRS, CHIBI_PROPS, CHIBI_SKINS, GROUPS, MBTI_TYPES, isBuiltinHero, registerCustom, typeGroup, typeInfo, type Prop } from "@/lib/aiPersona";
import { QUESTIONS, deriveMbti, registerChar, summarize, type CharAvatar, type CharProfile, type CustomChar } from "@/lib/customChar";
import HeroArt from "./HeroArt";

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
const TOTAL = QUESTIONS.length + 2; // nama & gambar + 12 pertanyaan + hasil

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

type Summary = Required<Pick<CharProfile, "label" | "role" | "style" | "catchphrase" | "rules">>;

/**
 * Buat / edit karakter AI sendiri: nama & gambar → 12 pertanyaan → hasil (bisa diedit) → simpan.
 * Karakter bersifat pribadi (hanya pembuatnya yang bisa lihat & pakai).
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? "");
  const [avatar, setAvatar] = useState<CharAvatar>(initial?.avatar ?? { kind: "chibi", hair: 3, skin: CHIBI_SKINS[0], hc: CHIBI_HAIRS[1], prop: "orb" });
  const [tab, setTab] = useState<"image" | "chibi">(initial?.avatar.kind === "image" ? "image" : "chibi");
  const [chibi, setChibi] = useState(initial?.avatar.kind === "chibi" ? initial.avatar : { kind: "chibi" as const, hair: 3, skin: CHIBI_SKINS[0], hc: CHIBI_HAIRS[1], prop: "orb" as Prop });
  const [img, setImg] = useState<string | null>(initial?.avatar.kind === "image" ? initial.avatar.data : null);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>(initial?.profile.answers ?? {});
  const [other, setOther] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const q of QUESTIONS) {
      const a = initial?.profile.answers?.[q.id];
      if (!a) continue;
      if (Array.isArray(a)) {
        const extra = a.filter((x) => !q.options.some((op) => op.v === x));
        if (extra.length) o[q.id] = extra.join("; ");
      } else if (!q.options.some((op) => op.v === a)) o[q.id] = a;
    }
    return o;
  });
  const [mbti, setMbti] = useState(initial?.mbti ?? "");
  const [sum, setSum] = useState<Summary | null>(
    initial
      ? {
          label: initial.profile.label ?? "",
          role: initial.profile.role ?? "",
          style: initial.profile.style ?? "",
          catchphrase: initial.profile.catchphrase ?? "",
          rules: initial.profile.rules ?? [],
        }
      : null
  );
  const [dirty, setDirty] = useState(!initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);

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
  const type = mbti || deriveMbti(answers);
  // pratinjau langsung (avatar & warna kelompok mengikuti pilihan)
  registerCustom(PREVIEW, {
    type,
    hair: chibi.hair,
    skin: chibi.skin,
    hc: chibi.hc,
    prop: chibi.prop,
    img: curAvatar.kind === "image" ? curAvatar.data : undefined,
  });

  const qIdx = step - 1;
  const q = qIdx >= 0 && qIdx < QUESTIONS.length ? QUESTIONS[qIdx] : null;
  const answered = (id: string) => {
    const a = answers[id];
    return Array.isArray(a) ? a.length > 0 : !!a;
  };
  const setAns = (id: string, v: string | string[]) => {
    setAnswers((a) => ({ ...a, [id]: v }));
    setDirty(true);
  };

  const goSummary = () => {
    const d = deriveMbti(answers);
    if (dirty || !sum) {
      setMbti(d);
      setSum(summarize(nm, answers, d));
      setDirty(false);
    }
    setStep(TOTAL - 1);
  };
  const next = () => {
    if (step === 0) {
      if (nameErr) return setErr(nameErr);
      if (tab === "image" && !img) return setErr("Upload gambar dulu, atau pilih tab Racik chibi.");
      setErr(null);
      setAvatar(curAvatar);
    }
    if (step === TOTAL - 2) return goSummary();
    setStep((s) => s + 1);
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
    setSaving(true);
    setErr(null);
    const row = {
      name: nm,
      mbti: MBTI_TYPES.includes(mbti) ? mbti : deriveMbti(answers),
      avatar,
      profile: { answers, ...sum, rules: sum.rules.map((r) => r.trim()).filter(Boolean) } satisfies CharProfile,
    };
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

  const g = GROUPS[typeGroup(type)];
  const av = (size: number) => <HeroArt hero={PREVIEW} size={size} title={nm || "Karakter baru"} />;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Buat karakter AI">
      <div className="flex max-h-[92dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center gap-3 border-b border-zinc-800/80 px-4 py-3">
          <div className="font-display text-[15px] font-bold">{initial ? `✎ Edit ${initial.name}` : "＋ Buat karakter sendiri"}</div>
          <span className="text-[11.5px] text-zinc-500">
            Langkah {step + 1} dari {TOTAL}
          </span>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Tutup">
            ✕
          </button>
        </div>
        <div className="flex gap-1 px-4 pt-3">
          {Array.from({ length: TOTAL }, (_, i) => (
            <span key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-orange-500" : "bg-zinc-800"}`} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {step === 0 && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex h-[104px] w-[104px] shrink-0 items-end justify-center rounded-2xl" style={{ background: `linear-gradient(180deg, ${g.soft}, transparent)` }}>
                  {av(96)}
                </div>
                <div className="min-w-0 flex-1">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500" htmlFor="char-name">
                    Nama karakter
                  </label>
                  <input
                    id="char-name"
                    autoFocus
                    value={name}
                    maxLength={40}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="mis. Kak Rara"
                    className="input mt-1 py-2 text-[14px]"
                  />
                  {name && nameErr && <p className="mt-1 text-[11.5px] text-red-400">{nameErr}</p>}
                  <p className="mt-1 text-[11px] text-zinc-500">🔒 Pribadi — hanya kamu yang bisa lihat & pakai.</p>
                </div>
              </div>
              <div className="flex rounded-xl border border-zinc-800 p-0.5 text-[12.5px] font-semibold">
                {(["image", "chibi"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={`flex-1 rounded-lg py-1.5 ${tab === t ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`}
                    aria-pressed={tab === t}
                  >
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
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Model rambut</div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: 10 }, (_, h) => (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setChibi((c) => ({ ...c, hair: h }))}
                          className={`h-8 w-8 rounded-lg border text-[12px] font-bold ${chibi.hair === h ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}
                        >
                          {h + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Warna rambut</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CHIBI_HAIRS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setChibi((x) => ({ ...x, hc: c }))}
                          className={`h-7 w-7 rounded-full ${chibi.hc === c ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-zinc-700"}`}
                          style={{ background: c }}
                          aria-label={`Rambut ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Warna kulit</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CHIBI_SKINS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setChibi((x) => ({ ...x, skin: c }))}
                          className={`h-7 w-7 rounded-full ${chibi.skin === c ? "ring-2 ring-orange-500 ring-offset-2 ring-offset-zinc-900" : "ring-1 ring-zinc-700"}`}
                          style={{ background: c }}
                          aria-label={`Kulit ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Benda yang dibawa</div>
                    <div className="flex flex-wrap gap-1.5">
                      {CHIBI_PROPS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setChibi((x) => ({ ...x, prop: p }))}
                          className={`rounded-lg border px-2.5 py-1 text-[12px] font-semibold ${chibi.prop === p ? "border-orange-500 bg-orange-500/10 text-orange-400" : "border-zinc-800 text-zinc-400"}`}
                        >
                          {PROP_LABEL[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-500">Warna baju mengikuti kepribadian yang terbentuk dari jawaban nanti.</p>
                </div>
              )}
            </div>
          )}

          {q && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <span className="flex h-12 w-12 shrink-0 items-end justify-center overflow-hidden rounded-xl" style={{ background: g.soft }}>
                  {av(52)}
                </span>
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                    Pertanyaan {qIdx + 1} / {QUESTIONS.length}
                  </div>
                  <div className="text-[15px] font-bold leading-snug">{q.q(nm || "karaktermu")}</div>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-zinc-800">
                {q.options.map((o) => {
                  const a = answers[q.id];
                  const on = q.multi ? Array.isArray(a) && a.includes(o.v) : a === o.v;
                  return (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => {
                        if (q.multi) {
                          const cur = (Array.isArray(a) ? a : []).filter((x) => x !== o.v);
                          setAns(q.id, on ? cur : [...cur, o.v]);
                        } else {
                          setAns(q.id, o.v);
                          setOther((x) => ({ ...x, [q.id]: "" }));
                        }
                      }}
                      className={`flex w-full items-center gap-3 border-b border-zinc-800/70 px-3.5 py-2.5 text-left text-[13.5px] last:border-b-0 ${on ? "bg-orange-500/10 text-orange-300" : "text-zinc-300 hover:bg-zinc-800/60"}`}
                      aria-pressed={on}
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center border-2 ${q.multi ? "rounded" : "rounded-full"} ${on ? "border-orange-500 bg-orange-500" : "border-zinc-600"}`}
                      >
                        {on && <span className="text-[9px] font-black text-white">✓</span>}
                      </span>
                      {o.label}
                    </button>
                  );
                })}
                {q.other && (
                  <div className="border-t border-zinc-800/70 px-3.5 py-2.5">
                    <input
                      value={other[q.id] ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOther((x) => ({ ...x, [q.id]: v }));
                        if (q.multi) {
                          const base = (Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : []).filter((x) => q.options.some((o) => o.v === x));
                          setAns(q.id, v.trim() ? [...base, ...v.split(";").map((s) => s.trim()).filter(Boolean)] : base);
                        } else setAns(q.id, v);
                      }}
                      placeholder={q.multi ? "✍️ Lainnya… (pisahkan dengan ; )" : "✍️ Lainnya… tulis sendiri"}
                      maxLength={300}
                      className="input py-1.5 text-[13px]"
                    />
                  </div>
                )}
              </div>
              {q.hint && <p className="mt-2 text-[11.5px] text-zinc-500">{q.hint}</p>}
              {q.multi && <p className="mt-2 text-[11.5px] text-zinc-500">Boleh dikosongkan.</p>}
            </div>
          )}

          {step === TOTAL - 1 && sum && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-xl border p-3" style={{ borderColor: `${g.color}55`, background: g.soft }}>
                <span className="flex h-16 w-16 shrink-0 items-end justify-center">
                  {av(64)}
                </span>
                <div className="min-w-0">
                  <div className="text-[16px] font-bold">{nm}</div>
                  <div className="text-[12px] font-semibold" style={{ color: g.color }}>
                    {g.icon} {type} · {sum.label || typeInfo(type).label}
                  </div>
                  <div className="text-[11px] text-zinc-500">{typeInfo(type).traits.join(" · ")}</div>
                </div>
              </div>
              <p className="text-[11.5px] text-zinc-500">✎ Semua bisa diedit sebelum disimpan.</p>
              <div className="grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-2 text-[12.5px]">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Tipe</span>
                <select
                  value={type}
                  onChange={(e) => {
                    setMbti(e.target.value);
                    setSum((s) => (s ? { ...s, label: typeInfo(e.target.value).label } : s));
                  }}
                  className="input py-1.5 text-[13px]"
                >
                  {MBTI_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t} · {typeInfo(t).label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Julukan</span>
                <input value={sum.label} maxLength={60} onChange={(e) => setSum({ ...sum, label: e.target.value })} className="input py-1.5 text-[13px]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Peran</span>
                <input value={sum.role} maxLength={200} onChange={(e) => setSum({ ...sum, role: e.target.value })} className="input py-1.5 text-[13px]" />
                <span className="self-start pt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Gaya</span>
                <textarea value={sum.style} maxLength={800} rows={3} onChange={(e) => setSum({ ...sum, style: e.target.value })} className="input resize-y py-1.5 text-[13px]" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Ciri khas</span>
                <input value={sum.catchphrase} maxLength={120} onChange={(e) => setSum({ ...sum, catchphrase: e.target.value })} placeholder="kata andalan" className="input py-1.5 text-[13px]" />
                <span className="self-start pt-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Larangan</span>
                <textarea
                  value={sum.rules.join("\n")}
                  rows={3}
                  maxLength={1200}
                  onChange={(e) => setSum({ ...sum, rules: e.target.value.split("\n") })}
                  placeholder="satu larangan per baris"
                  className="input resize-y py-1.5 text-[13px]"
                />
              </div>
              <p className="rounded-xl border border-dashed border-zinc-800 px-3 py-2 text-[11.5px] leading-snug text-zinc-400">
                Setelah disimpan, isi <b>🧠 Otak</b> karakter (catatan pengetahuan, contoh jawaban) dan koreksi jawabannya langsung dari chat — {nm} makin pintar sesuai kebutuhanmu. Mesin utama: Claude Haiku.
              </p>
            </div>
          )}
          {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-400">{err}</p>}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800/80 px-4 py-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="rounded-xl border border-zinc-800 px-3.5 py-2 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-600">
              ← Kembali
            </button>
          ) : (
            <button type="button" onClick={onClose} className="rounded-xl border border-zinc-800 px-3.5 py-2 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-600">
              Batal
            </button>
          )}
          {initial && step > 0 && step < TOTAL - 1 && (
            <button type="button" onClick={goSummary} className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-300">
              Langsung ke hasil »
            </button>
          )}
          {step < TOTAL - 1 ? (
            <button
              type="button"
              onClick={next}
              disabled={(step === 0 && (!!nameErr || imgBusy)) || (!!q && !q.multi && !answered(q.id))}
              className="ml-auto rounded-xl bg-orange-500 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            >
              {step === TOTAL - 2 ? "Lihat hasil →" : "Lanjut →"}
            </button>
          ) : (
            <button type="button" onClick={save} disabled={saving} className="ml-auto rounded-xl bg-orange-500 px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-60">
              {saving ? "Menyimpan…" : initial ? "💾 Simpan perubahan" : `✓ Simpan ${nm}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
