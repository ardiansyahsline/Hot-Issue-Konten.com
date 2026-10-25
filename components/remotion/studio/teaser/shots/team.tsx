"use client";

/**
 * Adegan 5 "Chat tim" (6,0 dtk) & adegan 9 "Musik + laporan/PPT" (4,2 dtk) teaser CS Tracker.
 * UI = komponen website asli yang dibuat ulang (lihat team-parts.tsx), kamera virtual + beat sync ke SFX lib/studio/teaser.ts:
 *  chat  : notif-chat 0,3 / 1,2 / 2,1 / 3,0 (bubble Alif, Derencalibur, Nengok, Irsyad) · ui-accept-boing 3,9 (reaksi 🔥 pop)
 *          · ui-pop 4,8 (Natasha kirim screenshot chat clipper — identitas clipper buram)
 *  musik : ui-plucks-happy 0,6 (popover 🎵 Musik terbuka & memutar, EQ ikut 100 BPM) · kertas-balik-halaman 2,4 (slide PPT dibalik 3D)
 */
import { AbsoluteFill } from "remotion";
import { Glow, Shine } from "../../fx";
import { Cam, camAtTime, Caption, Depth, EASE, Flash, rgba, sixWords, springAt, useShot, type CamKey } from "../kit";
import { ChatPanel, CLIP_AR, ClipperChat, DeckCardView, EM, Emo, MeteorsFx, MusicPopover, OR, PageGhost, PhoneHeader, pr, Scaled, sp, spc, UAvatar, ZN } from "./team-parts";

/** keyframe kamera yang membidik titik dunia (px, y) ke titik layar (sx, sy) pada zoom z (origin = tengah kanvas) */
const aim = (W: number, H: number, px: number, py: number, z: number, sx: number, sy: number) => ({ z, x: sx - (W / 2 + (px - W / 2) * z), y: sy - (H / 2 + (py - H / 2) * z) });

/** gelapkan area di bawah caption supaya UI yang terdorong kamera tidak bertabrakan dengan teks layar */
function TopScrim({ y, bg }: { y: number; bg: string }) {
  return <AbsoluteFill style={{ pointerEvents: "none", background: `linear-gradient(180deg, ${rgba(bg, 0.985)} 0px, ${rgba(bg, 0.96)} ${Math.round(y - 30)}px, ${rgba(bg, 0)} ${Math.round(y + 90)}px)` }} />;
}

/** pudarkan UI yang menjulur ke bawah box (ekor popover / catatan kaki) supaya subtitle VO & area UI TikTok tetap bersih */
function BottomScrim({ y, bg }: { y: number; bg: string }) {
  return <AbsoluteFill style={{ pointerEvents: "none", background: `linear-gradient(180deg, ${rgba(bg, 0)} ${Math.round(y)}px, ${rgba(bg, 0.82)} ${Math.round(y + 150)}px, ${rgba(bg, 0.9)} 100%)` }} />;
}

// =============================================================================================
// ADEGAN 5 — CHAT TIM
// =============================================================================================
const C_S = 2.2; // CSS px → px kanvas
const C_PW = 372; // lebar HP (CSS px) — 818 px kanvas, push-in ≤1,05 tetap di dalam x 64..930

