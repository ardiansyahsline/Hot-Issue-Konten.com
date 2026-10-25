"use client";
/**
 * Gambar / klip yang boleh gagal dimuat. <Img> Remotion tanpa onError memanggil cancelRender setelah percobaan ulang habis,
 * jadi satu logo / foto 404 membatalkan seluruh render. Hook ini memberi src yang aman dipakai + handler onError:
 * setelah gagal, src jadi null dan komponen menampilkan cadangannya (inisial brand / bidang warna).
 *
 *   const [logo, onLogoError] = useImgFallback(brand.logo ? res(brand.logo) : null);
 *   {logo ? <Img src={logo} onError={onLogoError} /> : <Inisial />}
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useDelayRender } from "remotion";

export function useImgFallback(src: string | null | undefined): [string | null, () => void] {
  const [bad, setBad] = useState<string | null>(null);
  const ok = src && src !== bad ? src : null;
  const onError = useCallback(() => setBad(src ?? null), [src]);
  return [ok, onError];
}

/**
 * Cek dulu apakah file media masih ada (GET 1 byte) sebelum <Video> dipasang — khusus saat render.
 * <Video> @remotion/media yang gagal memuat file: di render browser (renderMediaOnWeb) langsung cancelRender tanpa memanggil onError,
 * di render laptop jatuh ke <OffthreadVideo> yang menolak `loop` tanpa durasi → render batal. Jadi klip upload yang sudah dihapus
 * (404) harus ketahuan SEBELUM <Video> dipasang. Selama dicek, frame ditahan (delayRender); hasilnya:
 *   - status bukan 2xx / galat jaringan → `onFail()` (komponen menampilkan cadangan)
 *   - batas waktu habis (server lambat) → dianggap ada, biar <Video> yang mencoba seperti biasa
 * Kembalian `true` = sudah boleh memasang <Video>. src null → langsung true (tidak ada yang dicek).
 */
export function useMediaProbe(src: string | null, onFail: () => void, timeoutMs = 15000): boolean {
  const { delayRender, continueRender } = useDelayRender();
  const [checked, setChecked] = useState<string | null>(null);
  const handle = useRef<number | null>(null);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  useLayoutEffect(() => {
    if (!src || checked === src) return;
    const h = delayRender(`Cek file media ${src}`);
    handle.current = h;
    const ctl = new AbortController();
    let done = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeoutMs);
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ok) failRef.current();
      // handle dilepas di efek di bawah, SETELAH <Video> / cadangan terpasang (kalau dilepas di sini ada jeda tanpa handle → frame kosong bisa terfoto)
      setChecked(src);
    };
    fetch(src, { headers: { Range: "bytes=0-0" }, signal: ctl.signal })
      .then((r) => {
        finish(r.ok);
        ctl.abort(); // cukup status-nya, isi file tidak perlu diunduh
      })
      .catch(() => finish(timedOut));
    return () => {
      done = true;
      clearTimeout(timer);
      ctl.abort();
      if (handle.current === h) {
        handle.current = null;
        continueRender(h);
      }
    };
    // `checked` sengaja tidak jadi dependensi: efek ini hanya mulai cek saat src berganti
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, delayRender, continueRender, timeoutMs]);

  // efek induk jalan setelah efek anak (<Video> sudah memanggil delayRender-nya sendiri) → aman melepas handle cek
  useLayoutEffect(() => {
    if (checked === src && handle.current !== null) {
      const h = handle.current;
      handle.current = null;
      continueRender(h);
    }
  }, [checked, src, continueRender]);

  return !src || checked === src;
}
