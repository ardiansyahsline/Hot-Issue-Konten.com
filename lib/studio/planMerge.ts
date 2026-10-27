/**
 * Rencana sutradara yang datang SELAGI user mengedit. Server membuat rencana dari snapshot timeline saat pesan dikirim
 * (`sent`), padahal selama jawaban mengalir user bisa terus menggeser mixer (volume semua / per adegan / per kalimat VO / per SFX),
 * offset musik, posisi & kecepatan VO, cek ucapan, kamus ejaan, gaya bicara, durasi adegan, dll.
 *
 * keepUserEdits = gabung 3 arah: setiap nilai yang diubah user sejak pesan dikirim (`mine` ≠ `sent`) dipasang lagi di atas
 * rencana; nilai yang tidak diubah user ikut rencana. Tanpa editan selama jawaban mengalir → hasilnya PERSIS rencana (perilaku lama).
 * - objek digabung per kolom (user mengubah volume adegan, AI mengubah teksnya → keduanya dipakai); daftar biasa (teks layar,
 *   titik SFX, kamus) dianggap satu nilai; bentrok (user & AI sama-sama mengubah kolom yang sama) → editan user menang
 * - adegan dicocokkan lewat id, baris VO lewat sceneId. Susunan adegan ikut rencana kalau AI menambah / membuang / mengurutkan
 *   ulang adegan (adegan yang dihapus user selama itu tetap terhapus, adegan yang ditambah user tetap ada); kalau AI tidak mengubah
 *   susunan, susunan user yang dipakai
 * - suara VO yang dibuat / diubah user selama itu hanya dipakai kalau naskah & ejaan adegannya di hasil gabungan sama dengan saat
 *   suara itu dibuat (selain itu dibuang, sama dengan keepVo di server: AI mengganti naskah → suara lama tidak cocok lagi)
 * Modul murni (tanpa React / server) supaya bisa diuji sendiri.
 */
import type { Scene, Timeline, VoLine, VoTrack } from "./timeline";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
/** kunci yang terisi (nilai undefined = kolom tidak ada) */
const keys = (o: Obj) => Object.keys(o).filter((k) => o[k] !== undefined);

/** sama persis (isi JSON), kolom bernilai undefined dianggap tidak ada */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameValue(x, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = keys(a);
    const kb = keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
  }
  return false;
}

