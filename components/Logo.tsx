/* eslint-disable @next/next/no-img-element */
/** Logo Konten.com (ikon aplikasi oranye) */
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <img
      src="/konten-logo.png"
      alt="Konten.com"
      width={size}
      height={size}
      className="shrink-0 rounded-[10px]"
      style={{ width: size, height: size, boxShadow: "0 6px 16px -6px rgb(245 73 0 / .55)" }}
    />
  );
}
