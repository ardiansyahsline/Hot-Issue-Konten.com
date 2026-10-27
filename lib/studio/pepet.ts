/**
 * HURUF E bahasa Indonesia punya dua bunyi dengan tulisan yang sama:
 *  - pepet  [ə]: bareng, dengan, senang, sekarang — juga e di imbuhan be-/ber-/per-/pe-/me-/mem-/men-/meng-/meny-/ke-/se-/ter-
 *  - taling [e/ɛ]: enak, sore, beres, keren
 * Mesin suara berbasis huruf (bank suara Chatterbox di laptop) menebak sendiri dan kadang salah ("bareng" → "baréng"). Ejaan mana
 * yang membuatnya mengucap ə hanya bisa diuji dengan telinga, jadi modul ini menyiapkan bahannya (murni, tanpa paket luar):
 *  - guessE(kata): tebak bunyi tiap huruf e — dari daftar kata yang disusun sendiri (kata umum naskah konten / berita / kerja) dan
 *    aturan imbuhan (kata berimbuhan dipecah: me+nerima → terima, ke+sempat+an, mem+beres+kan). Ragu → null ("tidak yakin").
 *  - eWords(teks): kata ber-huruf e di naskah + tebakannya (garis bawah titik-titik di panel Suara VO hanya untuk e pepet yang yakin)
 *  - spellCandidates(kata): maks 5 ejaan untuk dicoba di laptop (termasuk tulisan asli), masing-masing dengan alasannya
 *  - isPepetSpelling(dari, ke): ejaan cuma menandai bunyi e (bareng → barêng / barəng / bar'ng / skarang) — bukan kata lain
 * Tanpa import (aman untuk server, browser & uji esbuild).
 */

export type EKind = "pepet" | "taling";
/** satu huruf e di kata: `at` = indeks di kata (seperti ditulis), `kind` null = tidak yakin */
export type EMark = { at: number; kind: EKind | null };
export type EGuess = {
  /** kata seperti ditulis (NFC) */
  word: string;
  marks: EMark[];
  /** ada minimal satu e pepet yang yakin (kata ini diberi garis bawah titik-titik) */
  pepet: boolean;
  /** semua e di kata ini yakin */
  sure: boolean;
  kind: "pepet" | "taling" | "campur" | "ragu" | "tanpa-e";
  /** alasan singkat bahasa awam */
  why: string;
};
/** `name` = ditulis berhuruf besar di tengah kalimat (mungkin nama diri: Berlin, Pentagon) — tebakan imbuhan tidak dipakai */
export type EToken = EGuess & { start: number; end: number; name: boolean };
/** `name`: kata ini mungkin nama diri / kata asing (huruf besar di tengah kalimat) → e-nya tidak ditebak dari imbuhan */
export type GuessOpts = { name?: boolean };
export type SpellCand = { text: string; why: string; kind: "asli" | "kamus" | "pepet" | "taling" | "ragu" };

/** paling banyak kandidat ejaan otomatis per kata (termasuk tulisan asli) */
export const MAX_CAND = 5;

