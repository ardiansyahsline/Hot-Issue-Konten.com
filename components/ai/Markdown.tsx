"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950/70">
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-3 py-1.5 text-[11.5px] text-zinc-500">
        <span>{lang || "teks"}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="hover:text-zinc-200"
        >
          {copied ? "✓ Tersalin" : "⧉ Salin"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12.5px] leading-relaxed">
        <code className="font-mono text-zinc-200">{code}</code>
      </pre>
    </div>
  );
}

const C: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mb-2 mt-4 text-[17px] font-bold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-2 mt-4 text-[16px] font-bold first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mb-1.5 mt-3 text-[15px] font-semibold first:mt-0">{children}</h4>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-orange-400 underline underline-offset-2">
      {children}
    </a>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-4 border-orange-500/60 pl-3 text-zinc-400">{children}</blockquote>,
  hr: () => <hr className="my-4 border-zinc-800" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-zinc-800">
      <table className="w-full text-[13px]">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-zinc-800 bg-zinc-800/50 px-3 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-zinc-800/60 px-3 py-1.5 align-top">{children}</td>,
  code: ({ className, children }) => {
    const text = String(children ?? "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "";
    if (lang || text.includes("\n")) return <CodeBlock lang={lang} code={text.replace(/\n$/, "")} />;
    return <code className="rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[0.88em] text-orange-300">{children}</code>;
  },
  pre: ({ children }) => <>{children}</>,
};

/** Tampilkan jawaban AI (markdown: daftar, tabel, kode, dll.) */
export default function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={C}>
      {text}
    </ReactMarkdown>
  );
}
