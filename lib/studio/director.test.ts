/**
 * Uji sutradara Studio: konteks Konten.com, contoh FORMAT, deteksi contoh bawaan, keahlian hero, pemilihan mesin. Jalankan:
 *   npx esbuild lib/studio/director.test.ts --bundle --platform=node --format=esm --conditions=react-server --outfile=/tmp/director.test.mjs && node /tmp/director.test.mjs
 */
import assert from "node:assert/strict";
import { HERO_NAMES } from "@/lib/aiPersona";
import type { CustomChar } from "@/lib/customChar";
import { DIRECTOR_RULES, directorSession, historyText, isSmallEdit, needsHeavy } from "./director";
import { resolveDirector } from "./directorResolve";
import { directorSkillOf, hasHeroSkill } from "./directorSkill";
import { isStarterTimeline } from "./directorStarter";
import { researchFooter } from "./research";
import { teaserTimeline } from "./teaser";
import { defaultTimeline, normalizeTimeline } from "./timeline";

let n = 0;
const test = async (name: string, f: () => void | Promise<void>) => {
  try {
    await f();
    n++;
  } catch (e) {
    console.error(`GAGAL: ${name}`);
    throw e;
  }
};

async function main() {
  // ---------- konteks Konten.com & contoh FORMAT ----------
  await test("aturan memuat konteks bisnis Konten.com (brand ↔ clipper) & tool internal", () => {
    assert.match(DIRECTOR_RULES, /## KONTEN\.COM/);
    assert.match(DIRECTOR_RULES, /MENGHUBUNGKAN BRAND dengan KREATOR & CLIPPER/);
    assert.match(DIRECTOR_RULES, /TOOL INTERNAL/);
    assert.match(DIRECTOR_RULES, /Promo Konten\.com BUKAN promo CS Tracker/);
    assert.match(DIRECTOR_RULES, /## PAHAMI SUBJEK DULU/);
    assert.doesNotMatch(DIRECTOR_RULES, /studio video internal tim Konten\.com/);
  });
  const ex = JSON.parse(DIRECTOR_RULES.split("CONTOH FORMAT")[1].split("```studio\n")[1].split("\n```")[0]) as Record<string, unknown>;
  await test("contoh FORMAT tidak lagi tentang CS Tracker / layar tool internal & ditandai bukan isi", () => {
    const raw = JSON.stringify(ex);
    assert.doesNotMatch(raw, /CS Tracker|hotIssue|dashboard|videoReview|Hot issue/i);
    assert.match(DIRECTOR_RULES, /BUKAN isi untuk disalin/);
    assert.doesNotMatch(raw, /\d+(\.\d+)?\s*(rb|ribu|juta|jt|%|views)\b/i, "contoh tidak boleh berisi angka klaim");
  });
  await test("contoh FORMAT tetap rencana yang sah & padat (SFX tidak terbuang, VO muat di durasi)", () => {
    const tl = normalizeTimeline(ex);
    const rawScenes = ex.scenes as { sfx: unknown[] }[];
    assert.equal(tl.scenes.length, 3);
    tl.scenes.forEach((s, i) => assert.equal(s.sfx.length, rawScenes[i].sfx.length, `SFX adegan ${s.id} terbuang`));
    assert.equal(tl.scenes[2].layout.kind, "phone");
    assert.equal(tl.scenes[2].layout.screen, "website");
    for (const s of tl.scenes) {
      const words = (s.vo?.text ?? "").split(/\s+/).filter(Boolean).length;
      const pauses = ((s.vo?.text ?? "").match(/…/g) ?? []).length * 0.4;
      assert.ok(words / 2.5 + 0.4 + pauses <= s.dur + 0.45, `VO ${s.id} kepanjangan`);
    }
  });

  // ---------- contoh bawaan vs proyek nyata ----------
  await test("deteksi contoh bawaan", () => {
    assert.equal(isStarterTimeline(normalizeTimeline(defaultTimeline())), true);
    // timeline kosong yang dinormalisasi berisi contoh bawaan
    assert.equal(isStarterTimeline(normalizeTimeline({ scenes: [] })), true);
    assert.equal(isStarterTimeline(teaserTimeline()), false);
    assert.equal(isStarterTimeline(normalizeTimeline(ex)), false);
    assert.equal(isStarterTimeline(null), false);
    const edited = normalizeTimeline(defaultTimeline());
    edited.scenes[0] = { ...edited.scenes[0], text: ["Teks punyaku"] };
    assert.equal(isStarterTimeline(edited), false);
    const renamed = { ...normalizeTimeline(defaultTimeline()), title: "Promo kopi" };
    assert.equal(isStarterTimeline(renamed), false);
  });
  await test("sesi: contoh bawaan ditandai, riset masuk sebagai blok tersendiri", () => {
    const base = { name: "Alif", timeline: normalizeTimeline(defaultTimeline()), now: new Date("2026-10-27T03:00:00Z") };
    assert.match(directorSession({ ...base, starter: true }), /CONTOH BAWAAN[\s\S]*RENCANA BARU dari nol/);
    assert.doesNotMatch(directorSession(base), /CONTOH BAWAAN/);
    const withR = directorSession({ ...base, research: "## HASIL RISET WEB (uji)\n[1] Konten — konten.com" });
    assert.match(withR, /## HASIL RISET WEB \(uji\)/);
    assert.doesNotMatch(directorSession({ ...base, research: "" }), /HASIL RISET/);
    assert.match(directorSession({ name: "Alif", timeline: null }), /belum ada — ini rencana baru/);
  });

  // ---------- keahlian hero ----------
  await test("keahlian sutradara ada & khas untuk semua hero bawaan", () => {
    const labels = new Set<string>();
    const shorts = new Set<string>();
    for (const h of HERO_NAMES) {
      const s = directorSkillOf(h);
      assert.ok(hasHeroSkill(h), `${h} tanpa keahlian khas`);
      assert.ok(s.skill.length >= 8 && s.skill.length <= 40, `${h}: label keahlian ${s.skill.length} huruf`);
      assert.ok(s.style.length >= 60, `${h}: gaya terlalu pendek`);
      // label kartu "Pilih sutradara" (84 px, 2 baris): pendek supaya tidak terpotong di tengah frasa
      assert.ok(s.short && s.short.length <= 18 && s.short.split(" ").every((w) => w.length <= 12), `${h}: label pendek "${s.short}"`);
      labels.add(s.skill);
      shorts.add(s.short!);
    }
    assert.equal(labels.size, HERO_NAMES.length, "label keahlian kembar");
    assert.equal(shorts.size, HERO_NAMES.length, "label pendek kembar");
    // karakter buatan / hero asing: dari tipe MBTI
    assert.equal(directorSkillOf("Karakterku", "INTP").skill, directorSkillOf("Gord").skill);
    assert.ok(directorSkillOf("Siapa", "XXXX").skill);
  });
  await test("prompt sutradara memuat keahlian + batas aturan (hero bawaan & karakter Train AI)", async () => {
    const none = async () => ({ char: null, memory: [] });
    const nana = await resolveDirector({ hero: "Nana" }, none);
    assert.match(nana.persona, /KEAHLIAN SUTRADARA Nana: Montage ceria/);
    assert.match(nana.persona, /BATAS KARAKTER/);
    const harley = await resolveDirector(null, none);
    assert.equal(harley.name, "Harley");
    assert.match(harley.persona, /KEAHLIAN SUTRADARA Harley/);
    const id = "0f0e0d0c-0b0a-4908-8706-050403020100";
    const c: CustomChar = {
      id,
      name: "Kak Klip",
      mbti: "ENFJ",
      avatar: { kind: "chibi", hair: 1, skin: "#f5c9a8", hc: "#3b2a1e", prop: "orb" },
      profile: { answers: {}, version: 2, roleLabel: "Pelatih Clipper", label: "Si Pelatih" },
    };
    const mine = await resolveDirector({ hero: `char:${id}`, name: "Kak Klip" }, async () => ({ char: c, memory: [] }));
    assert.equal(mine.custom, true);
    assert.match(mine.persona, /KEAHLIAN SUTRADARA Kak Klip: Tutorial yang menyemangati/);
    assert.match(mine.extra, /BATAS KARAKTER/);
    const gone = await resolveDirector({ hero: `char:${id}` }, none);
    assert.equal(gone.name, "Harley");
    assert.ok(gone.fallback);
  });

  // ---------- pemilihan mesin & riwayat ----------
  await test("minta video untuk subjek lain di proyek yang sudah ada = mesin berat, bukan revisi kecil", () => {
    assert.equal(needsHeavy("buat video promo tentang konten.com", { hasTimeline: true }), true);
    assert.equal(isSmallEdit("buat video promo tentang konten.com", true), false);
    assert.equal(isSmallEdit("ganti warna jadi biru", true), true);
    assert.equal(isSmallEdit("buat videonya lebih cepat", true), true);
    assert.equal(needsHeavy("makasih kak!", { hasTimeline: true }), false);
    assert.equal(needsHeavy("buat video promo tentang konten.com", { hasTimeline: false }), true);
  });
  await test("riwayat: baris sumber riset dibuang", () => {
    const t = `Aku riset dulu ya ✨\n\n\`\`\`studio\n{"scenes":[{}]}\n\`\`\`${researchFooter([{ title: "x", url: "https://konten.com" }])}`;
    const h = historyText(t);
    assert.doesNotMatch(h, /Sumber riset/);
    assert.match(h, /\[rencana sebelumnya\]/);
  });
  console.log(`director.test: ${n} lolos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
