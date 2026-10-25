import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import WebSocket from "ws";

/**
 * Edge-TTS CADANGAN: layanan "Read Aloud" Microsoft Edge (TIDAK RESMI, bisa berubah / mati kapan saja).
 * Port setia dari python edge-tts 7.3.1 (rany2/edge-tts): konstanta, header, token Sec-MS-GEC v2 (drm.py),
 * pesan speech.config + SSML, dan parsing pesan teks/biner (communicate.py).
 * Hasil: mp3 24 kHz 48 kbps mono + waktu tiap kata (WordBoundary) untuk subtitle.
 */

export type Word = { w: string; s: number; e: number };
export type EdgeResult = { mp3: Buffer; words: Word[]; dur: number };

export const EDGE_VOICES = ["id-ID-ArdiNeural", "id-ID-GadisNeural"] as const;
export type EdgeVoice = (typeof EDGE_VOICES)[number];
export const isEdgeVoice = (v: unknown): v is EdgeVoice => typeof v === "string" && (EDGE_VOICES as readonly string[]).includes(v);

// ---------- konstanta (constants.py) ----------
const BASE_URL = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WSS_HEADERS: Record<string, string> = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR}.0.0.0`,
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-Language": "en-US,en;q=0.9",
};
const TICKS = 10_000_000; // satuan Offset/Duration = 100 ns
const MP3_BPS = 48_000; // audio-24khz-48kbitrate-mono-mp3 = CBR 48 kbps
const MAX_BYTES = 4096; // batas teks per permintaan SSML (sudah di-escape)
const WIN_EPOCH = 11644473600; // detik 1601-01-01 -> 1970-01-01

// ---------- token Sec-MS-GEC v2 (drm.py): "<CS64 16 hex>-<SHA256 64 hex>" dari ticks Windows dibulatkan 5 menit ----------
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74,
  0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d,
  0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e,
  0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA_INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
// state & jadwal SHA-256 setelah 56 byte awalan rahasia (disalin dari drm.py)
const SHA_STATE = [0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2];
const SHA_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33, 0xd258b060,
  0x72766564,
];
const SHA_ADJ = 0xc9dc06a7;
const SHA_BLOCK_K = K.map((k, i) => (i === 14 ? SHA_ADJ : k));
const SIGMA0_ADJ = 0x059c0b80;
const SIGMA1_ADJ = 0x000b92c0;
const CS64_COEF: [number, number][] = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf], [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb], [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61], [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJ0 = 0xf2f90b1a;
const CS64_ADJ1 = 0x0b1a0000;

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const rol16 = (x: number) => ((x << 16) | (x >>> 16)) >>> 0;
const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
const sig0 = (x: number) => (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
const sig1 = (x: number) => (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0;

function shaRounds(st: number[], w: number[], k: number[], from = 0): number[] {
  let [a, b, c, d, e, f, g, h] = st;
  for (let i = from; i < 64; i++) {
    const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + (g ^ (e & (f ^ g))) + k[i] + w[i]) >>> 0;
    const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) | (c & (a | b)))) >>> 0;
    h = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  return [a, b, c, d, e, f, g, h];
}

function shaExpand(w: number[], from = 16) {
  for (let i = from; i < 64; i++) w.push((sig1(w[i - 2]) + w[i - 7] + sig0(w[i - 15]) + w[i - 16]) >>> 0);
}

const beInt = (b: Uint8Array) => b.reduce((v, x) => v * 256 + x, 0);

/** blok pertama: 56 byte awalan rahasia (sudah jadi SHA_STATE/SHA_SCHEDULE) + 1 byte awalan + 7 byte data */
function shaInit(d7: Uint8Array): number[] {
  const w: number[] = new Array(14).fill(0);
  w.push(beInt(d7.subarray(0, 3)), beInt(d7.subarray(3, 7)));
  for (let i = 16; i < 30; i++) {
    let v = SHA_SCHEDULE[i - 16];
    v += i === 16 ? (sig1(w[i - 2]) ^ SIGMA1_ADJ) >>> 0 : sig1(w[i - 2]);
    if (i - 7 >= 14) v += w[i - 7];
    if (i - 15 >= 14) v += i === 29 ? (sig0(w[i - 15]) ^ SIGMA0_ADJ) >>> 0 : sig0(w[i - 15]);
    w.push(v >>> 0);
  }
  w.push((sig1(w[28]) + w[23] + sig0(w[15]) + w[14] + SHA_ADJ - K[14]) >>> 0);
  shaExpand(w, 31);
  const work = shaRounds(SHA_STATE, w, SHA_BLOCK_K, 14);
  return SHA_INITIAL.map((x, i) => (x + work[i]) >>> 0);
}

function shaDigest(data: Buffer): Buffer {
  const len = 57 + data.length;
  const pad = (((55 - len) % 64) + 64) % 64;
  const tail = Buffer.alloc(data.length - 7 + 1 + pad + 8);
  data.copy(tail, 0, 7);
  tail[data.length - 7] = 0x80;
  const bits = len * 8;
  tail.writeUInt32BE(Math.floor(bits / 2 ** 32), tail.length - 8);
  tail.writeUInt32BE(bits >>> 0, tail.length - 4);
  let st = shaInit(data.subarray(0, 7));
  for (let o = 0; o < tail.length; o += 64) {
    const w: number[] = [];
    for (let j = 0; j < 16; j++) w.push(tail.readUInt32BE(o + j * 4));
    shaExpand(w);
    const work = shaRounds(st, w, K);
    st = st.map((x, i) => (x + work[i]) >>> 0);
  }
  const out = Buffer.alloc(32);
  st.forEach((x, i) => out.writeUInt32BE(x, i * 4));
  return out;
}

function cs64(data: Buffer, digest: Buffer): [number, number] {
  const ka = (digest.readUInt32LE(0) | 1) >>> 0;
  const kb = (digest.readUInt32LE(4) | 1) >>> 0;
  const fac = [mul(ka, CS64_FACTOR), mul(kb, CS64_FACTOR)];
  const terms = CS64_COEF.map(([c], i) => mul(c, fac[i % 2]));
  const offs = CS64_COEF.map(([, o]) => o);
  // kata 32-bit little-endian dari 0x00 + data, diisi nol sampai jumlahnya genap
  const raw = Buffer.concat([Buffer.from([0]), data]);
  const buf = Buffer.concat([raw, Buffer.alloc((4 - (raw.length % 4)) % 4)]);
  const words: number[] = [];
  for (let o = 0; o < buf.length; o += 4) words.push(buf.readUInt32LE(o));
  if (words.length % 2) words.push(0);
  words.forEach((wd, i) => {
    const even = i % 2 === 0;
    let term = mul(wd, even ? ka : kb);
    let off = mul(rol16(wd), even ? 0xef0569fb : 0xc31713db);
    if (i === 0) {
      term = (term + mul(CS64_ADJ0, fac[0])) >>> 0;
      off = (off + CS64_ADJ1) >>> 0;
    }
    terms.push(term);
    offs.push(off);
  });
  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;
  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i];
    const y = terms[i + 1];
    let t = rol16((offs[i] + x) >>> 0);
    let q = mul(t, 0x76f50f34);
    swapAcc += (mul(rol16(q), 0xc3efea97) + q) >>> 0;
    t = rol16((offs[i + 1] + y) >>> 0);
    q = mul(t, 0x1881ce3c);
    swapLast = (mul(rol16(q), 0x35bd1ec9) + q) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (mul(state, ka) + x) >>> 0;
    state = mul(rol16(state), 0xcf98b111);
    state = mul(rol16(state), 0x87085b9f);
    state = mul(rol16(state), 0x12ceb96d);
    state = mul(rol16(state), 0x257e1d83);
    acc += state;
    t = (mul(state, kb) + y) >>> 0;
    t = mul(rol16(t), 0xa27416f5);
    t = mul(rol16(t), 0xd38396ff);
    state = mul(rol16(mul(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }
  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

/** koreksi jam server (detik) — diisi dari header Date saat server membalas 403 */
let clockSkew = 0;
const nowSec = () => Date.now() / 1000 + clockSkew;

/** Token Sec-MS-GEC. `unix` hanya untuk tes (detik Unix); default = jam sekarang + koreksi skew. */
export function secMsGec(unix?: number): string {
  let t = (unix ?? nowSec()) + WIN_EPOCH;
  t -= t % 300; // bulatkan ke bawah per 5 menit
  t *= 1e7; // detik -> 100 ns (pasti bulat & presisi: kelipatan 3e9 < 2^57)
  const data = Buffer.from(`${t.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`, "ascii");
  const digest = shaDigest(data);
  const [lo, hi] = cs64(data, digest);
  const c = Buffer.alloc(8);
  c.writeUInt32LE(lo, 0);
  c.writeUInt32LE(hi, 4);
  return `${c.toString("hex").toUpperCase()}-${digest.toString("hex").toUpperCase()}`;
}

// ---------- teks & SSML (communicate.py) ----------
/** karakter kontrol yang ditolak layanan (mis. vertical tab dari PDF) -> spasi */
const cleanText = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ");
const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unescapeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** pecah teks (sudah di-escape) per maks 4096 byte: utamakan baris baru/spasi, jangan potong UTF-8 / entitas XML */
function splitBytes(text: string, limit = MAX_BYTES): string[] {
  let b = Buffer.from(text, "utf8");
  const out: string[] = [];
  const push = (x: Buffer) => {
    const s = x.toString("utf8").trim();
    if (s) out.push(s);
  };
  while (b.length > limit) {
    let at = b.lastIndexOf(0x0a, limit - 1);
    if (at < 0) at = b.lastIndexOf(0x20, limit - 1);
    if (at < 0) {
      // tidak ada spasi: mundur sampai batas karakter UTF-8 utuh
      at = limit;
      while (at > 0 && (b[at] & 0xc0) === 0x80) at--;
    }
    // jangan memotong di tengah entitas seperti &amp;
    while (at > 0) {
      const amp = b.lastIndexOf(0x26, at - 1);
      if (amp < 0) break;
      const semi = b.indexOf(0x3b, amp);
      if (semi !== -1 && semi < at) break;
      at = amp;
    }
    push(b.subarray(0, at));
    b = b.subarray(at > 0 ? at : 1);
  }
  push(b);
  return out;
}

/** "id-ID-ArdiNeural" -> nama lengkap seperti yang dikirim Microsoft Edge */
function fullVoiceName(v: string): string {
  const m = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(v);
  if (!m) return v;
  const lang = m[1];
  let region = m[2];
  let name = m[3];
  const dash = name.indexOf("-");
  if (dash !== -1) {
    region = `${region}-${name.slice(0, dash)}`;
    name = name.slice(dash + 1);
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const p2 = (n: number) => String(n).padStart(2, "0");
/** tanggal gaya JavaScript (UTC), sama seperti date_to_string() di python */
function jsDate(d = new Date()): string {
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

const connectId = () => randomUUID().replace(/-/g, "");

const configMsg = () =>
  `X-Timestamp:${jsDate()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
  `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`;

const ssmlMsg = (voice: string, rate: string, pitch: string, escaped: string) =>
  `X-RequestId:${connectId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${jsDate()}Z\r\nPath:ssml\r\n\r\n` + // "Z" ekstra memang bawaan Edge
  `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${fullVoiceName(voice)}'>` +
  `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escaped}</prosody></voice></speak>`;

function parseHeaders(s: string): Record<string, string> {
  const h: Record<string, string> = {};
  for (const line of s.split("\r\n")) {
    const i = line.indexOf(":");
    if (i > 0) h[line.slice(0, i)] = line.slice(i + 1);
  }
  return h;
}

class SkewError extends Error {}

type Chunk = { audio: Buffer[]; bytes: number; words: Word[] };

/** satu koneksi WebSocket = satu potong teks (sama seperti python: koneksi baru per potong) */
function streamChunk(url: string, voice: string, rate: string, pitch: string, escaped: string, offset: number, deadline: number): Promise<Chunk> {
  return new Promise((resolve, reject) => {
    const res: Chunk = { audio: [], bytes: 0, words: [] };
    const full = `${url}&ConnectionId=${connectId()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;
    const ws = new WebSocket(full, {
      headers: { ...WSS_HEADERS, Cookie: `muid=${randomBytes(16).toString("hex").toUpperCase()};` },
      perMessageDeflate: true,
      handshakeTimeout: Math.max(1000, Math.min(10_000, deadline - Date.now())),
    });
    let done = false;
    const finish = (err: Error | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        if (!err && ws.readyState === WebSocket.OPEN) ws.close();
        else ws.terminate();
      } catch {
        /* sudah tertutup */
      }
      if (err) reject(err);
      else if (!res.bytes) reject(new Error("edge-tts: tidak ada audio yang diterima"));
      else resolve(res);
    };
    const timer = setTimeout(() => finish(new Error("edge-tts: waktu habis")), Math.max(0, deadline - Date.now()));

    ws.on("unexpected-response", (_req, r) => {
      // 403 = jam server beda (token Sec-MS-GEC kedaluwarsa) -> koreksi dari header Date lalu coba sekali lagi
      const status = r.statusCode ?? 0;
      const date = r.headers.date;
      r.resume();
      if (status === 403) {
        const server = date ? Date.parse(date) / 1000 : NaN;
        if (Number.isFinite(server)) {
          clockSkew += server - nowSec();
          return finish(new SkewError("edge-tts: 403, jam dikoreksi"));
        }
      }
      finish(new Error(`edge-tts: server membalas ${status}`));
    });
    ws.on("error", (e) => finish(e instanceof Error ? e : new Error(String(e))));
    ws.on("close", () => finish(new Error("edge-tts: koneksi tertutup sebelum selesai")));
    ws.on("open", () => {
      ws.send(configMsg());
      ws.send(ssmlMsg(voice, rate, pitch, escaped));
    });
    ws.on("message", (data, isBinary) => {
      if (done) return;
      try {
        const buf = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data);
        if (!isBinary) {
          const s = buf.toString("utf8");
          const at = s.indexOf("\r\n\r\n");
          const h = parseHeaders(at < 0 ? s : s.slice(0, at));
          const body = at < 0 ? "" : s.slice(at + 4);
          if (h.Path === "audio.metadata") {
            const meta = JSON.parse(body) as { Metadata?: { Type?: string; Data?: { Offset?: number; Duration?: number; text?: { Text?: string } } }[] };
            for (const m of meta.Metadata ?? []) {
              if (m.Type !== "WordBoundary" && m.Type !== "SentenceBoundary") continue; // SessionEnd dll dilewati
              const off = Number(m.Data?.Offset ?? 0) + offset;
              const len = Number(m.Data?.Duration ?? 0);
              const w = unescapeXml(String(m.Data?.text?.Text ?? "")).trim();
              if (w) res.words.push({ w, s: off / TICKS, e: (off + len) / TICKS });
            }
          } else if (h.Path === "turn.end") {
            finish(null);
          }
          // "response" & "turn.start" tidak perlu diapa-apakan
          return;
        }
        // biner: 2 byte panjang header (big-endian), header teks, lalu potongan audio
        if (buf.length < 2) throw new Error("edge-tts: pesan biner tanpa panjang header");
        const hl = buf.readUInt16BE(0);
        if (hl + 2 > buf.length) throw new Error("edge-tts: panjang header melebihi data");
        const h = parseHeaders(buf.subarray(2, 2 + hl).toString("utf8"));
        const audio = buf.subarray(2 + hl);
        if (h.Path !== "audio") throw new Error("edge-tts: pesan biner bukan audio");
        const ct = h["Content-Type"];
        if (ct === undefined) {
          if (audio.length === 0) return; // penanda akhir stream
          throw new Error("edge-tts: audio tanpa Content-Type");
        }
        if (ct !== "audio/mpeg") throw new Error(`edge-tts: Content-Type tak terduga ${ct}`);
        if (audio.length === 0) throw new Error("edge-tts: potongan audio kosong");
        res.audio.push(Buffer.from(audio));
        res.bytes += audio.length;
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

export type EdgeOpts = {
  voice?: string;
  /** "+0%", "-10%", "+15%" */
  rate?: string;
  /** "+0Hz", "-5Hz" */
  pitch?: string;
  timeoutMs?: number;
  /** HANYA untuk tes lokal (server tiruan); default = server Microsoft */
  _url?: string;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Ubah teks jadi suara lewat Edge-TTS. Lempar Error kalau layanan tidak bisa dihubungi / waktu habis (default 25 dtk total).
 */
export async function edgeTts(text: string, o: EdgeOpts = {}): Promise<EdgeResult> {
  const voice = isEdgeVoice(o.voice) ? o.voice : "id-ID-ArdiNeural";
  const rate = o.rate && /^[+-]\d{1,3}%$/.test(o.rate) ? o.rate : "+0%";
  const pitch = o.pitch && /^[+-]\d{1,3}Hz$/.test(o.pitch) ? o.pitch : "+0Hz";
  const url = o._url ?? WSS_URL;
  const deadline = Date.now() + (o.timeoutMs ?? 25_000);
  const parts = splitBytes(escapeXml(cleanText(text)));
  if (!parts.length) throw new Error("edge-tts: teks kosong");

  const audio: Buffer[] = [];
  const words: Word[] = [];
  let total = 0; // byte audio kumulatif -> kompensasi offset antar potong (CBR, persis seperti python)
  for (const part of parts) {
    const offset = Math.floor((total * 8 * TICKS) / MP3_BPS);
    let c: Chunk;
    try {
      c = await streamChunk(url, voice, rate, pitch, part, offset, deadline);
    } catch (e) {
      if (!(e instanceof SkewError)) throw e;
      c = await streamChunk(url, voice, rate, pitch, part, offset, deadline);
    }
    audio.push(...c.audio);
    words.push(...c.words);
    total += c.bytes;
  }
  const dur = Math.max(total / (MP3_BPS / 8), words.length ? words[words.length - 1].e : 0);
  return {
    mp3: Buffer.concat(audio),
    words: words.map((x) => ({ w: x.w, s: round3(x.s), e: round3(x.e) })),
    dur: round3(dur),
  };
}