export function ChatShot() {
  const { f, fps, s, box, W, H, brand, text } = useShot();
  const capBottom = box.y + 104;
  const pTop = box.y + 150;
  // tepi bawah panel di 95% box: composer di atas ruang subtitle, bubble terbaru selalu DI ATAS 12% bawah box (dengan/tanpa VO)
  const pBottom = Math.round(box.y + box.h * 0.95);
  const PH = Math.round((pBottom - pTop) / C_S);
  const pW = C_PW * C_S;
  const pLeft = box.x + (box.w - pW) / 2;
  const cx = box.x + box.w / 2;
  // kamera mengunci tepi bawah panel; offset y ≤ 0 (push-in tidak pernah mendorong composer ke bawah)
  const cb = (z: number, dy: number) => aim(W, H, cx, pBottom, z, cx, pBottom + dy);
  const keys: CamKey[] = [
    { t: 0, ...cb(1.07, 60), r: -1.0 },
    // masih bergerak setelah transisi mask terbuka (±0,25 dtk)
    { t: 0.55, ...cb(1.0, 0), r: 0, ease: EASE.out },
    { t: 1.27, ...cb(1.0, 0) },
    { t: 1.55, ...cb(1.015, -4), ease: EASE.inOut },
    { t: 2.17, ...cb(1.015, -4) },
    { t: 2.45, ...cb(1.03, -8), ease: EASE.inOut },
    { t: 3.07, ...cb(1.03, -8) },
    // dorong masuk ke QuickBar (antisipasi reaksi 3,9)
    { t: 3.6, ...cb(1.05, -14), ease: EASE.inOut },
    { t: 4.35, ...cb(1.05, -16), ease: EASE.soft },
    // tarik balik untuk lampiran Natasha (4,8)
    { t: 4.78, ...cb(1.0, -4), ease: EASE.inOut },
    { t: 6.2, ...cb(0.99, -4), ease: EASE.soft },
  ];
  // panel masuk: naik + miring 3D → tegak (pegas), mulai setelah mask mulai membuka
  const enter = springAt(f, fps, 0.1, { damping: 16, stiffness: 150, mass: 0.85 });
  // lightbox: gambar terangkat dari bubble lalu membesar (4,95 → mendarat ±5,3), lalu dorong pelan sampai cut
  const LB = 4.95;
  const q = sp(s, LB, 1, 0.55, 15);
  const dof = 9 * pr(s, LB - 0.05, LB + 0.35, EASE.out);
  const cam = camAtTime(keys, Math.min(s, LB));
  const imgW = 226 * C_S;
  const imgH = imgW * CLIP_AR;
  const imgX = pLeft + 50 * C_S;
  const imgY = pBottom - (67 + 16 + 60 + 6) * C_S - imgH;
  const toScreen = (px: number, py: number) => ({ x: W / 2 + (px - W / 2) * cam.z + cam.x, y: H / 2 + (py - H / 2) * cam.z + cam.y });
  const st = toScreen(imgX, imgY);
  const sW = imgW * cam.z;
  // tata letak lightbox (AttachmentGallery Lightbox): bar atas pengirim + gambar + label privasi, terpusat di area berguna box
  const BAR = 72;
  const G1 = 22;
  const G2 = 30;
  const PILL = 72;
  const top0 = capBottom + 44;
  const bot0 = box.y + box.h * 0.88;
  const avail = bot0 - top0;
  const tW = Math.min(box.w - 40, 820, (avail - BAR - G1 - G2 - PILL) / CLIP_AR);
  const tH = tW * CLIP_AR;
  const sTop = top0 + Math.max(0, (avail - (BAR + G1 + tH + G2 + PILL)) / 2);
  const tX = cx - tW / 2;
  const tY = sTop + BAR + G1;
  const cw = sW + (tW - sW) * q;
  const ccx = st.x + (tX - st.x) * q;
  const ccy = st.y + (tY - st.y) * q;
  const arc = Math.sin(Math.PI * Math.min(1, q)) * -40; // lintasan melengkung
  // blur gerak sebanding kecepatan terbang kartu (px/frame)
  const q2 = sp(s + 1 / 30, LB, 1, 0.55, 15);
  const vel = Math.hypot((tX - st.x) * (q2 - q), (tY - st.y) * (q2 - q)) + Math.abs((tW - sW) * (q2 - q));
  const cardBlur = Math.min(7, Math.max(0, vel - 10) * 0.08);
  const hold = pr(s, LB + 0.4, 6.05, (x) => x);
  const uiIn = pr(s, LB + 0.22, LB + 0.5);
  const uiY = (1 - pr(s, LB + 0.22, LB + 0.55, EASE.out)) * 26;
  const glowK = 0.35 + 0.25 * Math.max(...[0.3, 1.2, 2.1, 3.0].map((a) => (s >= a ? Math.max(0, 1 - (s - a) / 0.5) : 0)));
  return (
    <AbsoluteFill>
      <Depth blur={dof}>
        <Cam keys={keys}>
          <Glow x={cx} y={pTop + (pBottom - pTop) * 0.62} r={760} color={brand.primary} opacity={glowK} />
          <div style={{ position: "absolute", left: pLeft, top: pTop, width: pW, height: pBottom - pTop, transformOrigin: "50% 100%", transform: `perspective(1600px) translateY(${((1 - enter) * 160).toFixed(1)}px) rotateX(${((1 - enter) * 14).toFixed(2)}deg) scale(${(0.94 + 0.06 * enter).toFixed(4)})`, opacity: Math.min(1, enter * 1.6) }}>
            <Scaled x={0} y={0} w={C_PW} h={PH} scale={C_S}>
              <ChatPanel s={s} w={C_PW} h={PH} />
            </Scaled>
          </div>
        </Cam>
      </Depth>
      {/* lightbox: latar gelap + screenshot besar (nama & foto clipper buram) */}
      {q > 0.001 && (
        <>
          <AbsoluteFill style={{ background: `rgba(0,0,0,${(0.8 * Math.min(1, q * 1.4)).toFixed(3)})` }} />
          <AbsoluteFill style={{ transformOrigin: `${cx.toFixed(0)}px ${(tY + tH / 2).toFixed(0)}px`, transform: `translateY(${(-12 * hold).toFixed(2)}px) scale(${(1 + 0.04 * hold).toFixed(4)})` }}>
            {/* bar atas Lightbox: pengirim + nama file + Unduh + ✕ */}
            <div style={{ position: "absolute", left: tX, top: sTop, width: tW, height: BAR, display: "flex", alignItems: "center", gap: 20, opacity: uiIn, transform: `translateY(${uiY.toFixed(1)}px)`, fontFamily: "Inter Variable, sans-serif", color: "#fff" }}>
              <UAvatar name="Natasha" size={60} />
              <div style={{ minWidth: 0, flex: 1, lineHeight: 1.2 }}>
                <div style={{ fontSize: 32, fontWeight: 700 }}>Natasha · 09.43</div>
                <div style={{ fontSize: 25, color: "rgba(255,255,255,0.6)" }}>ss-chat-clipper.jpg · baru saja</div>
              </div>
              <span style={{ borderRadius: 16, background: "rgba(255,255,255,0.15)", padding: "10px 22px", fontSize: 26, fontWeight: 600 }}>Unduh</span>
              <span style={{ fontSize: 36, color: "rgba(255,255,255,0.8)", padding: "0 6px" }}>✕</span>
            </div>
            <div style={{ position: "absolute", left: ccx, top: ccy + arc, width: cw, height: cw * CLIP_AR, borderRadius: 12 + 10 * q, overflow: "hidden", boxShadow: `0 0 0 ${(1 + q).toFixed(1)}px ${ZN[700]}, 0 50px 120px -30px rgba(0,0,0,0.9), 0 0 ${(80 * q).toFixed(0)}px -20px ${rgba(OR[500], 0.5)}`, transform: `rotate(${((1 - Math.min(1, q)) * -4).toFixed(2)}deg)`, filter: cardBlur > 0.3 ? `blur(${cardBlur.toFixed(2)}px)` : undefined }}>
              <div style={{ width: 300, height: 300 * CLIP_AR, transform: `scale(${(cw / 300).toFixed(4)})`, transformOrigin: "0 0" }}>
                <ClipperChat w={300} h={300 * CLIP_AR} />
              </div>
              <Shine p={pr(s, LB + 0.38, LB + 0.95)} alpha={0.35} />
              <Shine p={pr(s, 5.6, 6.05)} alpha={0.22} />
            </div>
            {/* label privasi (satu-satunya) */}
            <div style={{ position: "absolute", left: tX, width: tW, top: tY + tH + G2, height: PILL, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 14, borderRadius: 999, padding: "14px 28px", background: rgba(ZN[900], 0.92), border: `2px solid ${rgba(OR[500], 0.55)}`, fontFamily: "Inter Variable, sans-serif", fontSize: 34, fontWeight: 700, color: ZN[100], opacity: pr(s, LB + 0.3, LB + 0.55), transform: `translateY(${((1 - pr(s, LB + 0.3, LB + 0.6, EASE.out)) * 30).toFixed(1)}px)` }}>
                <Emo c="🔒" /> Identitas clipper diburamkan
              </span>
            </div>
          </AbsoluteFill>
        </>
      )}
      <Flash at={4.8} len={0.16} max={0.12} />
      <TopScrim y={capBottom} bg={brand.bg} />
      <Caption lines={[sixWords(text[0] ?? "Satu tempat, real-time")]} at={0.15} size={78} emphasis={["real-time"]} />
    </AbsoluteFill>
  );
}

