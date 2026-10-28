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
  const konten = normalizeTimeline({ ...defaultTimeline(), title: "Cuan dari Klip: Gabung Konten.com", concept: "Clipper potong video kreator jadi klip pendek, upload, dapat bayaran per views.", goal: "Ajak clipper baru daftar di Konten.com" });
  await test("revisi / setuju di proyek nyata yang menyebut situs / nama / 'Video nya': BUKAN subjek baru, tanpa riset (regresi pemeriksa)", () => {
    const revs = [
      "tambahin CTA daftar sekarang di konten.com",
      "di akhir video tampilin konten.com",
      "tambahin konten.com di adegan terakhir",
      "tulis website konten.com di outro",
      "masukin konten.com/daftar di CTA",
      "taruh link konten.com di akhir",
      "tambahin link konten.com/daftar di akhir",
      "videonya mention konten.com dong",
      "akhirnya ajak daftar di konten.com",
      "bagian akhir video kasih ajakan daftar di Konten.com",
      "Promo nya lebih fokus ke brand",
      "Video nya bagus! Sekarang render ya",
      "Teaser nya udah pas, lanjut VO",
      "Video nya Mantap",
      "videonya OK, lanjut generate VO",
      "Videonya pake bahasa Inggris aja",
      "bikin videonya kayak iklan Apple",
      "iklannya bikin ala Netflix",
      "promo nya tambahin testimoni dari Andi, clipper Bandung",
      "promo ini targetnya Mahasiswa",
      "tambah adegan soal fitur Leaderboard di video ini",
      "videonya kurang menjual, tonjolkan fitur Auto Clip",
      "teaser nya kasih teks Coming Soon",
      "di video ini Konten.com ditulis Konten dot com",
    ];
    for (const current of [teaser, konten])
      for (const t of revs) {
        const k = turnKind({ content: t, current });
        assert.equal(k.newSubject, false, `${current.title}: ${t}`);
        assert.equal(k.research, null, `${current.title}: ${t}`);
        assert.ok(!k.notes.some((x) => SUBJEK_LAIN.test(x)), `${current.title}: ${t}`);
      }
    // setuju / lanjut = mesin cepat (seperti sebelum riset ada)
    for (const t of ["Video nya bagus! Sekarang render ya", "videonya OK, lanjut generate VO", "tambahin CTA daftar sekarang di konten.com", "di akhir video tampilin konten.com"])
      assert.equal(turnKind({ content: t, current: konten }).creative, false, t);
  });
  await test("ganti subjek pakai kata kerja edit di proyek nyata = rencana baru, bukan revisi kecil", () => {
    for (const t of [
      "ganti topik: promo konten.com buat brand",
      "ganti jadi promo konten.com",
      "ubah jadi video promo konten.com buat brand",
      "videonya ganti jadi promo Shopee 11.11",
      "ubah jadi explainer cara withdraw",
      "videonya diganti aja jadi promo Konten.com buat clipper",
      "sekarang video buat clipper ya",
      "konten tiktok tips bikin hook yang nendang",
    ]) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.newSubject, true, t);
      assert.ok(k.notes.some((x) => SUBJEK_LAIN.test(x)), t);
      assert.ok(!k.notes.some((x) => REVISI_KECIL.test(x)), t);
    }
    assert.equal(turnKind({ content: "ganti topik: promo konten.com buat brand", current: teaser }).research?.query, "konten.com");
    assert.equal(turnKind({ content: "videonya ganti jadi promo Shopee 11.11", current: teaser }).research?.query, "Shopee");
    // subjek dunia Konten.com tanpa nama / situs: tidak dicari (hasil web bisa soal Binance / Shopee)
    assert.equal(turnKind({ content: "ubah jadi explainer cara withdraw", current: teaser }).research, null);
    // subjek sama (konten.com) di proyek Konten.com: tetap mesin berat, tanpa riset ulang
    const same = turnKind({ content: "videonya diganti aja jadi promo Konten.com buat clipper", current: konten });
    assert.equal(same.creative, true);
    assert.equal(same.newSubject, false);
    assert.equal(same.research, null);
    // "versi buat brand" = revisi besar (mesin berat)
    assert.equal(turnKind({ content: "Sekarang versi buat brand ya", current: konten }).creative, true);
  });
  await test("pesan berisi link saja di proyek nyata: mesin berat (panjang link tidak berpengaruh), subjek baru kalau situsnya beda", () => {
    for (const [t, isNew] of [
      ["https://www.tokopedia.com/promo/ramadan", true],
      ["https://konten.com/brand", false],
      ["ini linknya https://konten.com/blog/cara-jadi-clipper-sukses-dapat-cuan-di-tahun-2026", false],
      ["cek ini ya https://tokoku.co.id/p/ganti-logo", true],
    ] as const) {
      const k = turnKind({ content: t, current: konten });
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.newSubject, isNew, t);
      assert.equal(k.research?.why, "link", t);
      // halaman link dibaca langsung; kata sisa ("linknya") tidak dicari
      assert.equal(k.research?.query, "", t);
    }
    assert.equal(turnKind({ content: "https://konten.com/brand", current: teaser }).newSubject, true);
  });
  await test("contoh bawaan: perintah edit contohnya = revisi (mesin cepat, tanpa riset); brief tetap rencana baru", () => {
    for (const t of ["ganti warna background jadi biru tua ya", "adegan 3 dibikin lebih cepat dan teksnya lebih gede", "tolong hapus outro terus musiknya dikecilin", "VO adegan 1 terlalu cepat", "judulnya ganti jadi Cuan dari Klip"]) {
      const k = turnKind({ content: t, current: starter });
      assert.equal(k.small, true, t);
      assert.equal(k.creative, false, t);
      assert.equal(k.research, null, t);
      assert.ok(k.notes.some((x) => REVISI_KECIL.test(x)), t);
    }
    for (const t of ["videonya kepanjangan", "promo nya kurang menarik", "bikin lebih dramatis", "musik yang lebih upbeat dong", "promo nya tambahin testimoni dari Andi, clipper Bandung", "videonya kurang menjual, tonjolkan fitur Auto Clip", "Videonya pake bahasa Inggris aja"])
      assert.equal(turnKind({ content: t, current: starter }).research, null, t);
    const b = turnKind({ content: "Bikin iklan Kopi Kenangan 15 detik buat Reels", current: starter });
    assert.equal(b.small, false);
    assert.equal(b.creative, true);
    assert.equal(b.research?.query, "Kopi Kenangan");
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
