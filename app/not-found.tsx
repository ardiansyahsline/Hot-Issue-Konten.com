import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-zinc-400">Halaman / issue tidak ditemukan.</p>
      <Link href="/" className="btn-ghost">Ke dashboard</Link>
    </main>
  );
}
