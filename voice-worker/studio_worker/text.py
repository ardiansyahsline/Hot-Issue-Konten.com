"""Teks: pecah kalimat, jeda alami, normalisasi untuk cek ASR (WER/CER), pemetaan timestamp kata ke teks asli, SRT."""
from __future__ import annotations

import hashlib
import math
import random
import re
from difflib import SequenceMatcher

# singkatan umum yang titiknya bukan akhir kalimat
_ABBR = re.compile(r"\b(dll|dsb|dst|tsb|yth|bpk|bu|pak|no|dr|drs|ir|prof|rp|jl|pt|tbk|sdr|kel|kec|kab|mis|spt|vs|hlm|tgl)\.(?=\s)", re.I)
_DOT = "․"  # pengganti sementara titik singkatan


def clean_text(s: str) -> str:
    s = (s or "").replace("\r", "\n").replace("...", "…")
    s = re.sub(r"[ \t ]+", " ", s)
    return re.sub(r"\n\s*\n+", "\n", s).strip()


def split_sentences(text: str, max_chars: int = 220) -> list[str]:
    """pecah per baris & akhir kalimat (. ! ? …); kalimat kepanjangan dipecah di koma"""
    t = _ABBR.sub(lambda m: m.group(1) + _DOT, clean_text(text))
    parts: list[str] = []
    for para in t.split("\n"):
        for s in re.split(r"(?<=[.!?…])[\"'”’)\]]*\s+", para.strip()):
            s = s.strip()
            if s:
                parts.append(s.replace(_DOT, "."))
    # potongan 1 kata (mis. "Tenang…") digabung ke kalimat berikutnya: mesin suara sering ngawur kalau teksnya cuma 1 kata
    merged: list[str] = []
    carry = ""
    for s in parts:
        s = f"{carry} {s}".strip() if carry else s
        carry = ""
        if len(s.split()) <= 1:
            carry = s
            continue
        merged.append(s)
    if carry:
        if merged:
            merged[-1] = f"{merged[-1]} {carry}"
        else:
            merged.append(carry)
    out: list[str] = []
    for s in merged:
        out.extend(_split_long(s, max_chars))
    return out


def chunk_text(text: str, max_chars: int = 260) -> list[str]:
    """
    Potongan "satu tarikan" untuk mesin suara: teks ≤ max_chars huruf → 1 potong utuh (intonasi satu baris tidak reset per kalimat).
    Lebih panjang → beberapa potong ≤ max_chars yang menggabungkan KALIMAT UTUH (bukan 1 kalimat per potong): jumlah potong
    sesedikit mungkin, panjangnya dibuat serata mungkin (potongan sisa yang pendek sekali bikin mesin ngawur). Kalimat tunggal yang
    lebih panjang dari max_chars dipecah di koma (sama dengan split_sentences).
    """
    t = clean_text(text)
    if not t:
        return []
    if len(t) <= max_chars and "\n" not in t:
        return [t]
    sents = split_sentences(t, max_chars)
    if len(sents) <= 1:
        return sents
    n = len(sents)
    total = len(" ".join(sents))
    target = total / max(1, math.ceil(total / max_chars))
    INF = (10**9, 0.0)
    # dp[i] = (jumlah potong, jumlah kuadrat selisih panjang dari target) terbaik untuk kalimat [0, i)
    dp: list[tuple[int, float]] = [(0, 0.0)] + [INF] * n
    back = [0] * (n + 1)
    for i in range(1, n + 1):
        ln = -1
        for j in range(i - 1, -1, -1):
            ln += len(sents[j]) + 1
            if ln > max_chars and j < i - 1:
                break
            if dp[j][0] >= INF[0]:
                continue
            cand = (dp[j][0] + 1, dp[j][1] + (ln - target) ** 2)
            if cand < dp[i]:
                dp[i], back[i] = cand, j
    out: list[str] = []
    i = n
    while i > 0:
        j = back[i]
        out.append(" ".join(sents[j:i]))
        i = j
    return out[::-1]


def _split_long(s: str, max_chars: int) -> list[str]:
    if len(s) <= max_chars:
        return [s]
    chunks = re.split(r"(?<=[,;:])\s+", s)
    out: list[str] = []
    cur = ""
    for c in chunks:
        if len(c) > max_chars:  # tanpa koma: pecah per kata
            words = c.split()
            for w in words:
                if cur and len(cur) + 1 + len(w) > max_chars:
                    out.append(cur)
                    cur = w
                else:
                    cur = f"{cur} {w}".strip()
            continue
        if cur and len(cur) + 1 + len(c) > max_chars:
            out.append(cur)
            cur = c
        else:
            cur = f"{cur} {c}".strip()
    if cur:
        out.append(cur)
    return out