// =============================================================================================
// ADEGAN 9 — MUSIK + LAPORAN / PPT
// =============================================================================================
const M_S = 2.1;
/** skala kartu PPT: 800 px kanvas → push-in sampai 1,06 tetap di dalam x 64..930 */
const D_S = 2.0;
const PLAY = 0.6; // ui-plucks-happy
const FLIP = 2.4; // kertas-balik-halaman
const PRESS = 3.6; // ketukan: tombol ⬇ Unduh PowerPoint ditekan

/**
 * caption kinetik "karaoke": semua kata naik redup di awal, lalu tiap kata MENYALA tepat di ketukannya
 * (pegas skala + cahaya) — gaya huruf sama dengan Caption kit (Jakarta 800, -0.035em, 1 baris di zona aman).
 */
function BeatCaption({ words, size = 92 }: { words: [string, number, boolean?][]; size?: number }) {
  const { f, fps, box, brand, display } = useShot();
  const s = f / fps;
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, display: "flex", justifyContent: "center", columnGap: size * 0.27, flexWrap: "wrap", pointerEvents: "none", fontFamily: display, fontWeight: 800, fontSize: size, lineHeight: 1.04, letterSpacing: "-0.035em" }}>
      {words.map(([w, at, em], i) => {
        const rise = springAt(f, fps, 0.08 + i * 0.06, { damping: 14, stiffness: 160, mass: 0.7 });
        const lit = s >= at - 1 / 30 ? 1 : 0;
        const pop = lit ? sp(s, at - 1 / 30, 1, 0.32, 30) : 0;
        // pop kecil (maks ±8%) supaya jarak antar kata tetap terjaga
        const k = lit ? 1 + 0.08 * Math.sin(Math.min(1, (s - at + 1 / 30) / 0.3) * Math.PI) * (0.6 + 0.4 * pop) : 1;
        const glow = lit ? Math.max(0, 1 - (s - at) / 0.6) : 0;
        const col = lit ? (em ? brand.primary : brand.text) : rgba(brand.text, 0.22);
        return (
          <span key={w} style={{ display: "inline-block", overflow: rise < 0.985 ? "hidden" : "visible", paddingBottom: size * 0.08 }}>
            <span style={{ display: "inline-block", transform: `translateY(${((1 - rise) * size * 1.05).toFixed(1)}px) scale(${k.toFixed(4)})`, transformOrigin: "50% 70%", color: col, textShadow: `0 6px 34px rgba(0,0,0,0.45)${glow > 0 ? `, 0 0 ${(44 * glow).toFixed(0)}px ${rgba(em ? brand.primary : "#ffffff", 0.6 * glow)}` : ""}` }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
}

export function MusicReportShot() {
  const { s, box, W, H, brand } = useShot();
  const capBottom = box.y + 118;
  const hW = 390 * M_S;
  const hX = box.x + (box.w - hW) / 2;
  const hY = box.y + 170;
  const navBottom = hY + 102 * M_S; // bawah baris nav (CSS 102)
  const popW = 300 * M_S;
  const popX = hX + hW - 16 * M_S - popW;
  const popY = navBottom + 8 * M_S;
  const deckW = 400 * D_S;
  const deckX = box.x + (box.w - deckW) / 2;
  const deckY = popY + 640 * M_S + 240;
  const deckH = 490 * D_S; // termasuk baris "✓ Tersimpan…" + catatan kaki
  const cx = box.x + box.w / 2;
  // layar: tepi atas kartu PPT ≥ 80 px di bawah caption (header kartu tidak tertutup / tidak mengintip)
  const deckTop = capBottom + 84;
  // versi ber-VO (box lebih pendek karena ruang subtitle): seluruh kartu tetap muat sampai 95% box
  const fitK = Math.min(1, (box.y + box.h * 0.95 - deckTop) / (deckH * 1.06));
  const dk = (z: number, dy = 0) => aim(W, H, cx, deckY, z * fitK, cx, deckTop + dy);
  const note = { x: hX + hW - 16 * M_S - 4 - 25 * M_S, y: hY + 79 * M_S };
  const atNote = aim(W, H, note.x, note.y, 1.1, note.x - 34, note.y + 16);
  const keys: CamKey[] = [
    { t: 0, ...aim(W, H, note.x, note.y, 1.02, note.x - 10, note.y + 40), r: 0.8 },
    // antisipasi: kamera mendekat pelan ke tombol 🎵 sebelum diketuk
    { t: 0.5, ...atNote, r: 0, ease: EASE.soft },
    // DIAM di sekitar pukulan pluck 0,6 → popover terbaca tajam tanpa blur gerak
    { t: 0.7, ...atNote },
    // lalu mundur (gerak lawan) memperlihatkan pemutar
    { t: 1.2, ...aim(W, H, cx, popY, 1.0, cx, popY - 40), ease: EASE.inOut },
    { t: 1.85, ...aim(W, H, cx, popY, 1.03, cx, popY - 150), ease: EASE.soft },
    // whip turun ke kartu PPT (blur gerak otomatis), mendarat sebelum halaman dibalik
    { t: 2.17, ...dk(0.93, 40), ease: EASE.whip },
    { t: 2.4, ...dk(0.95), ease: EASE.out },
    { t: 3.0, ...dk(0.965), ease: EASE.soft },
    // diam ±2 frame di ketukan 3,0 ("PPT" + sapuan cahaya tombol Unduh tajam), lalu dorong bertahap
    { t: 3.07, ...dk(0.967) },
    { t: 3.3, ...dk(1.0, -4), ease: EASE.inOut },
    // mendarat 2 frame sebelum tombol Simpan ditekan (3,6)
    { t: 3.53, ...dk(1.035, -8), ease: EASE.inOut },
    { t: 4.4, ...dk(1.06, -12), ease: EASE.soft },
  ];
  // popover: pegas kaku mulai 2 frame sebelum pluck → ≥0,9 di frame SFX, puncak overshoot +1 frame
  const open = sp(s, PLAY - 2 / 30, 1, 0.45, 32);
  // tombol 🎵 ditekan (antisipasi) 0,45 → dilepas tepat setelah pukulan
  const press = s > 0.45 && s < 0.62 ? Math.sin(Math.PI * pr(s, 0.45, 0.62, EASE.soft)) : 0;
  const ring = pr(s, PLAY - 1 / 30, PLAY + 0.42, EASE.out);
  const playing = s >= PLAY - 1 / 30 ? 1 : 0;
  const beatK = Math.pow(1 - (((s % 0.6) + 0.6) % 0.6) / 0.6, 2.4);
  const deckIn = spc(s, 1.85, 14);
  return (
    <AbsoluteFill>
      {playing > 0 && <MeteorsFx s={s} from={PLAY} W={W} H={H} />}
      <Cam keys={keys}>
        {/* cahaya musik (emerald) berdenyut di ketukan */}
        <Glow x={popX + popW / 2} y={popY + 260 * M_S} r={720} color={EM[500]} opacity={playing ? 0.14 + 0.22 * beatK * Math.min(1, open) : 0} />
        <Glow x={cx} y={deckY + deckH / 2} r={840} color={OR[500]} opacity={0.1 + 0.3 * deckIn} />
        <Scaled x={hX} y={hY + 112 * M_S} w={390} scale={M_S} style={{ filter: `blur(${(2 + 5 * Math.min(1, open)).toFixed(2)}px)`, opacity: 0.55 - 0.2 * Math.min(1, open) }}>
          <PageGhost />
        </Scaled>
        <Scaled x={hX} y={hY} w={390} scale={M_S}>
          <PhoneHeader s={s} playing={playing} press={press} />
        </Scaled>
        {/* ripple ketukan di tombol 🎵 (mulai 1 frame sebelum pluck) */}
        {ring > 0 && ring < 1 && <div style={{ position: "absolute", left: note.x - 34 - 70 * ring, top: note.y - 34 - 70 * ring, width: 68 + 140 * ring, height: 68 + 140 * ring, borderRadius: 999, border: `5px solid ${rgba(EM[400], 0.85 * (1 - ring))}` }} />}
        {open > 0.001 && (
          <Scaled x={popX + popW - 300} y={popY} w={300} scale={M_S * (0.55 + 0.45 * open)} origin="100% 0" style={{ opacity: Math.min(1, open * 1.8) }}>
            <MusicPopover s={s} playAt={PLAY} />
          </Scaled>
        )}
        <Scaled x={deckX} y={deckY} w={400} scale={D_S} style={{ opacity: Math.min(1, 0.25 + deckIn), transform: `translateY(${((1 - deckIn) * 120).toFixed(1)}px) scale(${D_S})` }}>
          <DeckCardView s={s} flipAt={FLIP} pressAt={PRESS} shineAt={3.0} />
        </Scaled>
      </Cam>
      <Flash at={FLIP} len={0.14} max={0.08} />
      <TopScrim y={capBottom} bg={brand.bg} />
      <BottomScrim y={box.y + box.h * 0.93} bg={brand.bg} />
      <BeatCaption
        words={[
          ["Musik,", PLAY],
          ["laporan,", FLIP],
          ["PPT", 3.0, true],
        ]}
      />
    </AbsoluteFill>
  );
}
