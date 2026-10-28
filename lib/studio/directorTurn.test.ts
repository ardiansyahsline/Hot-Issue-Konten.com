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
  // ---------- putaran 3: keluhan asli user ("buat video promo tentang konten.com" malah jadi CS Tracker) ----------
  await test("parafrase brief Konten.com / subjek lain di proyek TEASER: rencana baru, bukan revisi kecil, riset subjeknya", () => {
    for (const [t, q] of [
      ["buat video promo tentang konten.com", "konten.com"],
      ["Harley, video promo konten.com ya", "konten.com"],
      ["butuh video promo konten.com buat minggu ini", "konten.com"],
      ["tolong dibikinin video promo konten.com", "konten.com"],
      ["mau minta dibuatin video promosi konten.com", "konten.com"],
      ["please make a promo video for konten.com", "konten.com"],
      ["create promo video konten.com for tiktok", "konten.com"],
      ["aku perlu iklan konten.com 30 detik", "konten.com"],
      ["Gue butuh video 45 detik buat narik brand2 F&B pasang campaign di Konten.com, gaya santai", "konten.com"],
      ["Ads 15 detik buat GrabFood promo 11.11 ya", "GrabFood"],
      ["Layla, iklan Scarlett Whitening 20 detik dong", "Scarlett Whitening"],
      ["Gord, video explainer fitur Leaderboard Konten.com", "konten.com"],
      ["Johnson, tolong teaser Java Jazz 2027", "Java Jazz"],
      ["Harley, bikinin promo Kopi Kenangan", "Kopi Kenangan"],
      ["Nana, aku mau iklan buat Wardah lip cream baru, target cewek 20an", "Wardah lip cream"],
    ] as const) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.newSubject, true, t);
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.research?.query, q, t);
      assert.ok(k.notes.some((x) => SUBJEK_LAIN.test(x)), t);
      assert.ok(!k.notes.some((x) => REVISI_KECIL.test(x)), t);
    }
  });
  await test("koreksi & penjelasan subjek pakai 'promonya / videonya' di proyek teaser = subjek baru; di proyek Konten.com = subjek sama", () => {
    for (const t of [
      "Konten.com itu platform yang ngehubungin clipper sama brand, bikin video promonya ya",
      "konten.com itu platform yang menghubungkan clipper dan brand, bikin promonya",
      "promo Konten.com utk brand: bayar cuma kalo videonya ditonton",
      "konten.com x Shopee Live collab, bikinin teasernya",
      "ini salah, gue mau promo konten.com bukan cs tracker",
      "harley, videonya bukan tentang cs tracker, harusnya promo konten.com",
      "riset dulu soal konten.com terus bikin video promonya",
    ]) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.newSubject, true, t);
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.research?.query, "konten.com", t);
      const same = turnKind({ content: t, current: konten });
      assert.equal(same.newSubject, false, t);
      assert.ok(!same.notes.some((x) => SUBJEK_LAIN.test(x)), t);
    }
    // koreksi tanpa bentuk video: hanya nama situs yang dihitung subjek
    for (const t of ["yang aku mau tuh video promo konten.com, bukan cs tracker", "salah topik nih, harusnya konten.com", "kok jadi cs tracker? aku minta konten.com"]) {
      assert.equal(turnKind({ content: t, current: teaser }).newSubject, true, t);
      assert.equal(turnKind({ content: t, current: teaser }).research?.query, "konten.com", t);
      assert.equal(turnKind({ content: t, current: konten }).newSubject, false, t);
    }
    for (const t of ["aku minta Andi jadi narator", "harusnya lebih cepat", "aku mau warnanya biru"]) assert.equal(turnKind({ content: t, current: teaser }).newSubject, false, t);
    // nama yang dibantah ("bukan CS Tracker") tidak ikut jadi subjek
    assert.equal(turnKind({ content: "videonya bukan tentang CS Tracker, harusnya promo Kopi Kenangan", current: teaser }).newSubject, true);
    assert.equal(turnKind({ content: "videonya bukan tentang CS Tracker, harusnya promo Kopi Kenangan", current: teaser }).research?.query, "Kopi Kenangan");
    // setuju / revisi yang menyebut nama + "videonya" tetap bukan subjek baru
    for (const t of ["videonya mantap, render Konten.com nya", "videonya fokus ke Jakarta Selatan aja", "promonya buat Lebaran ya", "videonya ada typo di Konten.com"])
      assert.equal(turnKind({ content: t, current: teaser }).newSubject, false, t);
  });
  await test("ganti topik di proyek teaser (klausa pembuka, 'topiknya ganti', 'ga jadi … mending', 'next project', 'bikin yg baru')", () => {
    for (const [t, q] of [
      ["eh skip yg ini, bikin yg baru aja tentang konten.com buat brand", "konten.com"],
      ["udah cukup cs trackernya. sekarang promo Konten.com buat clipper pemula", "konten.com"],
      ["lupain yg tadi, gue mau video buat Tokopedia Ramadan Ekstra", "Tokopedia Ramadan Ekstra"],
      ["next project: explainer Konten.com buat brand UMKM", "konten.com"],
      ["Topiknya ganti ke Konten.com aja, cs tracker nanti", "konten.com"],
      ["stop dulu yg ini. ganti tema: hari guru nasional", "hari guru nasional"],
      ["Ga jadi cs tracker deh, mending Konten.com aja temanya", "konten.com"],
      ["Bang, video kampanye Hari Pahlawan 10 November buat sosmed kantor dong", "Hari Pahlawan"],
    ] as const) {
      const k = turnKind({ content: t, current: teaser });
      assert.equal(k.newSubject, true, t);
      assert.equal(k.small, false, t);
      assert.equal(k.creative, true, t);
      assert.equal(k.research?.query, q, t);
      // contoh bawaan: brief juga (rencana baru + riset), bukan revisi contoh
      const s = turnKind({ content: t, current: starter });
      assert.equal(s.small, false, t);
      assert.equal(s.creative, true, t);
      assert.equal(s.research?.query, q, t);
    }
  });
  await test("belum ada timeline: obrolan / pertanyaan / jawaban kartu tidak diriset dengan kata kunci sampah", () => {
    for (const t of [
      "oke makasih penjelasannya, nanti aku kabarin lagi",
      "kamu bisa bikin video apa aja sih? jelasin dong fitur studio ini",
      "halo harley, aku lagi bingung mau bikin apa nih buat minggu depan",
      "aku punya acara ulang tahun kantor minggu depan, butuh opening",
      "harley bisa bikin video apa aja sih?",
      "keren parah harley, makasih yaa",
      "Ok sip, tapi CTA terakhir ganti jadi Daftar Gratis",
      "Durasi total jadiin 45 detik",
      "bikin video explainer tentang cara kerja views valid",
    ])
      assert.equal(turnKind({ content: t, current: null }).research, null, t);
    // jawaban bebas sesudah kartu ```ask → riset & subjek dari brief aslinya (bukan "gaya santai")
    const ask = "Aku tanya dulu ya\n```ask\n{}\n```";
    for (const t of ["buat brand F&B aja, durasi 30 detik, gaya santai", "target clipper pemula, tayang di tiktok", "vertikal, 45 detik, pake VO cewek", "terserah kamu aja deh yang penting jelas"]) {
      for (const current of [null, starter, teaser]) {
        const k = turnKind({ content: t, current, lastAssistant: ask, brief: "Promo Konten.com buat clipper 30 detik" });
        assert.equal(k.research?.query, "konten.com", `${current?.title}: ${t}`);
        assert.equal(k.small, false, `${current?.title}: ${t}`);
        assert.equal(k.creative, true, `${current?.title}: ${t}`);
      }
      const tk = turnKind({ content: t, current: teaser, lastAssistant: ask, brief: "Promo Konten.com buat clipper 30 detik" });
      assert.equal(tk.newSubject, true, t);
      assert.ok(tk.notes.some((x) => SUBJEK_LAIN.test(x)), t);
      // brief aslinya bukan brief jelas → tanpa riset
      assert.equal(turnKind({ content: t, current: null, lastAssistant: ask, brief: "aku punya acara ulang tahun kantor, butuh opening" }).research, null, t);
    }
    // jawaban yang sendiri brief baru → subjek jawaban itu
    assert.equal(turnKind({ content: "promo Kopi Kenangan aja deh", current: null, lastAssistant: ask, brief: "Promo Konten.com buat clipper" }).research?.query, "Kopi Kenangan");
  });
  await test("'carikan musik / SFX / font', 'cari tahu kenapa' di revisi = bukan minta riset web", () => {
    for (const current of [konten, teaser])
      for (const t of ["carikan musik yang cocok", "carikan SFX yang pas buat adegan 3", "carikan font yang lebih tegas", "adegan 2 ganti jadi browsing di HP", "cari tahu kenapa VO nya kepotong", "tolong carikan ide hook yang lebih nendang"])
        assert.equal(turnKind({ content: t, current }).research, null, `${current.title}: ${t}`);
    // minta riset sungguhan tetap jalan (mesin berat)
    const r = turnKind({ content: "cari info dulu soal Kopi Kenangan ya", current: konten });
    assert.equal(r.research?.why, "minta");
    assert.equal(r.research?.query, "Kopi Kenangan");
    assert.equal(r.creative, true);
  });
  await test("penonton & rujukan gaya = atribut revisi, bukan subjek baru", () => {
    for (const current of [konten, promo]) {
      const g = turnKind({ content: "iklan untuk Gen Z, pakai bahasa gaul", current });
      assert.equal(g.newSubject, false, current.title);
      assert.equal(g.research, null, current.title);
      const a = turnKind({ content: "pelajari dulu soal gaya iklan Apple terus terapin", current });
      assert.equal(a.newSubject, false, current.title);
      assert.equal(a.research?.why, "minta", current.title);
      assert.equal(a.research?.query, "gaya iklan Apple", current.title);
    }
    assert.equal(turnKind({ content: "iklan untuk Gen Z, pakai bahasa gaul", current: null }).research, null);
  });
  await test("pertanyaan 'kenapa / jelasin' bukan revisi kecil; 'musiknya diganti' revisi kecil", () => {
    for (const current of [teaser, konten]) {
      for (const t of ["kenapa adegan 3 gitu? kok tiba2 ada grafik", "bisa jelasin kenapa milih musik ini?"]) {
        const k = turnKind({ content: t, current });
        assert.equal(k.small, false, t);
        assert.ok(!k.notes.some((x) => REVISI_KECIL.test(x)), t);
      }
      for (const t of ["bisa ga musiknya diganti yg lebih chill lofi gitu", "logonya kegedean", "kok musiknya kekencengan, kecilin dong"]) assert.equal(turnKind({ content: t, current }).small, true, t);
    }
  });
  await test("isSmallEdit / needsHeavy langsung (proyek nyata)", () => {
    assert.equal(isSmallEdit("Promo Konten.com buat clipper 30 detik", true), false);
    assert.equal(needsHeavy("Promo Konten.com buat clipper 30 detik", { hasTimeline: true }), true);
    assert.equal(isSmallEdit("buat promo pake logo TWS", true), true);
    assert.equal(needsHeavy("bikin video tanpa musik", { hasTimeline: true }), false);
    // pertanyaan bukan revisi kecil; kata kerja edit di pertanyaan ("kenapa ga diganti aja musiknya?") tetap revisi
    assert.equal(isSmallEdit("kenapa adegan 3 gitu? kok tiba2 ada grafik", true), false);
    assert.equal(isSmallEdit("bisa jelasin kenapa milih musik ini?", true), false);
    assert.equal(isSmallEdit("kenapa ga diganti aja musiknya?", true), true);
    assert.equal(isSmallEdit("bisa ga musiknya diganti yg lebih chill lofi gitu", true), true);
    // brief yang dulu salah jadi revisi kecil karena kata "detik"
    for (const t of ["aku perlu iklan konten.com 30 detik", "Ads 15 detik buat GrabFood promo 11.11 ya", "Layla, iklan Scarlett Whitening 20 detik dong", "Topiknya ganti ke Konten.com aja, cs tracker nanti"])
      assert.equal(isSmallEdit(t, true), false, t);
  });
  console.log(`directorTurn.test: ${n} lolos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
