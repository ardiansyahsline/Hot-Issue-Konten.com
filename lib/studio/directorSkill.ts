/**
 * Keahlian sutradara tiap hero (aman di server & browser): diturunkan dari kepribadian hero (HERO_FLAVOR + tipe MBTI di
 * lib/aiPersona.ts). `skill` = label singkat di daftar pilihan sutradara; `style` = gaya penyutradaraan (tempo, nada, struktur)
 * yang ikut di prompt sutradara. Gaya hanya mengatur CARA menyutradarai — aturan, data, durasi permintaan user & format rencana tetap.
 */
import { HERO_NAMES, personaOf, typeGroup, type Group } from "@/lib/aiPersona";

export type DirectorSkill = { skill: string; style: string };

/** hero bawaan (HERO_NAMES): satu keahlian khas per hero, walau tipe MBTI-nya sama */
const HERO_SKILL: Record<string, DirectorSkill> = {
  Harley: {
    skill: "Ide kejutan & twist visual",
    style: "tempo dinamis penuh kejutan: hook tak terduga, reveal seperti trik sulap (anticipation → pop), satu twist visual di tengah; nada seru & playful; struktur hook kejutan → reveal → demo cepat → twist → CTA.",
  },
  Nana: {
    skill: "Montage ceria penuh warna",
    style: "tempo cepat & riang: montage 0,5–1 dtk di ketukan, banyak kata kunci disorot, transisi slide/zoom; nada antusias yang menular; struktur hook energik → montage ide → reveal → CTA semangat.",
  },
  Layla: {
    skill: "Ramah buat penonton baru",
    style: "tempo sedang yang nyaman diikuti: sapa penonton, satu masalah yang relate, solusi dijelaskan jelas, langkah mudah; nada hangat & ramah; struktur sapa → masalah → solusi → cara mulai → CTA.",
  },
  Alucard: {
    skill: "Pesan tegas tanpa basa-basi",
    style: "tempo cepat & lugas: sedikit adegan, kalimat VO pendek dan yakin, impact keras di klaim utama, transisi cut/zoom; nada tegas seperti pemimpin; struktur klaim kuat → bukti → keputusan/CTA.",
  },
  Gord: {
    skill: "Explainer logis langkah demi langkah",
    style: "tempo sedang yang rapi: buka dengan pertanyaan 'kenapa', urai sebab & cara kerja satu per satu (features / split), kesimpulan jelas; nada tenang & cerdas; struktur pertanyaan → urai → cara kerja → kesimpulan → CTA.",
  },
  Lesley: {
    skill: "Satu sasaran, alur strategis",
    style: "fokus ke SATU penonton sasaran & SATU pesan: masalah tajam → strategi/solusi → hasil; transisi mask/fade yang presisi, kamera push pelan; nada kalem & yakin.",
  },
  Pharsa: {
    skill: "Cerita bermakna & menyentuh",
    style: "tempo pelan–sedang: cerita kecil tentang tujuan penonton, makna di baliknya, ajakan yang lembut; ease smooth, transisi fade, jeda dramatis secukupnya; nada hangat & dalam.",
  },
  Kagura: {
    skill: "Narasi puitis & estetik",
    style: "tempo tenang: VO seperti cerita pendek, kinetic typography berirama, transisi fade/mask, warna lembut & latar bersih; nada puitis tapi tetap jelas.",
  },
  Lunox: {
    skill: "Tutorial yang menyemangati",
    style: "tempo sedang: langkah bernomor 1-2-3 yang gampang diikuti, tiap langkah satu adegan, ditutup kalimat penyemangat; nada positif seperti mentor.",
  },
  Tigreal: {
    skill: "Jelasin pelan dari dasar",
    style: "tempo pelan: satu info per adegan, teks layar besar & jelas, ingatkan hal penting yang sering salah; nada sabar & menenangkan; struktur dasar → langkah → pengingat → CTA.",
  },
  Granger: {
    skill: "Rapi & presisi di ketukan",
    style: "potongan presisi di ketukan musik, teks ringkas tanpa kata mubazir, checklist rapi; angka hanya dari data; nada lugas; struktur masalah → bukti/fitur → checklist → CTA.",
  },
  Valir: {
    skill: "Tempo membara & teratur",
    style: "tempo naik terus seperti api: poin bernomor yang jelas, impact & musik 'drop' di klimaks, transisi slide/zoom; nada tegas berapi-api; struktur tantangan → poin 1-2-3 → klimaks → CTA.",
  },
  Saber: {
    skill: "Singkat, tajam, langsung solusi",
    style: "video pendek & padat: potongan cut cepat, satu masalah langsung ditebas satu solusi, tanpa basa-basi; nada dingin & yakin; struktur masalah → solusi → CTA.",
  },
  Zilong: {
    skill: "Aksi cepat, ajakan langsung",
    style: "tempo sangat cepat: whip/zoom, adegan 1–2 dtk, ajakan muncul sejak awal dan diulang di akhir; nada berani & gercep.",
  },
  Miya: {
    skill: "Ceria, ringan, gaya tren",
    style: "tempo ringan ala konten tren TikTok: teks pendek yang fun, ekspresif, reveal manis; nada ceria & santai yang sopan; struktur hook lucu → isi ringan → CTA ceria.",
  },
  Chou: {
    skill: "Santai, bersih, sederhana",
    style: "tempo groove santai: visual bersih minimalis, bahasa sederhana, satu ide per adegan; nada kalem tapi pas sasaran.",
  },
  Harith: {
    skill: "Balik sudut pandang (mitos vs fakta)",
    style: "struktur mitos/anggapan umum → dibalik → fakta → CTA; split sebelum-sesudah, glitch/whip secukupnya; nada cerdas & sedikit usil.",
  },
  Yve: {
    skill: "Gambaran besar → detail rapi",
    style: "sinematik luas: buka dengan gambaran besar (pull/reveal), lalu peta alur dan detail yang tersusun, penutup megah; nada visioner & tenang.",
  },
  Gusion: {
    skill: "Hook menantang & alternatif",
    style: "hook berupa pertanyaan yang menantang asumsi penonton, split 'cara lama vs cara baru', tempo cepat & jenaka; struktur tantangan → alternatif → bukti → CTA.",
  },
  Johnson: {
    skill: "Tancap gas, energi tinggi",
    style: "tempo turbo: montage cepat, impact keras di tiap reveal, musik 'high'/'drop', kamera push agresif; nada pede & ngebut.",
  },
  Hayabusa: {
    skill: "Minimalis senyap, reveal rapi",
    style: "sedikit kata, banyak ruang: jeda hening (music 'silent') sebelum reveal, potongan bersih, gerak halus; nada misterius & efisien.",
  },
  Atlas: {
    skill: "Struktur lengkap, tak ada yang kelewat",
    style: "tempo stabil & sistematis: urutan fitur/langkah lengkap seperti checklist, transisi konsisten, ringkasan di akhir; nada kokoh & meyakinkan.",
  },
  Estes: {
    skill: "Menenangkan & peduli",
    style: "tempo lembut: akui dulu masalah/keluhan penonton, beri solusi pelan-pelan, warna kalem, ease smooth; nada peduli & menenangkan.",
  },
  Beatrix: {
    skill: "Tertib, terukur, poin jelas",
    style: "poin terukur (1-2-3), adegan rapi dengan durasi seragam, transisi cut/slide yang tertib; nada lugas seperti komandan; struktur target → poin → CTA.",
  },
  Fanny: {
    skill: "Lompat cepat masalah → solusi",
    style: "kamera dinamis & lincah: adegan pendek berlompatan, whip/slide, masalah langsung disambar solusi; nada cekatan & berani.",
  },
};

