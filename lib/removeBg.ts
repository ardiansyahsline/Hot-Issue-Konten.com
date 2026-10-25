/**
 * Hapus latar foto tokoh langsung di browser (gratis, tanpa API berbayar): MediaPipe Image Segmenter (Apache-2.0).
 * Library & model (±3 MB) baru dimuat saat tombol dipakai, lalu tersimpan di cache browser.
 * Gagal (jaringan / perangkat lemah) -> kembalikan null; pemanggil memakai foto utuh + gradasi gelap di pinggir.
 */
const VERSION = "1.1.0";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

const FACE_MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite";

type Segmenter = { segment(img: HTMLImageElement | HTMLCanvasElement): { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[]; close?(): void } };
type FaceDet = { detect(img: HTMLCanvasElement): { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: { score: number }[] }[] } };
let segP: Promise<Segmenter> | null = null;
let faceP: Promise<FaceDet> | null = null;
let filesP: Promise<{ v: typeof import("@mediapipe/tasks-vision"); fileset: Awaited<ReturnType<typeof import("@mediapipe/tasks-vision").FilesetResolver.forVisionTasks>> }> | null = null;

/** library + wasm dimuat sekali, dipakai bersama penghapus latar & pendeteksi wajah */
function vision() {
  filesP ??= (async () => {
    const v = await import("@mediapipe/tasks-vision");
    return { v, fileset: await v.FilesetResolver.forVisionTasks(WASM) };
  })().catch((e) => {
    filesP = null;
    throw e;
  });
  return filesP;
}

async function segmenter(): Promise<Segmenter> {
  segP ??= (async () => {
    const { v, fileset } = await vision();
    return (await v.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate: "CPU" },
      runningMode: "IMAGE",
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })) as unknown as Segmenter;
  })().catch((e) => {
    segP = null;
    throw e;
  });
  return segP;
}

const load = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });

/** posisi kepala di foto (pecahan 0..1 dari lebar/tinggi foto): top = perkiraan ujung rambut, bottom = dagu */
export type Face = { top: number; bottom: number; cx: number; aspect: number };

/** cari wajah terbesar di foto (MediaPipe Face Detector, Apache-2.0) — null kalau tidak ketemu / gagal */
export async function detectFace(src: string): Promise<Face | null> {
  try {
    faceP ??= (async () => {
      const { v, fileset } = await vision();
      return (await v.FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL, delegate: "CPU" }, runningMode: "IMAGE", minDetectionConfidence: 0.5 })) as unknown as FaceDet;
    })().catch((e) => {
      faceP = null;
      throw e;
    });
    const img = await load(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    const det = await faceP;
    // model wajah "jarak dekat" -> wajah kecil (foto berita ramai) dicari lagi di potongan tengah-atas yang diperbesar
    const crops: [number, number, number, number][] = [[0, 0, 1, 1], [0.2, 0, 0.6, 0.65], [0, 0, 0.55, 0.65], [0.45, 0, 0.55, 0.65]];
    for (const [cx0, cy0, cw, ch] of crops) {
      const sw = W * cw, sh = H * ch;
      const k = Math.min(cw === 1 ? 1 : 3, 900 / Math.max(sw, sh));
      const cv = document.createElement("canvas");
      cv.width = Math.round(sw * k);
      cv.height = Math.round(sh * k);
      cv.getContext("2d")!.drawImage(img, W * cx0, H * cy0, sw, sh, 0, 0, cv.width, cv.height);
      const best = det
        .detect(cv)
        .detections.map((d) => d.boundingBox)
        .filter((b): b is NonNullable<typeof b> => !!b && b.width > 8)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (!best) continue;
      // koordinat potongan -> pecahan foto utuh; kotak deteksi mulai dari alis -> ujung kepala (+ peci/rambut) ±55% tinggi kotak di atasnya
      const fx = (x: number) => (W * cx0 + x / k) / W, fy = (y: number) => (H * cy0 + y / k) / H;
      return { top: Math.max(0, fy(best.originY - best.height * 0.55)), bottom: Math.min(1, fy(best.originY + best.height)), cx: fx(best.originX + best.width / 2), aspect: W / H };
    }
    return null;
  } catch {
    return null;
  }
}

/** foto (data URL / URL same-origin) -> PNG transparan (orang saja, dipotong rapat) atau null kalau gagal */
export async function removeBackground(src: string): Promise<string | null> {
  try {
    const img = await load(src);
    // perkecil foto besar supaya cepat (maks 1400 px sisi terpanjang)
    const k = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const cv = document.createElement("canvas");
    cv.width = w;
    cv.height = h;
    const g = cv.getContext("2d")!;
    g.drawImage(img, 0, 0, w, h);
    const res = (await segmenter()).segment(cv);
    const mask = res.confidenceMasks?.[0];
    if (!mask) return null;
    const conf = mask.getAsFloat32Array();
    const px = g.getImageData(0, 0, w, h);
    const sx = mask.width / w, sy = mask.height / h;
    let minX = w, minY = h, maxX = 0, maxY = 0, kept = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const c = conf[Math.floor(y * sy) * mask.width + Math.floor(x * sx)] ?? 0;
        // tepi halus: 0,35–0,75 dibuat setengah transparan
        let a = Math.max(0, Math.min(1, (c - 0.5) / 0.3));
        if (a < 0.25) a = 0; // sisa latar tipis dibuang (kalau tidak, cahaya pinggir membentuk kotak)
        const i = (y * w + x) * 4 + 3;
        px.data[i] = Math.round(px.data[i] * a);
        if (a > 0.5) {
          kept++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    res.close?.();
    // orang tidak terdeteksi (terlalu sedikit) atau seluruh foto dianggap orang (kerumunan / latar ramai) -> gagal
    if (kept < w * h * 0.03 || kept > w * h * 0.8) return null;
    g.putImageData(px, 0, 0);
    const pad = 8;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    const cw = Math.min(w, maxX + pad) - minX, ch = h - minY; // bawah dibiarkan (badan terpotong bingkai)
    const out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    out.getContext("2d")!.drawImage(cv, minX, minY, cw, ch, 0, 0, cw, ch);
    return out.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** file dari input upload -> data URL (gambar besar diperkecil maks 1600 px) */
export async function fileToDataUrl(f: File): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(f);
  });
  const img = await load(raw);
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && f.size < 1.5e6) return raw;
  const cv = document.createElement("canvas");
  cv.width = Math.round(img.naturalWidth * k);
  cv.height = Math.round(img.naturalHeight * k);
  cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
  return cv.toDataURL("image/jpeg", 0.9);
}