// ---------------------------------------------------------------------------------------------
// daftar kata (disusun sendiri). Penulisan: e = pepet, é = taling. Kata yang tulisannya sama tapi bunyinya bisa dua (apel buah /
// apél upacara, kecap / mengecap) masuk RAGU: tidak ditebak.
// ---------------------------------------------------------------------------------------------
/** semua e pepet */
const PEPET =
  "bareng barengan dengan senang seneng sekarang semua sedang benar bener beneran besar cepat cepet lebih tempat kerja kerjasama empat " +
  "delapan tengah terus ganteng kenceng temen pengen males nemu ngerti mengerti erti kinerja dokter komputer oktober berantak berantakan " +
  "bebas beban bekal bekas beku belah belakang belanja belas beli belum benang bencana benci benda bendung benih bentuk benua berapa " +
  "beberapa berangkat berani beras berat beri berita beritahu berkah berkas berlian bersih besi betah betapa betina betis betul bengkak " +
  "belanda celah celaka celana cemara cemas cemburu cemerlang cerah cerdas ceria cerita cermat cermin cetak dekat demam dendam dengar " +
  "dengki depan deras derajat derita dermaga desak detak detik embun emas empuk enam enggan engkau entah erat gedung gelap gelar gelas " +
  "gelembung geli gelisah gelombang gema gemar gemas gembira gempa gempar gemuk gendang genggam gentar gerah gerai gerak geram gerbang " +
  "gerimis gerobak gesit getah getar getir henti hening jebak jeda jelajah jelas jembatan jemput jempol jemur jenis jenuh jepit jera " +
  "jerat jernih jeruk kebun kecil kejam kejar kelak kelapa kelar kelas keledai keliling keliru kelinci kelompok keluarga kemah kemarau " +
  "kemarin kemas kembali kembang kembar kemudi kemudian kena kenal kenang kenapa kencang kendala kendali kening kental kentang kentut " +
  "kenyang kepada kepala kepiting kerabat kerap keras kerbau kering keringat kerikil keris kertas kerudung kerupuk kesal kesan kesel " +
  "ketan ketat ketemu ketik ketika ketua ketupat lebah lebat ledak legam lekas lekat lekuk lelah leluasa leluhur lemah lemak lemari " +
  "lemas lembab lembaga lembar lembur lembut lempar lengah lengan lengkap lenyap lepas letak letih letus lezat mekar melati memang " +
  "menang menantu menara mendung mengapa menit mentah menteri merdu meriah mesin meski mesti negara negeri nelayan pecah pedas pedih " +
  "pedoman peduli pegal pegang pejam pekan pekat pelan pelangi pelita pelosok peluang peluh peluk peluru pemuda pendam penat pening " +
  "penjara penting penuh penyu pepaya perahu peran perang perangkat peras perdana perempuan pergi peri periksa perintah peringkat " +
  "perkara perlu permata pernah persis pertama pertiwi perut pesan pesawat pesisir petak petang peti petik petir rebah rebus rebut " +
  "redam redup regang rekah rekam rekan remaja remuk rempah renang rencana rendah rendam renta rentan rentang renung resap retak rezeki " +
  "sebab sebal sebar sebelah sebelum sebut sedap sedekah sederhana sedih sedikit segala segar segera sejak sejarah sejuk sekolah selalu " +
  "selamat selasa selatan selesai selimut seluruh semak semangat sembilan sembuh sembunyi semenjak sempat sempit sempurna semut sendiri " +
  "senin seni senja senyum sepatu seperti sepi sepuluh serah serangga serba serbu sering serta seru sesak sesal sesudah setelah setia " +
  "setuju tebak tebal tebing tegak tegang tegar tegas teguh tekad tekan tekun telaga telah telan telapak telat teliti telinga teluk " +
  "telur teman tembak tembus tempuh temu tenaga tenang tenggelam tengok tentang tentara tentu tenun tepat tepi tepuk tepung terang " +
  "terbang terbit terima terjang terjun terka ternak ternyata tertib tetangga tetap tetapi wewenang kera ngeri sementara pemilu ke " +
  // lebaran (hari raya) = lə-baran: kata utuh di daftar menang atas lebar (taling) + -an
  "lebaran";
/** semua e taling */
const TALING =
  "enak sore beres meja ekor nenek lele karet kaget becak bebek bego bete cewek cek ceker desa dewa dewan ejek elang esok es keju " +
  "kepo keren lebar lewat merah mewah nekat pena pendek pensil pentas perak pesta resmi rela sehat sewa tempe tempo tenda tetes bensin " +
  "besok belok bengkel beda hebat heran hemat hewan heboh kece oke hore sate kafe tes teh tega deh eh repot rewel level model hotel paket " +
  "roket proyek efek efektif konten kreator video media teknologi teknik ekonomi energi emosi eja era elit etika ekstra ekspor elegan " +
  "demo rekor sektor sentimen investasi investor presiden regulasi tren dompet denda sesi seri sel servis serius tema tenis " +
  "televisi telepon pensiun penalti permen pers proses peka tembok mental mentor menu memori memo melodi merek mewek mesra melon sedan " +
  "sepak lebay baper mager rese pede capek kredit debat detail desain emiten dividen resesi koreksi netizen fenomena rekomendasi " +
  "komentar konser pandemi target klien manajemen strategi momen konsep efisien objek subjek aspek reaksi respons realita rekap relevan " +
  "sukses sistem aset progres agresif negatif ide versi tiket resep terminal termos termin member membran eropa denpasar terapi teori " +
  "teror mentalitas mentoring " +
  // nama / kata serapan yang terlihat seperti berawalan ber-/pen-/pem- (tebakan imbuhan salah: bər-lin, pən-tagon, pəm-pek)
  "pempek berlin pentagon";
