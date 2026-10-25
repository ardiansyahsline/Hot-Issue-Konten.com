"use client";
/**
 * Gambar yang boleh gagal dimuat. <Img> Remotion tanpa onError memanggil cancelRender setelah percobaan ulang habis,
 * jadi satu logo / foto 404 membatalkan seluruh render. Hook ini memberi src yang aman dipakai + handler onError:
 * setelah gagal, src jadi null dan komponen menampilkan cadangannya (inisial brand / bidang warna).
 *
 *   const [logo, onLogoError] = useImgFallback(brand.logo ? res(brand.logo) : null);
 *   {logo ? <Img src={logo} onError={onLogoError} /> : <Inisial />}
 */
import { useCallback, useState } from "react";

export function useImgFallback(src: string | null | undefined): [string | null, () => void] {
  const [bad, setBad] = useState<string | null>(null);
  const ok = src && src !== bad ? src : null;
  const onError = useCallback(() => setBad(src ?? null), [src]);
  return [ok, onError];
}