/** gabung 3 arah satu nilai: base (dikirim), mine (user sekarang), theirs (rencana) */
function merge3(base: unknown, mine: unknown, theirs: unknown): unknown {
  if (sameValue(mine, base)) return theirs;
  if (sameValue(theirs, base)) return mine;
  if (isObj(base) && isObj(mine) && isObj(theirs)) {
    const out: Obj = {};
    for (const k of [...keys(theirs), ...keys(mine).filter((x) => theirs[x] === undefined)]) {
      const v = merge3(base[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return mine;
}

/** gabung 3 arah daftar berkunci (adegan per id, baris VO per sceneId) — lihat keterangan modul */
function mergeList<T>(base: readonly T[], mine: readonly T[], theirs: readonly T[], key: (x: T) => string): T[] {
  if (sameValue(mine, base)) return [...theirs];
  if (sameValue(theirs, base)) return [...mine];
  const B = new Map(base.map((x) => [key(x), x] as const));
  const M = new Map(mine.map((x) => [key(x), x] as const));
  const T = new Map(theirs.map((x) => [key(x), x] as const));
  const one = (k: string): T | undefined => {
    const m = M.get(k);
    const t = T.get(k);
    if (m === undefined) return t;
    if (t === undefined) return m;
    return merge3(B.get(k), m, t) as T;
  };
  const restructured = !sameValue(base.map(key), theirs.map(key));
  if (!restructured) {
    // AI tidak mengubah susunan → susunan user (termasuk yang ditambah / dihapus / diurutkan ulang user)
    return mine.map((x) => one(key(x))).filter((x): x is T => x !== undefined);
  }
  // susunan dari rencana; yang dihapus user selama jawaban mengalir tetap terhapus
  const out: { k: string; v: T }[] = [];
  for (const t of theirs) {
    const k = key(t);
    if (B.has(k) && !M.has(k)) continue;
    const v = one(k);
    if (v !== undefined) out.push({ k, v });
  }
  // yang ditambah user selama itu → sesudah tetangga sebelumnya (urutan user), kalau tidak ada di depan
  mine.forEach((m, i) => {
    const k = key(m);
    if (B.has(k) || T.has(k)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const p = out.findIndex((x) => x.k === key(mine[j]));
      if (p >= 0) {
        at = p + 1;
        break;
      }
    }
    out.splice(at, 0, { k, v: m });
  });
  return out.map((x) => x.v);
}

const voOf = (tl: Pick<Timeline, "scenes">, id: string) => tl.scenes.find((s) => s.id === id)?.vo ?? null;
const sameVoText = (a: Scene["vo"], b: Scene["vo"]) => !!a && !!b && a.text === b.text && (a.spell ?? "") === (b.spell ?? "");

/** jalur VO hasil gabungan (lihat keterangan modul) */
function mergeVo(sent: Timeline, mine: Timeline, plan: Timeline, out: Timeline): VoTrack | null | undefined {
  const bv = sent.vo ?? null;
  const mv = mine.vo ?? null;
  const tv = plan.vo ?? null;
  if (sameValue(mv, bv)) return plan.vo;
  const lines = mergeList<VoLine>(bv?.lines ?? [], mv?.lines ?? [], tv?.lines ?? [], (l) => l.sceneId).filter((l) => {
    const t = tv?.lines.find((x) => x.sceneId === l.sceneId);
    // baris dari rencana sudah dicek server (keepVo); baris dari user → naskah adegannya harus sama dengan saat dibuat
    if (t && sameValue(l, t)) return true;
    return sameVoText(voOf(mine, l.sceneId), voOf(out, l.sceneId));
  });
  if (!lines.length) return plan.vo === undefined ? undefined : null;
  const meta = (v: VoTrack | null): Obj => {
    if (!v) return {};
    const { lines: _l, full: _f, ...rest } = v;
    return rest;
  };
  const head = merge3(meta(bv), meta(mv), meta(tv)) as Omit<VoTrack, "lines" | "full">;
  // file VO utuh hanya valid untuk susunan baris yang sama persis (dropStaleFullVo di StudioPro memeriksa posisinya)
  const full = tv && sameValue(lines, tv.lines) ? (tv.full ?? null) : mv && sameValue(lines, mv.lines) ? (mv.full ?? null) : null;
  return { ...head, lines, full } as VoTrack;
}

/**
 * Pasang lagi editan user selama jawaban sutradara mengalir di atas rencana dari server.
 * `sent` = timeline yang dikirim bersama pesan, `mine` = timeline user sekarang, `plan` = rencana (sudah dirapikan).
 * Tanpa `sent` / `mine`, atau user tidak mengubah apa pun → `plan` apa adanya.
 */
export function keepUserEdits(sent: Timeline | null | undefined, mine: Timeline | null | undefined, plan: Timeline): Timeline {
  if (!sent || !mine || sameValue(sent, mine)) return plan;
  const { scenes: bs, vo: _bv, ...bTop } = sent;
  const { scenes: ms, vo: _mv, ...mTop } = mine;
  const { scenes: ts, vo: _tv, ...tTop } = plan;
  const top = merge3(bTop, mTop, tTop) as Omit<Timeline, "scenes" | "vo">;
  // musik satu paket per file: ketukan / offset / panjang lagu milik file lain tidak boleh tercampur. User memilih musik lain
  // (＋ Musik) → musik user utuh; hanya AI yang mengganti file → musik rencana utuh; file sama → digabung per kolom (di atas)
  if (mine.music.src !== sent.music.src) top.music = mine.music;
  else if (plan.music.src !== sent.music.src) top.music = plan.music;
  const out = { ...top, scenes: mergeList<Scene>(bs, ms, ts, (s) => s.id) } as Timeline;
  const vo = mergeVo(sent, mine, plan, out);
  if (vo !== undefined) out.vo = vo;
  return out;
}