def seeded_rng(*parts: str) -> random.Random:
    h = hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()
    return random.Random(int(h[:12], 16))


def pause_after(sentence: str, rnd: random.Random) -> float:
    """jeda setelah kalimat: 0,18–0,4 dtk; lebih panjang setelah "…" """
    s = sentence.rstrip(" \"'”’)")
    if s.endswith("…"):
        return round(rnd.uniform(0.45, 0.62), 3)
    if s.endswith(("?", "!")):
        return round(rnd.uniform(0.28, 0.4), 3)
    if s.endswith((",", ";", ":")):
        return round(rnd.uniform(0.18, 0.26), 3)
    return round(rnd.uniform(0.18, 0.4), 3)


def pauses(sentences: list[str], key: str = "") -> list[float]:
    rnd = seeded_rng(key, *sentences)
    return [pause_after(s, rnd) for s in sentences[:-1]]


# ---------------------------------------------------------------- angka → kata (untuk membandingkan teks dengan hasil ASR)
_SAT = ["nol", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"]


def terbilang(n: int) -> str:
    if n < 0:
        return "minus " + terbilang(-n)
    if n < 12:
        return _SAT[n]
    if n < 20:
        return terbilang(n - 10) + " belas"
    if n < 100:
        return terbilang(n // 10) + " puluh" + (" " + terbilang(n % 10) if n % 10 else "")
    if n < 200:
        return "seratus" + (" " + terbilang(n - 100) if n > 100 else "")
    if n < 1000:
        return terbilang(n // 100) + " ratus" + (" " + terbilang(n % 100) if n % 100 else "")
    if n < 2000:
        return "seribu" + (" " + terbilang(n - 1000) if n > 1000 else "")
    for div, name in ((10**12, "triliun"), (10**9, "miliar"), (10**6, "juta"), (1000, "ribu")):
        if n >= div:
            return terbilang(n // div) + f" {name}" + (" " + terbilang(n % div) if n % div else "")
    return str(n)


def _num_words(m: re.Match) -> str:
    raw = m.group(0)
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", raw):  # 16.800 → ribuan
        return " " + terbilang(int(raw.replace(".", ""))) + " "
    if re.fullmatch(r"\d+[.,]\d+", raw):  # 2,5 / 2.5 → koma
        a, b = re.split(r"[.,]", raw)
        return " " + terbilang(int(a)) + " koma " + " ".join(_SAT[int(d)] for d in b) + " "
    return " " + terbilang(int(raw)) + " " if len(raw) <= 15 else raw


def norm_words(s: str) -> list[str]:
    s = (s or "").lower().replace("%", " persen ").replace("&", " dan ")
    s = re.sub(r"\d{1,3}(?:\.\d{3})+(?!\d)|\d+[.,]\d+|\d+", _num_words, s)
    s = re.sub(r"[^\w\s]|_", " ", s)
    return s.split()


def _lev(a: list, b: list) -> int:
    if not a:
        return len(b)
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def wer(ref: str, hyp: str) -> float:
    r, h = norm_words(ref), norm_words(hyp)
    if not r:
        return 0.0 if not h else 1.0
    return _lev(r, h) / len(r)


def cer(ref: str, hyp: str) -> float:
    r, h = list("".join(norm_words(ref))), list("".join(norm_words(hyp)))
    if not r:
        return 0.0 if not h else 1.0
    return _lev(r, h) / len(r)


# ---------------------------------------------------------------- timestamp kata
def _sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    return SequenceMatcher(None, a, b).ratio()


def align_words(text: str, hyp: list[tuple[str, float, float]], total: float) -> list[dict]:
    """
    Petakan kata hasil ASR (dari ejaan mesin suara) ke kata TEKS ASLI → [{w, s, e}] (detik dari awal klip).
    Kata yang tidak ketemu pasangannya diberi waktu di antara tetangganya (sebanding panjang huruf).
    """
    words = text.split()
    if not words:
        return []
    # pecah tiap kata asli jadi token normal (angka bisa jadi beberapa kata)
    ref_tok: list[tuple[str, int]] = []
    for i, w in enumerate(words):
        for t in norm_words(w) or [w.lower()]:
            ref_tok.append((t, i))
    hyp_tok: list[tuple[str, float, float]] = []
    for w, s, e in hyp:
        ts = norm_words(w)
        if not ts:
            continue
        step = (e - s) / len(ts)
        for k, t in enumerate(ts):
            hyp_tok.append((t, s + k * step, s + (k + 1) * step))

    n, m = len(ref_tok), len(hyp_tok)
    gap = 0.75
    cost = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i * gap
        back[i][0] = 1
    for j in range(1, m + 1):
        cost[0][j] = j * gap
        back[0][j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = cost[i - 1][j - 1] + (1 - _sim(ref_tok[i - 1][0], hyp_tok[j - 1][0])) * 1.2
            de = cost[i - 1][j] + gap
            ins = cost[i][j - 1] + gap
            best = min(sub, de, ins)
            cost[i][j] = best
            back[i][j] = 0 if best == sub else 1 if best == de else 2
    span: dict[int, list[float]] = {}
    i, j = n, m
    while i > 0 or j > 0:
        b = back[i][j]
        if i > 0 and j > 0 and b == 0:
            t, wi = ref_tok[i - 1]
            ht = hyp_tok[j - 1]
            if _sim(t, ht[0]) >= 0.35:
                sp = span.setdefault(wi, [ht[1], ht[2]])
                sp[0], sp[1] = min(sp[0], ht[1]), max(sp[1], ht[2])
            i, j = i - 1, j - 1
        elif i > 0 and (j == 0 or b == 1):
            i -= 1
        else:
            j -= 1

    out: list[dict] = [{"w": w, "s": None, "e": None} for w in words]
    for wi, (s, e) in span.items():
        out[wi]["s"], out[wi]["e"] = s, e
    _fill_gaps(out, total, hyp)
    return out


def _fill_gaps(out: list[dict], total: float, hyp: list[tuple[str, float, float]]) -> None:
    lead = hyp[0][1] if hyp else 0.05
    tail = hyp[-1][2] if hyp else max(total - 0.05, 0.1)
    k = 0
    n = len(out)
    while k < n:
        if out[k]["s"] is not None:
            k += 1
            continue
        a = k
        while k < n and out[k]["s"] is None:
            k += 1
        t0 = out[a - 1]["e"] if a > 0 else min(lead, out[k]["s"] if k < n else lead)
        t1 = out[k]["s"] if k < n else max(tail, t0 + 0.1)
        if t1 <= t0:
            t1 = t0 + 0.08 * (k - a)
        lens = [max(1, len(out[x]["w"])) for x in range(a, k)]
        tot = sum(lens)
        cur = t0
        for x, L in zip(range(a, k), lens):
            d = (t1 - t0) * L / tot
            out[x]["s"], out[x]["e"] = cur, cur + d
            cur += d
    # rapikan: urut naik, minimal 50 ms, dalam batas klip
    prev_s = 0.0
    for w in out:
        s = max(float(w["s"]), prev_s)
        e = max(float(w["e"]), s + 0.05)
        w["s"], w["e"] = round(min(s, total), 3), round(min(e, max(total, s + 0.05)), 3)
        prev_s = s


def estimate_words(text: str, total: float, lead: float = 0.05, tail: float = 0.05) -> list[dict]:
    """perkiraan timestamp tanpa ASR: dibagi sebanding panjang huruf"""
    out = [{"w": w, "s": None, "e": None} for w in text.split()]
    if not out:
        return []
    _fill_gaps(out, total, [("", lead, lead), ("", max(lead + 0.1, total - tail), max(lead + 0.1, total - tail))])
    return out


# ---------------------------------------------------------------- SRT
def srt_time(t: float) -> str:
    ms = max(0, int(round(t * 1000)))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def group_cues(words: list[dict], offset: float = 0.0, max_words: int = 6) -> list[dict]:
    """kelompokkan maks 6 kata per potongan subtitle, putus di tanda baca (sama dengan subtitleCues di timeline.ts)"""
    cues: list[dict] = []
    cur: list[dict] = []
    for w in words:
        cur.append(w)
        if len(cur) >= max_words or re.search(r"[.,!?…]$", w["w"]):
            cues.append({"s": offset + cur[0]["s"], "e": offset + cur[-1]["e"], "text": " ".join(x["w"] for x in cur)})
            cur = []
    if cur:
        cues.append({"s": offset + cur[0]["s"], "e": offset + cur[-1]["e"], "text": " ".join(x["w"] for x in cur)})
    return cues


def to_srt(cues: list[dict]) -> str:
    rows = []
    for i, c in enumerate(sorted(cues, key=lambda c: c["s"]), 1):
        rows.append(f"{i}\n{srt_time(c['s'])} --> {srt_time(max(c['e'], c['s'] + 0.3))}\n{c['text']}\n")
    return "\n".join(rows)