/** campuran: é = taling, e = pepet */
const CAMPUR =
  "meréka keréta bendéra sepéda keméja merdéka kecéwa jelék persén seléra tempél celotéh terompét cengéng gedé gemés ceréwét mentéga " +
  "pécel méter séptémber désémber novémber lengkét pesantrén geréja pendéta rékening émber " +
  // turunan "lebar" (taling) — kata utuh menang supaya tidak terbaca sebagai pe-/per-/ke- + "lebaran" (hari raya)
  "pelébaran perlébaran kelébaran pelébarannya perlébarannya";
/** bunyinya bisa dua / tidak yakin → tidak ditebak */
const RAGU = "apel serang teras per kecap bela seram sendok dewasa setan metode seret geger personal personel persona performa pentil perban semester generasi " +
  // medan perang = mədan, kota Medan = médan
  "medan perfect";
/** kata dasar tanpa huruf e (untuk mengenali imbuhan: se+buah, ter+baik, ke+ber+sama+an) */
const ROOTS =
  "ada adil ajak ajar akan akhir alam alir ambil aman amat anak anggap angkat antar arah arti asah asal atur awal awas bagai bagi bagus " +
  "baik baju balik bangun bank banting bantu banyak baru bawa bayar bicara biasa bijak bikin bilang bisa buah buang buat buka buku bulan " +
  "bunuh buru buruk butuh cair cakap campur cari cinta coba cuci cukup curi dadak daftar dagang damai dapat darat dasar datang daya diam " +
  "didik diri duduk duga dukung gabung gagal gali gambar ganggu gantung ganti gaul guna gunting hadap hadir hajar hambat hancur harap " +
  "harga hari harus hasil hati hibur hidup hilang hindar hitung hubung hukum hutang ikat ikut ingat ingin isi izin jabat jadi jaga jalan " +
  "jam jamin jangkau janji jatuh jauh jawab jual juang juta kabar kait kalah kali kandung kata kaya kirim kitar kota kuasa kuat kumpul " +
  "kunjung kurang laku lalu lama lambat langgan lanjut lapor latih lawan layan libat liat lihat lindung lingkung luar luas luka lulus " +
  "lupa maaf macam main maju makan malu mampu mandi manfaat masak masuk mati minat minggu minta minum miskin mohon muda mudah mula mulai " +
  "murah naik nama nanti nikah nikmat nilai nyaman nyata obat olah orang pagi pakai paksa panas pandang panggil pasang pasti pikir pilih " +
  "pimpin pinjam pinta pintar puas pukul pulang punya pusat putar putus ragu raih raja rapat rasa ratus rawat ribu ruang rugi rumah rupa " +
  "rusak saat sadar saing sakit salah sama sambut sampai sangka sapa satu siap simpan sinar singkat suai suara suka sukar sulit susah " +
  "susun tahan tahu tahun tambah tampil tanam tanding tangkap tani tanya tari tarik tawar tiap tidur tinggal tingkat tolak tolong tonton " +
  "tugas tuju tukar tulis tumbuh tunda tunggu tunjuk turun turut ubah ucap uji ujar ukur ulang umum undang unggah untung urus usaha usul " +
  "utama wajib waktu wujud lain lagi potong mana suatu moga makin hingga malam panjang tidak gini gitu cara siang dalam atas bawah " +
  "samping dulu masa jumlah tinggi kini dua tiga lima tujuh rapi";

/** per huruf: undefined = bukan e, null = e tidak yakin */
type Pat = (EKind | null | undefined)[];
type Entry = { pat: Pat; src: "pepet" | "taling" | "campur" | "ragu" };

/** huruf e dengan / tanpa tanda (pepet ê ĕ ə ǝ, taling é è, lain ë ē) */
const E_CHARS = "eéèêëĕēəǝ";
const E_PEPET = "êĕəǝ";
const E_TALING = "éè";
const isE = (c: string) => E_CHARS.includes(c);
const VOWELS = "aiueo";
const isVowel = (c: string) => VOWELS.includes(c) || isE(c);

function entry(spelled: string, src: Entry["src"]): [string, Entry] {
  let plain = "";
  const pat: Pat = [];
  for (const ch of spelled) {
    if (ch === "é") {
      plain += "e";
      pat.push(src === "ragu" ? null : "taling");
    } else if (ch === "e") {
      plain += "e";
      pat.push(src === "ragu" ? null : src === "taling" ? "taling" : "pepet");
    } else {
      plain += ch;
      pat.push(undefined);
    }
  }
  return [plain, { pat, src }];
}
const words = (s: string) => s.split(/\s+/).filter(Boolean);
const DICT: ReadonlyMap<string, Entry> = new Map([
  ...words(PEPET).map((w) => entry(w, "pepet")),
  ...words(TALING).map((w) => entry(w, "taling")),
  ...words(CAMPUR).map((w) => entry(w, "campur")),
  ...words(RAGU).map((w) => entry(w, "ragu")),
]);
const ROOT_SET: ReadonlySet<string> = new Set(words(ROOTS));
/** jumlah kata di daftar (untuk uji) */
export const dictSize = () => ({ kata: DICT.size, dasarTanpaE: ROOT_SET.size });

