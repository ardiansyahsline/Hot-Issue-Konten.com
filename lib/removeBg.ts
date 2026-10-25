/**
 * Hapus latar foto tokoh langsung di browser (gratis, tanpa API berbayar): MediaPipe Image Segmenter (Apache-2.0).
 * Library & model (±3 MB) baru dimuat saat tombol dipakai, lalu tersimpan di cache browser.
 * Gagal (jaringan / perangkat lemah) -> kembalikan null; pemanggil memakai foto utuh + gradasi gelap di pinggir.
 */
const VERSION = "1.1.0";
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

type Segmenter = { segment(img: HTMLImageElement | HTMLCanvasElement): { confidenceMasks?: { width: number; height: number; getAsFloat32Array(): Float32Array }[]; close?(): void } };
let segP: Promise<Segmenter> | null = null;

async function segmenter(): Promise<Segmenter> {
  segP ??= (async () => {
    const v = await import("@mediapipe/tasks-vision");
    const fileset = await v.FilesetResolver.forVisionTasks(WASM);
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
