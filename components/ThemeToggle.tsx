"use client";

import { useState } from "react";

export default function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.classList.toggle("light", next === "light");
        document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
      className="btn-ghost rounded-full px-3 py-1.5 text-xs"
      title={next === "light" ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
      aria-label={next === "light" ? "Ganti ke mode terang" : "Ganti ke mode gelap"}
    >
      {theme === "dark" ? "☀️" : "🌙"}
      <span className="hidden sm:inline"> {theme === "dark" ? "Terang" : "Gelap"}</span>
    </button>
  );
}