// ---------------------------------------------------------------------------------------------
// pemecah imbuhan
// ---------------------------------------------------------------------------------------------
type Pre = { s: string; roots: (rest: string) => string[] };
const V0 = /^[aiueo]/;
const any = (r: string) => [r];
/** awalan + cara mengembalikan kata dasarnya (peluluhan: meny+apu → sapu, mem+akai → pakai, men+ulis → tulis, meng+irim → kirim) */
const PREFIXES: readonly Pre[] = [
  { s: "menge", roots: any },
  { s: "penge", roots: any },
  { s: "meny", roots: (r) => (V0.test(r) ? [`s${r}`] : []) },
  { s: "peny", roots: (r) => (V0.test(r) ? [`s${r}`] : []) },
  { s: "meng", roots: (r) => (V0.test(r) ? [r, `k${r}`] : /^(g|h|k)/.test(r) ? [r] : []) },
  { s: "peng", roots: (r) => (V0.test(r) ? [r, `k${r}`] : /^(g|h|k)/.test(r) ? [r] : []) },
  { s: "mem", roots: (r) => (V0.test(r) ? [`p${r}`, r] : /^[bpfv]/.test(r) ? [r] : []) },
  { s: "pem", roots: (r) => (V0.test(r) ? [`p${r}`, r] : /^[bpfv]/.test(r) ? [r] : []) },
  { s: "men", roots: (r) => (V0.test(r) ? [`t${r}`] : /^(d|c|j|t|z|sy)/.test(r) ? [r] : []) },
  { s: "pen", roots: (r) => (V0.test(r) ? [`t${r}`] : /^(d|c|j|t|z|sy)/.test(r) ? [r] : []) },
  { s: "ber", roots: any },
  { s: "ter", roots: any },
  { s: "per", roots: any },
  { s: "bel", roots: (r) => (r === "ajar" ? [r] : []) },
  { s: "pel", roots: (r) => (r === "ajar" ? [r] : []) },
  { s: "nge", roots: any },
  { s: "kau", roots: any },
  { s: "me", roots: (r) => (/^(l|r|w|y|m|n)/.test(r) ? [r] : []) },
  // pe- di depan kata dasar berawalan konsonan (petani, pedagang, pemuda, pelari)
  { s: "pe", roots: (r) => (!V0.test(r) ? [r] : []) },
  // be- / te-: kata dasar berawalan r (be+rasa → berasa, te+rasa → terasa) atau suku pertama berakhiran -er (be+kerja)
  { s: "be", roots: (r) => (/^r/.test(r) || /^[^aiueo]er/.test(r) ? [r] : []) },
  { s: "te", roots: (r) => (/^r/.test(r) ? [r] : []) },
  { s: "ke", roots: any },
  { s: "se", roots: any },
  { s: "di", roots: any },
  { s: "ku", roots: any },
  { s: "ng", roots: (r) => (V0.test(r) ? [r, `k${r}`] : []) },
];
const SUF_PART = ["", "lah", "kah", "pun", "tah"];
const SUF_POSS = ["", "nya", "ku", "mu"];
const SUF_DER = ["", "kan", "an", "i", "in"];

type Parse = { pat: Pat; root: string; src: Entry["src"] | "dasar"; pre: string[]; suf: number; score: number };

const pepetPat = (s: string): Pat => [...s].map((c) => (c === "e" ? "pepet" : undefined));

