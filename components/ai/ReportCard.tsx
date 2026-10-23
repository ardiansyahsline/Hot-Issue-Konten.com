"use client";

import { useEffect, useRef, useState } from "react";
import { ACCENTS, KD, computeCampaign, type CampaignSpec, type PortfolioSpec, type ReportSpec } from "@/lib/kontenDesign";
import { saveToFolder, type DirHandle } from "@/lib/localFolder";

const C = 2 * Math.PI * 80; // keliling donut r=80

/* ---------- ikon dari template ---------- */
const Eye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#cfcfcf" strokeWidth="2">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const Coin = ({ c }: { c: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v10M9 9.5a2.5 2.5 0 0 1 5 0M9 14.5a2.5 2.5 0 0 0 5 0" />
  </svg>
);

/** halaman "CAMPAIGN PERFORMANCE" — replika template_animate.html (skill konten-report-designer) */
function CampaignPage({ c }: { c: CampaignSpec }) {
  const v = computeCampaign(c);
  const total = v.plats.reduce((a, p) => a + p.raw, 0) || 1;
  let off = 0;
  const bcol = c.status === "Active" ? [KD.green, KD.greenBorder] : ["#9a9a9a", "#3a3a3a"];
  return (
    <div className="kd-page">
      <div className="kd-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/konten-logo-report.png" alt="Konten.com" />
        <div className="kd-title">CAMPAIGN PERFORMANCE</div>
      </div>
      <div className="kd-divider" />
      <div className="kd-meta">
        <div>
          <div className="kd-client">
            {c.client}
            <span className="kd-badge" style={{ color: bcol[0], borderColor: bcol[1] }}>
              {c.status}
            </span>
          </div>
          <div className="kd-sub">
            Weekly Report - {c.basis}
            {c.platform ? ` · ${c.platform}` : ""}
          </div>
        </div>
        <div>
          <div className="kd-date">{c.date}</div>
          <div className="kd-rsub">{c.basis} Views · Semua Waktu</div>
        </div>
      </div>

      <div className="kd-hero">
        <div className="kd-label">
          <Eye />
          Total Views
        </div>
        <div className="kd-big">{v.views}</div>
        <div className="kd-sub">{v.videos} Videos Submitted</div>
        <svg className="kd-chart" viewBox="0 0 540 200" preserveAspectRatio="none">
          <defs>
            <linearGradient id="kdg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2fe34a" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#2fe34a" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <path d="M0,180 L60,160 L120,178 L190,120 L250,150 L320,80 L380,120 L440,40 L490,75 L540,10 L540,200 L0,200 Z" fill="url(#kdg)" />
          <path d="M0,180 L60,160 L120,178 L190,120 L250,150 L320,80 L380,120 L440,40 L490,75 L540,10" fill="none" stroke="#54ff6e" strokeWidth="2.5" />
        </svg>
      </div>

      <div className="kd-budget">
        <div className="kd-blbl">
          <Coin c={KD.violet} />
          Budget Progress
        </div>
        <div className="kd-bvals">
          <div className="kd-spent">{v.spent}</div>
          <div className="kd-of">of {v.budget}</div>
        </div>
        <div className="kd-bar">
          <div className="kd-fill" style={{ width: `${v.pctSpent}%` }} />
        </div>
        <div className="kd-bfoot">
          <div>{v.remain}</div>
          <div>{v.pctSpent}% Spent</div>
        </div>
      </div>

      <div className="kd-grid3">
        <div className="kd-stat">
          <div className="kd-slbl">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2fe34a" strokeWidth="2">
              <rect x="2" y="2" width="20" height="20" rx="2.5" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
            Total Clips
          </div>
          <div className="kd-v">{v.videos}</div>
          <div className="kd-n">Videos Submitted</div>
        </div>
        <div className="kd-stat">
          <div className="kd-slbl">
            <Coin c="#8a8a8a" />
            CPM (Original)
          </div>
          <div className="kd-v">{v.cpm}</div>
          <div className="kd-n">Per 1000 Views</div>
        </div>
        <div className="kd-stat kd-ecpm">
          <div className="kd-slbl">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="12" x2="12" y2="8" />
              <circle cx="12" cy="16" r="0.5" fill="#fff" />
            </svg>
            Effective CPM
          </div>
          <div className="kd-v">{v.ecpm}</div>
          <div className="kd-n">Per 1000 Views (Actual)</div>
        </div>
      </div>

      <div className={`kd-bonus ${v.neutral ? "neutral" : ""}`}>
        <div className="kd-blbl2">
          <Coin c={v.neutral ? "#8a8a8a" : KD.green} />
          Bonus Value
        </div>
        <div className="kd-bv">{v.bonus}</div>
        <div className="kd-bn">{v.multNote}</div>
        <div className="kd-mult">{v.multBig}</div>
      </div>

      <div className="kd-divider2" />

      <div className="kd-dist">
        <div className="kd-donut">
          <svg viewBox="0 0 200 200">
            <circle cx="100" cy="100" r="80" fill="none" stroke="#1e1e1e" strokeWidth="22" />
            {v.plats.map((p) => {
              const len = (C * p.raw) / total;
              const el = p.raw > 0 ? <circle key={p.key} cx="100" cy="100" r="80" fill="none" stroke={p.color} strokeWidth="22" strokeDasharray={`${len.toFixed(2)} ${(C - len).toFixed(2)}`} strokeDashoffset={(-off).toFixed(2)} /> : null;
              off += len;
              return el;
            })}
          </svg>
          <div className="kd-center">
            <div className="kd-dv">{v.views}</div>
            <div className="kd-dl">Views</div>
          </div>
        </div>
        <div className="kd-legend">
          {v.plats.map((p) => (
            <div key={p.key} className="kd-lrow">
              <div className="kd-dot" style={{ background: p.key === "tiktok" ? KD.tiktok : p.key === "instagram" ? KD.instagram : p.key === "youtube" ? KD.youtube : KD.threads }} />
              <div className="kd-lname">{p.name}</div>
              <div className="kd-lmeta">{p.videos} Video</div>
              <div className="kd-lviews" style={{ color: p.color }}>
                {p.views}
              </div>
            </div>
          ))}
          <div className="kd-ltotal">
            <div>Total video and views</div>
            <div>
              <b>{v.videos}</b> &nbsp;|&nbsp; <b>{v.views} Views</b>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** portfolio one-pager multi-campaign — replika portfolio_lib.py */
function PortfolioPage({ p }: { p: PortfolioSpec }) {
  const ncol = p.campaigns[0]?.cells.length ?? 4;
  const cols = ncol === 4 ? "1.05fr 1.55fr 1.35fr 1fr" : ncol === 5 ? "0.95fr 1.5fr 1.2fr 0.8fr 0.8fr" : `repeat(${ncol},1fr)`;
  return (
    <div className="kd-page">
      <div className="kd-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/konten-logo-report.png" alt="Konten.com" />
        <div className="kd-title">{p.heading || "UGC CAMPAIGN PORTFOLIO"}</div>
      </div>
      <div className="kd-divider" />
      <div className="kd-meta">
        <div>
          <div className="kd-client">{p.title}</div>
          <div className="kd-sub">{p.sub}</div>
        </div>
        <div>
          <div className="kd-date">{p.date}</div>
          <div className="kd-rsub">{p.rsub || "Sumber: Dashboard Konten.com"}</div>
        </div>
      </div>
      <div className="kd-pgrid" style={{ gridTemplateColumns: `repeat(${p.summary.length || 1},1fr)` }}>
        {p.summary.map((s) => (
          <div key={s.lbl} className={`kd-pstat ${s.hi ? "hi" : ""}`}>
            <div className="kd-plbl">{s.lbl}</div>
            <div className="kd-pv">{s.v}</div>
            <div className="kd-pn">{s.n}</div>
          </div>
        ))}
      </div>
      <div className="kd-sechead">{p.section || "Daftar Campaign"}</div>
      {p.campaigns.map((c, i) => (
        <div key={c.name + i} className="kd-camp" style={{ ["--acc" as string]: c.accent || ACCENTS[i % ACCENTS.length] }}>
          <div className="kd-cname">{c.name}</div>
          <div className="kd-cbrand">
            {c.brand} &nbsp;·&nbsp; <span className="kd-tag">UGC</span>&nbsp;<span className={`kd-tag ${c.status.toLowerCase()}`}>{c.status}</span>
          </div>
          <div className="kd-cgrid" style={{ gridTemplateColumns: cols }}>
            {c.cells.map(([k, val], j) => (
              <div key={j} className={j === ncol - 1 ? "kd-right" : ""}>
                <div className="kd-ck">{k}</div>
                <div className={`kd-cv ${j === ncol - 1 ? "acc" : ""}`}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="kd-foot">
        <div>Konten.com · PT Konten Kreasi Media</div>
        <div>Model pembayaran: CPM per verified views</div>
      </div>
    </div>
  );
}

const fileName = (r: ReportSpec) =>
  r.kind === "campaign"
    ? `${r.client.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}${r.platform ? `_${r.platform}` : ""}${r.basis === "All" ? "_all" : ""}.png`
    : `${r.title.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "")}_portfolio.png`;

/** kartu report di chat: pratinjau persis + unduh PNG / simpan ke folder laptop */
export default function ReportCard({ report, root }: { report: ReportSpec; root: DirHandle | null }) {
  const wrap = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.6);
  const [h, setH] = useState(800);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const fit = () => {
      if (!wrap.current || !page.current) return;
      const kk = Math.min(1, wrap.current.clientWidth / 820);
      setK(kk);
      setH(page.current.offsetHeight * kk);
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrap.current) ro.observe(wrap.current);
    if (page.current) ro.observe(page.current);
    return () => ro.disconnect();
  }, []);
  const warnings = report.kind === "campaign" ? computeCampaign(report).warnings : [];
  const png = async () => {
    const { toBlob } = await import("html-to-image");
    await document.fonts?.ready;
    const b = await toBlob(page.current!.firstElementChild as HTMLElement, { pixelRatio: 2, backgroundColor: KD.bg, cacheBust: true });
    if (!b) throw new Error("gambar kosong");
    return b;
  };
  const download = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const b = await png();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = fileName(report);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) {
      setMsg(`Gagal membuat PNG: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!root) return;
    setBusy(true);
    setMsg(null);
    try {
      const path = await saveToFolder(root, `Laporan/${fileName(report)}`, await png());
      setMsg(`✓ Tersimpan di folder ${root.name}/${path}`);
    } catch (e) {
      setMsg(`Gagal menyimpan: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-card mt-3">
      <div className="ai-body">
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <b>🖼️ {report.kind === "campaign" ? `Report ${report.client} · ${report.basis}` : report.title}</b>
          <span className="text-[11.5px] text-zinc-500">gaya report Konten.com · angka turunan dihitung otomatis</span>
        </div>
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-400">
            {warnings.map((w) => (
              <li key={w}>⚠️ {w}</li>
            ))}
          </ul>
        )}
        <div ref={wrap} className="mt-3 w-full overflow-hidden rounded-xl" style={{ height: h }}>
          <div ref={page} style={{ width: 820, transform: `scale(${k})`, transformOrigin: "top left" }}>
            {report.kind === "campaign" ? <CampaignPage c={report} /> : <PortfolioPage p={report} />}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={download} disabled={busy} className="rounded-lg bg-orange-500 px-3.5 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-60">
            {busy ? "Menyiapkan…" : "⬇ Unduh PNG"}
          </button>
          {root && (
            <button type="button" onClick={save} disabled={busy} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[12.5px] font-bold text-zinc-300 hover:border-zinc-500 disabled:opacity-60">
              💾 Simpan ke folder {root.name}/Laporan
            </button>
          )}
          {msg && <span className={`text-[12px] ${msg.startsWith("✓") ? "text-emerald-400" : "text-red-400"}`}>{msg}</span>}
        </div>
      </div>
    </div>
  );
}
