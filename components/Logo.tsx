export default function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-xl text-white"
      style={{
        width: size,
        height: size,
        backgroundImage: "linear-gradient(180deg,#fb923c,#ea580c)",
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / .3), 0 6px 16px -6px rgb(234 88 12 / .7)",
      }}
      aria-hidden
    >
      <svg viewBox="0 0 64 64" width={size * 0.62} height={size * 0.62}>
        <path d="M33 12c2 8-6 11-6 19a5 5 0 0 0 10 0c0-2-1-4-1-4 5 3 8 8 8 13a12 12 0 0 1-24 0c0-12 13-17 13-28z" fill="currentColor" />
      </svg>
    </span>
  );
}