/** semua kata dasar di dalam `stem` lewat 0–2 awalan → pola huruf e per huruf `stem` */
function viaPrefixes(stem: string, depth: number, sufN: number, out: Parse[], pre: string[] = []): void {
  const hit = DICT.get(stem);
  const affixes = pre.length + sufN;
  // kata dasar di bawah imbuhan minimal 3 huruf (bukan "es" di "ber·es·kan")
  if ((hit || ROOT_SET.has(stem)) && (affixes === 0 || stem.length >= 3)) {
    // kata "ragu" hanya dipakai kalau tidak ada pemecahan lain ("perbankan" = per+bank+an, bukan perban+kan)
    const score = stem.length * 10 - affixes + (hit ? 0.5 : 0) - (hit?.src === "ragu" ? 1000 : 0);
    out.push({ pat: hit ? hit.pat : [...stem].map(() => undefined), root: stem, src: hit ? hit.src : "dasar", pre, suf: sufN, score });
  }
  if (depth >= 2) return;
  for (const p of PREFIXES) {
    if (!stem.startsWith(p.s) || stem.length - p.s.length < 2) continue;
    const rest = stem.slice(p.s.length);
    for (const root of p.roots(rest)) {
      const sub: Parse[] = [];
      viaPrefixes(root, depth + 1, sufN, sub, [...pre, p.s]);
      for (const r of sub) {
        // huruf tambahan peluluhan (s/p/t/k) tidak tertulis di kata → pola dipotong di depan
        const drop = root.length - rest.length;
        out.push({ ...r, pat: [...pepetPat(p.s), ...r.pat.slice(drop)] });
      }
    }
  }
}

function parseWord(key: string): Parse | null {
  const all: Parse[] = [];
  for (const a of SUF_PART)
    for (const b of SUF_POSS)
      for (const c of SUF_DER) {
        const suf = a + b + c;
        if (suf && (!key.endsWith(suf) || key.length - suf.length < 2)) continue;
        const stem = suf ? key.slice(0, key.length - suf.length) : key;
        const n = (a ? 1 : 0) + (b ? 1 : 0) + (c ? 1 : 0);
        const sub: Parse[] = [];
        viaPrefixes(stem, 0, n, sub);
        for (const p of sub) all.push({ ...p, pat: [...p.pat, ...[...suf].map(() => undefined)] });
      }
  if (!all.length) return null;
  all.sort((x, y) => y.score - x.score);
  return all[0];
}

/** awalan yang hampir pasti imbuhan walau kata dasarnya tidak dikenal (e di awalan = pepet) */
const STRONG: readonly { re: RegExp; at: number[]; min: number; what: string }[] = [
  { re: /^(ber|ter|per)[^aiueo]/, at: [1], min: 6, what: "ber-/ter-/per-" },
  { re: /^(meng|meny|peng|peny)/, at: [1], min: 6, what: "meng-/meny-/peng-/peny-" },
  { re: /^(mem|pem)[bpfv]/, at: [1], min: 6, what: "mem-/pem-" },
  { re: /^(men|pen)[dcjtz]/, at: [1], min: 6, what: "men-/pen-" },
  { re: /^(me|pe)[lrwy][aiueo]/, at: [1], min: 7, what: "me-/pe-" },
  { re: /^(mem|men|meng|meny|pem|pen|peng|peny)[aiueo]/, at: [1], min: 7, what: "me-/pe-" },
  { re: /^ke.{3,}an$/, at: [1], min: 7, what: "ke-…-an" },
];

// ---------------------------------------------------------------------------------------------
// tebakan
// ---------------------------------------------------------------------------------------------
/** huruf kecil per huruf (panjang tetap sama dengan kata aslinya) */
const lowerKeep = (w: string) => [...w].map((c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c)).join("");
/** kunci daftar: huruf kecil, semua jenis e jadi e */
const plainKey = (lower: string) => [...lower].map((c) => (isE(c) ? "e" : c)).join("");

const preName = (p: string) => `${p}-`;

const guessCache = new Map<string, EGuess>();
/** tebak bunyi tiap huruf e di satu kata (lihat keterangan modul) */
export function guessE(raw: string, opts: GuessOpts = {}): EGuess {
  const word = (typeof raw === "string" ? raw : "").normalize("NFC");
  const name = !!opts.name;
  const ck = name ? `\u0001${word}` : word;
  const hit = guessCache.get(ck);
  if (hit) return { ...hit, marks: hit.marks.map((m) => ({ ...m })) };
  const g = guessWord(word, name);
  if (guessCache.size > 3000) guessCache.clear();
  guessCache.set(ck, g);
  return { ...g, marks: g.marks.map((m) => ({ ...m })) };
}

