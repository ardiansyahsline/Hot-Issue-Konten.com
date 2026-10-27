/**
 * Uji penilaian giliran sutradara Studio (logika yang sama dengan route /api/studio/chat). Jalankan:
 *   npx esbuild lib/studio/directorTurn.test.ts --bundle --platform=node --format=esm --conditions=react-server --outfile=/tmp/directorTurn.test.mjs && node /tmp/directorTurn.test.mjs
 */
import assert from "node:assert/strict";
import { isSmallEdit, needsHeavy } from "./director";
import { DIRECTOR_IDEAS } from "./directorIdeas";
import { turnKind } from "./directorTurn";
import { teaserTimeline } from "./teaser";
import { defaultTimeline, normalizeTimeline, type Timeline } from "./timeline";

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

const REVISI_KECIL = /Ini revisi kecil/;
const CONTOH = /CONTOH BAWAAN/;
const SUBJEK_LAIN = /SUBJEK LAIN/;

async function main() {
  const starter = normalizeTimeline(defaultTimeline());
  const teaser = teaserTimeline();
  const promo: Timeline = { ...normalizeTimeline({ ...defaultTimeline(), title: "Promo Konten.com untuk Clipper", concept: "Ajak clipper gabung Konten.com", goal: "Ajak clipper gabung Konten.com" }) };

  await test("chip ide di proyek CONTOH (chat kosong): bukan revisi kecil, mesin berat, riset Konten.com jalan", () => {
    for (const t of DIRECTOR_IDEAS) {
      const k = turnKind({ content: t, current: starter });
      assert.equal(k.starter, true, t);
      assert.equal(k.planned, false, t);
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.ok(k.notes.some((x) => CONTOH.test(x)), t);
      assert.ok(!k.notes.some((x) => REVISI_KECIL.test(x)), t);
    }
    const [clipper, brand, ai] = DIRECTOR_IDEAS.map((t) => turnKind({ content: t, current: starter }).research);
    assert.equal(clipper?.query, "konten.com");
    assert.deepEqual(clipper?.urls, ["https://konten.com"]);
    assert.equal(brand?.query, "konten.com");
    // fitur AI = tool internal → web tidak membantu
    assert.equal(ai, null);
  });
  await test("chip ide di proyek TEASER CS Tracker: subjek lain → rencana baru + riset, bukan revisi kecil", () => {
    for (const t of DIRECTOR_IDEAS.slice(0, 2)) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.planned, true, t);
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.newSubject, true, t);
      assert.ok(k.notes.some((x) => SUBJEK_LAIN.test(x)), t);
      assert.ok(!k.notes.some((x) => REVISI_KECIL.test(x)), t);
      assert.equal(k.research?.query, "konten.com", t);
    }
    // brief untuk fitur internal di proyek teaser: bukan revisi kecil (mesin berat), tanpa riset
    const ai = turnKind({ content: DIRECTOR_IDEAS[2], current: teaser });
    assert.equal(ai.small, false);
    assert.equal(ai.creative, true);
    assert.equal(ai.research, null);
  });
  await test("kalimat santai tanpa kata kerja di proyek contoh & teaser", () => {
    for (const current of [starter, teaser])
      for (const t of ["promo konten.com dong 30 detik", "video promo konten.com 30 detik ya", "video promo konten.com buat brand"]) {
        const k = turnKind({ content: t, current });
        assert.equal(k.small, false, t);
        assert.equal(k.creative, true, t);
        assert.equal(k.research?.query, "konten.com", t);
      }
  });
  await test("revisi di proyek nyata: perilaku sama dengan sebelumnya (tanpa riset, tanpa kuota mesin berat)", () => {
    const small = ["buat promo pake logo TWS", "bikin video pakai musik bed", "bikin video tanpa musik", "bikin video adegan 3 lebih cepat", "buat video font nya lebih besar", "bikin video logo nya lebih gede", "ganti warna jadi biru", "adegan 3 lebih cepat"];
    const light = ["bikin video lebih gelap", "bikin video hitam putih", "buat video tanpa VO"];
    for (const t of [...small, ...light]) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.small, small.includes(t), t);
      assert.equal(k.creative, false, t);
      assert.equal(k.newSubject, false, t);
      assert.equal(k.research, null, t);
      assert.equal(k.notes.some((x) => REVISI_KECIL.test(x)), small.includes(t), t);
    }
  });
  await test("proyek subjek sama: brief ulang bukan revisi kecil, tapi tidak riset ulang", () => {
    const k = turnKind({ content: "video promo konten.com 30 detik ya", current: promo });
    assert.equal(k.small, false);
    assert.equal(k.creative, true);
    assert.equal(k.newSubject, false);
    assert.equal(k.research, null);
    assert.ok(!k.notes.some((x) => SUBJEK_LAIN.test(x)));
  });
  await test("jawaban kartu: subjek dari brief aslinya", () => {
    const k = turnKind({ content: "📌 Jawaban\n- Mau tayang di mana? TikTok / Reels", current: teaser, brief: "Promo Konten.com buat clipper", lastAssistant: "```ask\n{}\n```" });
    assert.equal(k.cardAnswer, true);
    assert.equal(k.small, false);
    assert.equal(k.creative, true);
    assert.equal(k.newSubject, true);
    assert.equal(k.research?.query, "konten.com");
    const r = turnKind({ content: "📌 Jawaban\n- Durasi? 30 dtk", current: teaser, brief: "ubah warnanya" });
    assert.equal(r.newSubject, false);
    assert.equal(r.research, null);
  });
  await test("belum ada timeline: brief = rencana baru + riset, obrolan = mesin cepat tanpa riset", () => {
    const k = turnKind({ content: "buat video promo tentang konten.com", current: null });
    assert.equal(k.creative, true);
    assert.equal(k.research?.query, "konten.com");
    assert.equal(k.notes.length, 0);
    const c = turnKind({ content: "makasih kak!", current: null });
    assert.equal(c.creative, false);
    assert.equal(c.research, null);
  });
  await test("isSmallEdit / needsHeavy langsung (proyek nyata)", () => {
    assert.equal(isSmallEdit("Promo Konten.com buat clipper 30 detik", true), false);
    assert.equal(needsHeavy("Promo Konten.com buat clipper 30 detik", { hasTimeline: true }), true);
    assert.equal(isSmallEdit("buat promo pake logo TWS", true), true);
    assert.equal(needsHeavy("bikin video tanpa musik", { hasTimeline: true }), false);
  });
  console.log(`directorTurn.test: ${n} lolos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