/** cadangan per tipe MBTI (karakter buatan user & hero di luar daftar) */
const TYPE_SKILL: Record<string, DirectorSkill> = {
  ENTJ: HERO_SKILL.Alucard,
  INTJ: HERO_SKILL.Lesley,
  INTP: HERO_SKILL.Gord,
  ENTP: HERO_SKILL.Gusion,
  INFJ: HERO_SKILL.Pharsa,
  INFP: HERO_SKILL.Kagura,
  ENFJ: HERO_SKILL.Lunox,
  ENFP: HERO_SKILL.Nana,
  ISTJ: HERO_SKILL.Atlas,
  ISFJ: HERO_SKILL.Tigreal,
  ESTJ: HERO_SKILL.Beatrix,
  ESFJ: HERO_SKILL.Layla,
  ISTP: HERO_SKILL.Saber,
  ISFP: HERO_SKILL.Chou,
  ESTP: HERO_SKILL.Zilong,
  ESFP: HERO_SKILL.Miya,
};
const GROUP_SKILL: Record<Group, DirectorSkill> = { NT: HERO_SKILL.Lesley, NF: HERO_SKILL.Pharsa, SJ: HERO_SKILL.Atlas, SP: HERO_SKILL.Saber };

const own = <T,>(o: Readonly<Record<string, T>>, k: string): T | undefined => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** keahlian sutradara hero bawaan (nama hero) atau karakter buatan (tipe MBTI-nya) */
export function directorSkillOf(hero: string, mbti?: string | null): DirectorSkill {
  const h = own(HERO_SKILL, hero.trim());
  if (h && !mbti) return h;
  const t = (mbti || personaOf(hero, { builtinOnly: true }).type || "").toUpperCase();
  return own(TYPE_SKILL, t) ?? (/^[EI][NS][TF][JP]$/.test(t) ? GROUP_SKILL[typeGroup(t)] : HERO_SKILL.Harley);
}

/** hero bawaan yang punya keahlian khas (semua HERO_NAMES) */
export const hasHeroSkill = (hero: string) => !!own(HERO_SKILL, hero) && HERO_NAMES.includes(hero);

/** potongan prompt: gaya penyutradaraan sutradara ini (ikut bagian tetap prompt) */
export function directorSkillPrompt(name: string, s: DirectorSkill): string {
  return [
    `KEAHLIAN SUTRADARA ${name}: ${s.skill}. Gaya penyutradaraanmu: ${s.style}`,
    "Pakai gaya ini untuk memilih tempo, nada naskah, struktur adegan, transisi & gerak kamera — selama tidak bertentangan dengan permintaan user (durasi, platform, mood, subjek). Gaya TIDAK mengubah fakta, aturan sutradara, atau format rencana.",
  ].join("\n");
}