function guessWord(word: string, name: boolean): EGuess {
  const lower = lowerKeep(word);
  const key = plainKey(lower);
  const at: number[] = [];
  for (let i = 0; i < lower.length; i++) if (isE(lower[i])) at.push(i);
  if (!at.length) return { word, marks: [], pepet: false, sure: true, kind: "tanpa-e", why: "Tidak ada huruf e." };

  let pat: Pat | null = null;
  let why = "";
  const p = /^\p{L}+$/u.test(key) ? parseWord(key) : null;
  if (p && p.pat.length === key.length) {
    pat = p.pat;
    const rootTxt = p.src === "ragu" ? `“${p.root}” bisa dibaca dua cara` : p.src === "dasar" ? `kata dasar “${p.root}”` : `“${p.root}” ada di daftar kata`;
    const preTxt = p.pre.length ? `Imbuhan ${p.pre.map(preName).join(" + ")}${p.pre.some((x) => x.includes("e")) ? " (e dibaca ə)" : ""} + ` : "";
    why = p.pre.length || p.suf ? `${preTxt}${rootTxt}${p.suf && !p.pre.length ? " + akhiran" : ""}.` : `${rootTxt[0].toUpperCase()}${rootTxt.slice(1)}.`;
  } else {
    // kata dasar tidak dikenal: hanya e di awalan yang hampir pasti imbuhan (di-/ke-/se- di depannya boleh). Nama diri / kata asing
    // (huruf besar di tengah kalimat: Berlin, Pentagon) bukan kata berimbuhan → tidak ditebak.
    pat = [...key].map(() => undefined);
    for (const i of at) pat[i] = null;
    const tries: { off: number; outer: boolean }[] = name ? [] : [{ off: 0, outer: false }];
    if (!name && /^(ke|se)/.test(key)) tries.push({ off: 2, outer: true });
    if (!name && /^di/.test(key)) tries.push({ off: 2, outer: false });
    for (const t of tries) {
      const rest = key.slice(t.off);
      const s = STRONG.find((x) => key.length >= x.min && x.re.test(rest));
      if (!s) continue;
      for (const i of s.at) pat[t.off + i] = "pepet";
      if (t.outer) pat[1] = "pepet";
      why = `Imbuhan ${s.what} (e dibaca ə); bagian lain tidak yakin.`;
      break;
    }
    if (!why) why = name ? "Tidak yakin — mungkin nama diri / kata asing (huruf besar di tengah kalimat)." : "Tidak yakin — kata ini tidak ada di daftar.";
  }
  // tanda yang sudah ditulis di naskah menang (é / è = taling, ê / ĕ / ə = pepet)
  const marks: EMark[] = at.map((i) => ({ at: i, kind: E_TALING.includes(lower[i]) ? "taling" : E_PEPET.includes(lower[i]) ? "pepet" : (pat?.[i] ?? null) }));
  const nP = marks.filter((m) => m.kind === "pepet").length;
  const nT = marks.filter((m) => m.kind === "taling").length;
  const nU = marks.length - nP - nT;
  const kind: EGuess["kind"] = nU === marks.length ? "ragu" : nP && nT ? "campur" : nP ? "pepet" : "taling";
  return { word, marks, pepet: nP > 0, sure: nU === 0, kind, why };
}

