import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAiOwner } from "@/lib/aiOwner";
import { createAdminClient } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { PIN_COOKIE, pinToken } from "./pin";
import { lockUsage, unlockUsage } from "./actions";
import { heroName, providerOf, SMART_HERO } from "@/lib/aiModels";
import { isBuiltinHero } from "@/lib/aiPersona";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage AI · CS Tracker" };

type Row = { model: string | null; persona: string | null; created_at: string; error: boolean | null; tokens_in: number | null; tokens_out: number | null; conversation_id: string };

/** tarif per 1 juta token (US$) untuk model berbayar; model lain dianggap gratis */
const PRICES: { re: RegExp; label: string; inp: number; out: number }[] = [
  { re: /haiku/i, label: "Claude Haiku", inp: Number(process.env.AI_PRICE_HAIKU_IN ?? 0.1), out: Number(process.env.AI_PRICE_HAIKU_OUT ?? 0.5) },
  { re: /sonnet/i, label: "Claude", inp: Number(process.env.AI_PRICE_SONNET_IN ?? 2), out: Number(process.env.AI_PRICE_SONNET_OUT ?? 10) },
];
const priceOf = (model: string) => PRICES.find((p) => p.re.test(model));
const nf = (n: number) => n.toLocaleString("id-ID");
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt` : n >= 1e3 ? `${(n / 1e3).toLocaleString("id-ID", { maximumFractionDigits: 1 })} rb` : nf(n));
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? `${m} menit lalu` : m < 1440 ? `${Math.round(m / 60)} jam lalu` : `${Math.round(m / 1440)} hari lalu`;
};

/**
 * Halaman Usage AI — khusus pemilik (Alif). Hanya angka pemakaian; isi percakapan tetap privat.
 */
export default async function UsagePage({ searchParams }: { searchParams: Promise<{ d?: string; salah?: string }> }) {
  const { user } = await getCurrentUser();
  if (!isAiOwner(user.email)) notFound();
  // 🔒 PIN terpisah untuk membuka halaman Usage
  if ((await cookies()).get(PIN_COOKIE)?.value !== pinToken(user.id)) {
    const wrong = (await searchParams).salah === "1";
    return (
      <div className="mx-auto mt-10 max-w-[360px]">
        <form action={unlockUsage} className="card space-y-3 p-6 text-center">
          <div className="text-[34px]">🔒</div>
          <h1 className="font-display text-[19px] font-bold">Masukkan PIN Usage</h1>
          <p className="text-[12.5px] text-zinc-500">Halaman pemakaian AI dilindungi PIN terpisah.</p>
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={12}
            placeholder="••••"
            className="input text-center text-[20px] tracking-[0.5em]"
            aria-label="PIN"
          />
          {wrong && <p className="text-[12.5px] font-semibold text-red-400">PIN salah, coba lagi.</p>}
          <button type="submit" className="btn-primary w-full justify-center">
            Buka Usage
          </button>
          <Link href="/ai" className="block text-[12px] text-zinc-500 hover:text-zinc-300">
            ← Kembali ke AI
          </Link>
        </form>
      </div>
    );
  }
  const days = (await searchParams).d === "7" ? 7 : 30;
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch (e) {
    return <div className="card p-6 text-sm text-red-400">{(e as Error).message}</div>;
  }
  // semua jawaban AI dalam rentang (maks 20.000 baris), tanpa isi pesan
  const rows: Row[] = [];
  let tokensReady = true;
  for (let from = 0; from < 20000; from += 1000) {
    let q = await db
      .from("ai_messages")
      .select("model, persona, created_at, error, tokens_in, tokens_out, conversation_id")
      .eq("role", "assistant")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (q.error && /tokens_/.test(q.error.message)) {
      tokensReady = false;
      q = (await db
        .from("ai_messages")
        .select("model, persona, created_at, error, conversation_id")
        .eq("role", "assistant")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(from, from + 999)) as typeof q;
    }
    if (q.error || !q.data?.length) break;
    rows.push(...(q.data as Row[]));
    if (q.data.length < 1000) break;
  }
  const convIds = [...new Set(rows.map((r) => r.conversation_id))];
  const convs = new Map<string, string>();
  for (let i = 0; i < convIds.length; i += 300) {
    const { data } = await db.from("ai_conversations").select("id, user_id").in("id", convIds.slice(i, i + 300));
    for (const c of data ?? []) convs.set(c.id as string, c.user_id as string);
  }
  const userIds = [...new Set(convs.values())];
  const names = new Map<string, string>();
  if (userIds.length) {
    const { data } = await db.from("profiles").select("id, full_name").in("id", userIds);
    for (const p of data ?? []) names.set(p.id as string, (p.full_name as string) || "Tanpa nama");
  }

  // ---- hitung ----
  const ok = rows.filter((r) => !r.error);
  const errors = rows.length - ok.length;
  // karakter buatan user (bukan hero bawaan) memang selalu memakai mesin lain -> tidak dihitung "dibantu"
  const helped = ok.filter((r) => r.persona && r.model && isBuiltinHero(r.persona) && r.persona !== heroName(r.model) && r.persona !== SMART_HERO).length;
  let tin = 0;
  let tout = 0;
  let cost = 0;
  const byEngine = new Map<string, { hero: string; model: string; n: number; tin: number; tout: number; cost: number; err: number }>();
  const byUser = new Map<string, { n: number; tin: number; tout: number; cost: number; last: string }>();
  const byDay = new Map<string, number>();
  // mesin tugas berat digabung ke baris Haiku (biaya tetap dihitung sesuai tarif aslinya)
  const haikuId = rows.find((x) => /haiku/i.test(x.model ?? ""))?.model ?? "anth/claude-haiku-5-5";
  for (const r of rows) {
    const real = r.model || "auto";
    const model = /sonnet/i.test(real) ? haikuId : real;
    const e = byEngine.get(model) ?? { hero: heroName(model), model, n: 0, tin: 0, tout: 0, cost: 0, err: 0 };
    const uid = convs.get(r.conversation_id) ?? "?";
    const u = byUser.get(uid) ?? { n: 0, tin: 0, tout: 0, cost: 0, last: r.created_at };
    if (r.error) e.err++;
    else {
      const i = r.tokens_in ?? 0;
      const o = r.tokens_out ?? 0;
      const p = priceOf(real);
      const c = p ? (i * p.inp + o * p.out) / 1e6 : 0;
      e.n++;
      e.tin += i;
      e.tout += o;
      e.cost += c;
      u.n++;
      u.tin += i;
      u.tout += o;
      u.cost += c;
      tin += i;
      tout += o;
      cost += c;
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(r.created_at));
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    if (r.created_at > u.last) u.last = r.created_at;
    byEngine.set(model, e);
    byUser.set(uid, u);
  }
  const engines = [...byEngine.values()].sort((a, b) => b.n - a.n);
  const users = [...byUser.entries()].map(([id, v]) => ({ id, name: names.get(id) ?? "—", ...v })).sort((a, b) => b.n - a.n);
  const dayKeys = Array.from({ length: days }, (_, i) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(Date.now() - (days - 1 - i) * 86400_000))
  );
  const maxDay = Math.max(1, ...dayKeys.map((d) => byDay.get(d) ?? 0));

  const Tile = ({ k, v, n, tone }: { k: string; v: string; n?: string; tone?: "up" | "down" }) => (
    <div className={`ai-tile ${tone ?? "neutral"}`}>
      <span className="ai-k">{k}</span>
      <b className="ai-v">{v}</b>
      {n && <span className="ai-n">{n}</span>}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="page-title">📊 Usage AI</h1>
          <p className="page-sub">Pemakaian tab AI semua user · khusus pemilik · isi percakapan tetap privat</p>
        </div>
        <div className="ml-auto flex gap-1 rounded-full border border-zinc-800 p-1 text-[12.5px] font-semibold">
          {[7, 30].map((d) => (
            <Link key={d} href={`/ai/usage?d=${d}`} className={`rounded-full px-3 py-1 ${days === d ? "bg-orange-500/15 text-orange-400" : "text-zinc-500 hover:text-zinc-300"}`}>
              {d} hari
            </Link>
          ))}
        </div>
        <Link href="/ai" className="btn-ghost rounded-full px-3 py-1.5 text-xs">
          ← Kembali ke AI
        </Link>
        <form action={lockUsage}>
          <button type="submit" className="btn-ghost rounded-full px-3 py-1.5 text-xs" title="Kunci lagi halaman Usage">
            🔒 Kunci
          </button>
        </form>
      </div>

      <div className="ai-card">
        <div className="ai-body">
          <div className="ai-tiles">
            <Tile k="Jawaban AI" v={nf(ok.length)} n={`${days} hari terakhir`} />
            <Tile k="Token" v={tokensReady ? tok(tin + tout) : "—"} n={tokensReady ? `masuk ${tok(tin)} · keluar ${tok(tout)}` : "jalankan migration-18"} />
            <Tile k="Perkiraan biaya" v={usd(cost)} n="Claude Haiku · lainnya gratis" tone={cost > 0 ? "down" : undefined} />
            <Tile k="Dibantu hero lain" v={pct(helped, ok.length)} n={`${nf(helped)} jawaban`} />
            <Tile k="Error" v={pct(errors, rows.length)} n={`${nf(errors)} kali gagal`} tone={errors / Math.max(1, rows.length) > 0.1 ? "down" : undefined} />
            <Tile k="User aktif" v={nf(users.filter((u) => u.n > 0).length)} n="pernah chat dengan AI" />
          </div>

          <div className="ai-sec">Jawaban per hari</div>
          <div className="flex h-28 items-end gap-[3px]">
            {dayKeys.map((d) => {
              const v = byDay.get(d) ?? 0;
              return (
                <div key={d} className="group relative flex-1" title={`${d}: ${v} jawaban`}>
                  <div className="rounded-t-[3px] bg-orange-500/80" style={{ height: `${Math.max(v ? 6 : 2, (v / maxDay) * 100)}px`, opacity: v ? 1 : 0.25 }} />
                </div>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-zinc-500">
            <span>{dayKeys[0].slice(5).split("-").reverse().join("/")}</span>
            <span>hari ini</span>
          </div>
        </div>
      </div>

      <div className="ai-table">
        <table>
          <thead>
            <tr>
              <th>Hero · mesin</th>
              <th style={{ textAlign: "right" }}>Jawaban</th>
              <th style={{ textAlign: "right" }}>Token masuk / keluar</th>
              <th style={{ textAlign: "right" }}>Biaya</th>
              <th style={{ textAlign: "right" }}>Error</th>
            </tr>
          </thead>
          <tbody>
            {engines.map((e) => (
              <tr key={e.model}>
                <td>
                  {e.hero}
                  <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                    {providerOf(e.model) || "auto"} · {e.model.split("/").slice(1).join("/") || e.model}
                  </span>
                </td>
                <td className="ai-num">{nf(e.n)}</td>
                <td className="ai-num">{tokensReady ? `${tok(e.tin)} / ${tok(e.tout)}` : "—"}</td>
                <td className="ai-num">{priceOf(e.model) ? usd(e.cost) : "gratis"}</td>
                <td className="ai-num">{e.err ? nf(e.err) : "—"}</td>
              </tr>
            ))}
            {!engines.length && (
              <tr>
                <td colSpan={5}>Belum ada pemakaian dalam {days} hari terakhir.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="ai-table">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th style={{ textAlign: "right" }}>Jawaban</th>
              <th style={{ textAlign: "right" }}>Token</th>
              <th style={{ textAlign: "right" }}>Biaya</th>
              <th style={{ textAlign: "right" }}>Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td className="ai-num">{nf(u.n)}</td>
                <td className="ai-num">{tokensReady ? tok(u.tin + u.tout) : "—"}</td>
                <td className="ai-num">{usd(u.cost)}</td>
                <td className="ai-num">{ago(u.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11.5px] text-zinc-500">
        Token dicatat mulai update ini (jawaban lama tanpa angka token). Biaya = perkiraan dari tarif Claude per 1 jt token — tagihan resmi tetap di console.anthropic.com. Langkah &quot;mikir dulu&quot; (perencana browsing) tidak ikut dihitung.
      </p>
    </div>
  );
}