/** huruf pertama kapital tapi bukan kapital semua ("Berlin" ya; "BARENG" = penekanan, bukan nama) */
const capInitial = (w: string) => w[0] !== w[0].toLowerCase() && w !== w.toUpperCase();
/** tanda kutip / kurung pembuka di antara akhir kalimat dan kata berikutnya ("Halo." “Berlin …) */
const OPENERS = `"'“”‘’()[]{}«»*`;
/** kata di `at` ada di awal kalimat: sebelumnya (lewati spasi, kutip, kurung) awal teks, baris baru, atau . ! ? … */
/** singkatan gelar / sapaan bertitik ("Dr. Bertha", "Bpk. Mendoza") — titiknya bukan akhir kalimat */
const TITLE_ABBR = /(?:^|[\s"'“‘(\[])(?:dr|drs|dra|prof|bpk|bp|ibu|ir|h|hj|kh|st|sdr|sdri|tn|ny|nn|mr|mrs|ms|jl|no|pt|cv|tbk)$/i;
function sentenceStart(s: string, at: number): boolean {
  for (let i = at - 1; i >= 0; i--) {
    const c = s[i];
    if (c === "\n") return true;
    if (/\s/.test(c) || OPENERS.includes(c)) continue;
    if (c === "." && TITLE_ABBR.test(s.slice(Math.max(0, i - 6), i))) return false;
    return ".!?…".includes(c);
  }
  return true;
}

/**
 * kata ber-huruf e di teks (+ tebakannya & posisinya). Kata yang menempel angka / apostrof ("bareng2", "Wa'alaikum") dilewati —
 * kamus ejaan juga tidak mencocokkannya. Kata berhuruf besar di tengah kalimat dianggap mungkin nama diri (`name`): kata di daftar
 * tetap ditebak (hari Senin, saat Lebaran), tebakan imbuhan untuk kata tak dikenal tidak (Pentium, Mendoza).
 */
export function eWords(text: string): EToken[] {
  const out: EToken[] = [];
  const re = new RegExp("[\\p{L}\\p{M}\\p{N}'’]+", "gu");
  const s = typeof text === "string" ? text : "";
  for (const m of s.matchAll(re)) {
    const tok = m[0];
    if (/[\d'’]/.test(tok) || /\p{M}/u.test(tok)) continue;
    if (![...tok.toLowerCase()].some(isE)) continue;
    const start = m.index ?? 0;
    const name = capInitial(tok) && !sentenceStart(s, start);
    out.push({ ...guessE(tok, { name }), start, end: start + tok.length, name });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// kandidat ejaan
// ---------------------------------------------------------------------------------------------
const replaceAt = (w: string, pos: readonly number[], ch: string) => [...w].map((c, i) => (pos.includes(i) ? ch : c)).join("");
/** gugus konsonan awal yang wajar diucapkan (s'karang → skarang, t'rus → trus) */
const ONSETS = new Set(["sk", "sn", "sm", "sl", "sp", "st", "sw", "kr", "pr", "tr", "br", "dr", "gr", "kl", "pl", "bl", "gl", "fr", "fl"]);

/**
 * e pepet yang boleh dihilangkan: SATU, yang paling belakang (biasanya di kata dasar; e imbuhan me-/ber- jarang salah baca).
 * e di awal / akhir kata atau di sebelah huruf hidup tidak.
 */
function elidePos(w: string, pos: readonly number[]): number | null {
  const ok = pos.filter((i) => i > 0 && i < w.length - 1 && !isVowel(w[i - 1]) && !isVowel(w[i + 1]));
  return ok.length ? ok[ok.length - 1] : null;
}
const hasVowel = (w: string) => [...w].some((c) => isVowel(c));
/** e pepet itu diganti apostrof (bar'ng); hasil tanpa huruf hidup → null */
function elide(w: string, pos: readonly number[]): string | null {
  const at = elidePos(w, pos);
  if (at === null) return null;
  const out = replaceAt(w, [at], "'");
  return hasVowel(out) ? out : null;
}
/**
 * e pepet yang sama dibuang begitu saja, TANPA apostrof (barng, dngan, gantng) — variasi huruf biasa (ASCII) kedua.
 * Kenapa ini, bukan ĕ: mesin bank membaca per huruf dan tokenizer multibahasa bisa menormalkan ĕ / ê jadi e + tanda kecil
 * (NFKD), jadi ĕ kemungkinan terdengar sama dengan ê (sudah jadi kandidat 2). Apostrof bisa dibaca jeda / singkatan
 * ("bar ng"); tanpa apostrof huruf matinya menempel, dan gugus huruf mati di bahasa Indonesia diucapkan dengan sisipan ə
 * (tulisan singkat dgn / tmpt dibaca dəngan / təmpat) — jadi peluangnya beda dengan kandidat apostrof. Tetap lolos isPepetSpelling
 * (cuma membuang huruf e), jadi pengecek risiko kamus & garis hijau di naskah tetap jalan.
 */
function dropE(w: string, pos: readonly number[]): string | null {
  const at = elidePos(w, pos);
  if (at === null) return null;
  const out = w.slice(0, at) + w.slice(at + 1);
  return hasVowel(out) ? out : null;
}
/** e pepet di suku pertama dibuang kalau gugusnya wajar (sekarang → skarang, terus → trus, belum → blum) */
function syncope(w: string, pos: readonly number[]): string | null {
  if (!pos.includes(1) || w.length < 4) return null;
  const [c0, , c2, c3] = [...w];
  if (isVowel(c0) || isVowel(c2) || !isVowel(c3) || !ONSETS.has(c0 + c2)) return null;
  return w.slice(0, 1) + w.slice(2);
}

/**
 * Kandidat ejaan untuk satu kata (maks 5, termasuk tulisan asli di urutan pertama), huruf kecil — siap jadi entri kamus ejaan.
 * Pepet: ê, ə, apostrof (bar'ng), lalu tanpa e — suku pertama (skarang) atau e yang sama tanpa apostrof (barng). Taling: é, è.
 * Tidak yakin: dua arah (ê / é …). Tanpa e: tulisan asli saja.
 * `current` = ejaan di kamus proyek sekarang (ikut dicoba, di urutan kedua). `name` = mungkin nama diri (lihat guessE).
 */
export function spellCandidates(raw: string, opts: { current?: string | null; name?: boolean } = {}): SpellCand[] {
  const w = lowerKeep((raw ?? "").normalize("NFC").trim()).replace(new RegExp("^[^\\p{L}\\p{N}]+|[^\\p{L}\\p{N}]+$", "gu"), "");
  if (!w) return [];
  const out: SpellCand[] = [];
  const add = (text: string | null, why: string, kind: SpellCand["kind"]) => {
    const t = (text ?? "").trim();
    if (t && !out.some((c) => c.text === t) && out.length < MAX_CAND) out.push({ text: t, why, kind });
  };
  add(w, "Tulisan asli — pembanding.", "asli");
  const cur = typeof opts.current === "string" ? lowerKeep(opts.current.normalize("NFC").replace(/\s+/g, " ").trim()) : "";
  if (cur && cur !== w) add(cur, "Ejaan yang ada di 📖 Kamus sekarang.", "kamus");
  const g = guessE(w, { name: opts.name });
  const P = g.marks.filter((m) => m.kind === "pepet" && !E_PEPET.includes(w[m.at])).map((m) => m.at);
  const T = g.marks.filter((m) => m.kind === "taling" && !E_TALING.includes(w[m.at])).map((m) => m.at);
  const U = g.marks.filter((m) => m.kind === null).map((m) => m.at);
  if (P.length) {
    add(replaceAt(w, P, "ê"), "ê = tanda e pepet di ejaan lama (Jawa: bênêr) — sebagian mesin membacanya ə.", "pepet");
    add(replaceAt(w, P, "ə"), "ə = lambang bunyi pepet di kamus pengucapan.", "pepet");
    add(elide(w, P), "Huruf e dibuang pakai apostrof — mesin biasanya mengucap e sangat pendek, mirip ə.", "pepet");
    if (T.length) add(replaceAt(replaceAt(w, P, "ê"), T, "é"), "Dua-duanya ditandai: pepet ê, taling é.", "pepet");
    const short = syncope(w, P);
    if (short) add(short, "Tanpa huruf e, seperti orang bicara cepat — huruf biasa saja.", "pepet");
    else add(dropE(w, P), "Huruf e dibuang tanpa apostrof (seperti tulisan singkat dgn, tmpt) — huruf mati yang berdempetan biasanya diucapkan dengan sisipan ə.", "pepet");
  } else if (T.length) {
    add(replaceAt(w, T, "é"), "é = tanda e taling (seperti enak, sore), dipakai kamus KBBI.", "taling");
    add(replaceAt(w, T, "è"), "è = e taling yang lebih terbuka (seperti bebek, nenek).", "taling");
  } else if (U.length) {
    add(replaceAt(w, U, "ê"), "Kalau seharusnya pepet (seperti bareng): ê.", "ragu");
    add(replaceAt(w, U, "é"), "Kalau seharusnya taling (seperti enak): é.", "ragu");
    add(replaceAt(w, U, "ə"), "Pepet ditulis ə (lambang bunyi kamus).", "ragu");
    add(replaceAt(w, U, "è"), "Taling terbuka è (seperti bebek).", "ragu");
  }
  return out;
}

/**
 * Ejaan `to` hanya menandai bunyi e dari kata `from` (bukan kata lain): huruf e diberi tanda (ê ĕ ə é è), diganti apostrof
 * (bar'ng), atau maks 2 huruf e dibuang (skarang). Dipakai pengecek risiko kamus: entri ini aman walau katanya kata umum.
 */
export function isPepetSpelling(from: string, to: string): boolean {
  const norm = (s: string) => plainKey(lowerKeep((s ?? "").normalize("NFC").trim()));
  const f = norm(from);
  const t = norm(to);
  if (!f || !t || /\s/.test(f) || /\s/.test(t) || !/^\p{L}+$/u.test(f)) return false;
  if (f === t) return true;
  if (t.replace(/['’]/g, "e") === f) return true;
  if (/['’]/.test(t) || t.length >= f.length || f.length - t.length > 2) return false;
  // t = f dengan beberapa huruf e dibuang
  let i = 0;
  for (const c of f) {
    if (c === t[i]) i++;
    else if (c !== "e") return false;
  }
  return i === t.length;
}
