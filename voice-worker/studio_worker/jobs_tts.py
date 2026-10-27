"""
Job kind 'tts': VO dari bank suara.
  per baris → SATU TARIKAN: teks ucapan ≤ 260 huruf dibuat sekali jalan (intonasi tidak reset per kalimat); lebih panjang → potongan
    ≤ 260 huruf berisi kalimat utuh (text.chunk_text) → tiap potongan dibuat beberapa versi (takes, bawaan 3, dibatasi waktu
    dari panjang kalimat; Chatterbox membuat semua versi SEKALIGUS dalam satu batch, jumlahnya menyesuaikan kecepatan laptop)
  → pilih take: kejelasan (cek ASR: WER/CER + cek durasi/hening) tetap utama; yang hampir sama jelasnya bersaing di kealamian
    (natural.py: MOS UTMOS bila ada − penalti nada datar)
  → semua take satu-tarikan jelek (WER > 0,35) → dicoba mode lama per kalimat, dipakai yang skornya lebih baik
  → ujung take tidak memakan ekor napas / nada turun (sisa 150 ms + fade 30 ms); jeda antar kalimat di dalam take dirapikan ke
    0,25–0,6 dtk (sesudah "…" 0,45–0,7) dengan room tone; potongan disambung room tone + crossfade equal-power (bukan hening digital)
  → post-processing ffmpeg (-16 LUFS / TP -1,5)
  → timestamp per kata (faster-whisper) dipetakan ke kata TEKS ASLI (kolom spell hanya untuk mesin suara)
  → baris adegan teaser punya `max` (jendela ucapan, detik): ucapan lebih panjang → (1) jeda di DALAM baris dipadatkan dulu
    (hening antar kalimat / sesudah "…" disisakan min 0,12 dtk, suara tidak berubah), (2) kalau masih kepanjangan baru dipercepat
    ffmpeg atempo (nada tetap, maks 1,3×); waktu kata & durasi ikut disesuaikan (fit_to_max). Mesin yang tempo aslinya bisa diatur
    (Chatterbox: cfg_weight lebih tinggi = bicara lebih cepat) → kalau sesudah jeda dipadatkan masih kelebihan > 4%, baris dibuat
    ulang SEKALI dengan cfg_weight + 0,2 (maks 0,85) dan dipakai versi yang butuh atempo paling sedikit (native_fit)
  → baris punya `speed` (kecepatan diatur sendiri di website, mis. 0,85–1,3×) → atempo persis faktor itu, `max` diabaikan
    (apply_speed); job lama tanpa `speed` / `max` hasilnya sama persis seperti dulu
  → baris punya `seed` (🎧 Coba ejaan di website: kalimat sama dengan beberapa ejaan, settings.purpose = "coba-ejaan", takes 1) → semua
    versinya memakai benih acak itu, jadi beda suaranya hanya dari ejaan; tanpa `seed` benih dari teks seperti dulu
  → upload vo/<job>/<baris>.mp3, vo/<job>/full.mp3 (tiap baris di detik `start`), vo/<job>/full.srt
  → ringkasan kealamian per baris (row.natural: MOS, variasi nada, persen dipercepat asli vs atempo) + per job (result.natural)
  → teks yang terdengar ASR per baris (row.heard, gabungan take terpilih per potongan / kalimat, maks 400 huruf; kosong kalau ASR
    tidak ada) → website menyorot kata yang salah ucap ("👂 Terdengar") supaya ejaannya bisa diperbaiki lewat kamus
Cache: hasil job selesai dengan cache_key sama (ikut `max`) dipakai ulang; suara mentah per baris juga di-cache di laptop
(data/cache/tts, tanpa `max` — ganti jendela cukup percepat ulang, tidak perlu bikin suara lagi).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
import time
from pathlib import Path

import numpy as np

from . import VERSION, ff, meter, mix, natural, post
from . import log as vlog
from . import speed as speedmod
from . import text as T
from .engines import EngineDown, EngineFailed
from .jobctx import JobCtx, JobError, Runtime

log = vlog.get("tts")

FAIL_MSG = "Mesin suara laptop gagal — website otomatis pakai cadangan Edge-TTS"
# v2: satu tarikan per baris + room tone + skor kealamian (hasil v1 tidak dipakai lagi → Generate ulang memberi suara baru)
CACHE_V = "tts-v2"
# satu tarikan: teks ucapan sampai sepanjang ini dibuat sekali jalan; lebih panjang → potongan berisi kalimat utuh
ONE_PASS_CHARS = 260
# take satu-tarikan terbaik masih salah ucap lebih dari ini → coba mode per kalimat
ONE_PASS_BAD = 0.35
# jumlah versi per potongan bila website tidak menentukan (settings.takes)
DEFAULT_TAKES = 3
# batas waktu per potongan dihitung dari panjang kalimat: max(LINE_BUDGET_MIN, LINE_BUDGET_PER_SEC × perkiraan durasi ucapan)
# (bawaan max(20 dtk, 8 × durasi); dulu tetap minimal 45 dtk). Jumlah versi direncanakan dari kecepatan laptop yang tercatat
# (speed.py) supaya muat; mesin tanpa synth_batch (pocket) tetap dibuat satu-satu dengan cek waktu seperti dulu (minimal 2 versi)
MIN_TAKES = 2
LINE_BUDGET_MIN = 20.0
LINE_BUDGET_PER_SEC = 8.0
TAKE_BUDGET_MIN = LINE_BUDGET_MIN  # nama lama
TAKE_BUDGET_PER_SEC = LINE_BUDGET_PER_SEC
# semua versi salah ucap → satu batch tambahan maksimal sekian versi (kalau waktunya masih ada)
EXTRA_TAKES = 2
# tempo alami dulu (native_fit): kelebihan sesudah jeda dipadatkan > 4% → buat ulang dengan cfg_weight + 0,2 (maks 0,85);
# versi cepat dipakai kalau atempo-nya lebih sedikit dan kejelasannya tidak memburuk > 0,05
NATIVE_OVER = 0.04
NATIVE_CFG_STEP = 0.2
NATIVE_CFG_MAX = 0.85
NATIVE_WORSE = 0.05
# mesin yang bisa bicara lebih cepat secara asli (cfg_weight lebih tinggi); lainnya langsung padatkan jeda + atempo
NATIVE_TEMPO_ENGINES = frozenset({"chatterbox"})
# percepatan maksimal (atempo) supaya VO adegan teaser muat di jendelanya — sama dengan MAX_SPEEDUP 30% di website
MAX_SPEED = 1.30
# ekor napas sesudah kata terakhir yang masih dihitung ucapan — sama dengan VO_SPEECH_PAD di lib/studio/timeline.ts
SPEECH_PAD = 0.12
# jeda di dalam baris yang boleh dipadatkan sebelum mempercepat suara: hening ≥ 0,2 dtk, disisakan min 0,12 dtk
PAUSE_MIN = 0.12
PAUSE_LEN = 0.20
# kecepatan yang boleh diminta website per baris (`speed`, × normal) — website memakai 0,85–1,3
SPEED_MIN, SPEED_MAX = 0.7, 1.5
# teks terdengar ASR per baris (row.heard) — sama dengan HEARD_MAX di lib/studio/heard.ts
HEARD_MAX = 400


# ---------------------------------------------------------------- input
def _num(v, d: float, lo: float, hi: float) -> float:
    try:
        x = float(str(v).replace(",", "."))
        return d if math.isnan(x) else max(lo, min(hi, x))
    except (TypeError, ValueError):
        return d


def norm_settings(raw: dict | None, default_takes: int = DEFAULT_TAKES) -> dict:
    s = raw if isinstance(raw, dict) else {}
    return {
        "exaggeration": round(_num(s.get("exaggeration"), 0.6, 0.25, 1.0), 3),
        "cfg_weight": round(_num(s.get("cfg_weight", s.get("cfg")), 0.35, 0.0, 1.0), 3),
        "temperature": round(_num(s.get("temperature"), 0.8, 0.3, 1.2), 3),
        "takes": int(_num(s.get("takes"), default_takes, 1, 4)),
    }


# penanda job 🎧 Coba ejaan dari website (settings.purpose) — sama dengan TRY_PURPOSE di lib/studio/client.ts
TRY_PURPOSE = "coba-ejaan"


def is_trial(raw) -> bool:
    return isinstance(raw, dict) and raw.get("purpose") == TRY_PURPOSE


# batas teks ucapan akhir per kalimat (sama dengan SPELL_MAX di lib/studio/pronounce.ts)
SPELL_MAX = 4000


def parse_lines(raw) -> list[dict]:
    out, seen = [], set()
    for i, x in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(x, dict):
            continue
        text = T.clean_text(str(x.get("text") or ""))[:1200]
        if not text:
            continue
        lid = re.sub(r"[^\w-]", "", str(x.get("id") or ""))[:60] or f"l{i + 1}"
        while lid in seen:
            lid += "x"
        seen.add(lid)
        # teks ucapan akhir (angka sudah jadi kata + kamus ejaan, dibentuk browser) bisa beberapa kali lebih panjang dari teks:
        # batasnya sama dengan SPELL_MAX di lib/studio/pronounce.ts — lewat batas → gagal dengan pesan jelas (bukan dipotong diam-diam,
        # yang membuat akhir kalimat tidak terucap tapi VO tetap dianggap cocok dengan naskah)
        spell = T.clean_text(str(x.get("spell") or "")) or None
        if spell and len(spell) > SPELL_MAX:
            raise JobError(f"Teks ucapan kalimat {i + 1} kepanjangan setelah angka & kamus ejaan dieja ({len(spell)} dari maks {SPELL_MAX} huruf). Pecah kalimatnya atau persingkat ejaan di Kamus.")
        st = x.get("start")
        start = _num(st, -1, 0, 3600) if st is not None else -1
        # `max` (opsional) = jendela ucapan maksimal (detik) untuk adegan teaser; kosong / ≤ 0 = tidak dibatasi (job lama)
        mx = x.get("max")
        mx = round(_num(mx, 0, 0, 3600), 3) if mx is not None else 0
        # `speed` (opsional) = kecepatan diatur sendiri (× normal); kosong / bukan angka = otomatis (job lama)
        sp = x.get("speed")
        sp = round(_num(sp, 0, SPEED_MIN, SPEED_MAX), 3) if sp not in (None, "") and _num(sp, 0, 0, 10) > 0 else None
        # `seed` (opsional) = benih acak dasar semua versi baris ini (🎧 Coba ejaan: semua kandidat ejaan memakai benih yang sama supaya
        # bedanya hanya dari ejaan); kosong = benih dari teks (job lama)
        sd = x.get("seed")
        try:
            sd = int(sd) if isinstance(sd, (int, float, str)) and not isinstance(sd, bool) and str(sd).strip() else None
        except (TypeError, ValueError, OverflowError):
            sd = None
        sd = sd if sd is not None and 0 <= sd <= 2**31 - 2 else None
        out.append({"id": lid, "scene_id": str(x.get("scene_id") or ""), "text": text, "spell": spell, "start": start if start >= 0 else None, "max": mx if mx > 0 else None, "speed": sp, "seed": sd})
    return out


# ---------------------------------------------------------------- suara referensi
def voice_ref(rt: Runtime, voice_id: str | None, ctx: JobCtx | None = None) -> tuple[dict, Path, str]:
    from . import jobs_clean

    supa = rt.supa
    if not voice_id:  # suara dihapus saat job masih antri (voice_id jadi null) → jangan diam-diam pakai suara orang lain
        raise JobError("Suara yang dipilih sudah dihapus dari bank suara. Pilih suara lain.")
    rows = supa.select("studio_voices", id=f"eq.{voice_id}", select="*")
    if not rows:
        raise JobError("Suara tidak ditemukan di bank suara. Pilih suara lain atau tambahkan rekaman dulu.")
    v = rows[0]
    if not v.get("consent"):
        raise JobError("Suara ini belum ada izin pemiliknya — tidak bisa dipakai untuk meniru suara.")
    if not v.get("clean_path") or v.get("status") != "siap":
        if ctx:
            ctx.progress(0.02, "Membersihkan rekaman referensi dulu…", force=True)
        v = jobs_clean.clean_voice(rt, v)
    elif jobs_clean.outdated(v):
        # dibersihkan pembersih lama (potongan paling datar) → bersihkan ulang SEKALI; gagal → tetap pakai hasil bersih lama
        if ctx:
            ctx.progress(0.02, "Memperbarui potongan rekaman referensi (sekali saja)…", force=True)
        nv = jobs_clean.reclean(rt, v)
        v = nv if nv.get("clean_path") and nv.get("status") == "siap" else v
    # versi pembersih ikut tag file lokal: clean_path sama (ditimpa) tapi isinya baru → unduh ulang
    tag = hashlib.sha1(f"{v['clean_path']}|{v.get('updated_at')}|{jobs_clean.clean_ver(v)}".encode()).hexdigest()[:12]
    ref = rt.cfg.cache / "voices" / v["id"] / f"clean-{tag}.wav"
    if not ref.exists():
        rt.supa.download(v["clean_path"], ref)
    vhash = hashlib.sha1(ref.read_bytes()).hexdigest()[:16]
    return v, ref, vhash


# ---------------------------------------------------------------- cache
def _sha(obj) -> str:
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def line_key(engine: str, vhash: str, ln: dict, st: dict) -> str:
    # `seed` hanya ikut kalau ada → kunci baris lama tetap sama
    return _sha([CACHE_V, engine, vhash, ln["text"], ln["spell"] or "", st] + ([{"seed": ln["seed"]}] if ln.get("seed") is not None else []))


def job_key(engine: str, vhash: str, lines: list[dict], st: dict) -> str:
    # `max`, `speed` & `seed` hanya ikut kalau ada → kunci job lama (tanpa ketiganya) tetap sama
    return _sha(
        [
            CACHE_V,
            engine,
            vhash,
            st,
            [
                [x["id"], x["scene_id"], x["text"], x["spell"] or "", x["start"]]
                + ([x["max"]] if x.get("max") else [])
                + ([{"speed": x["speed"]}] if x.get("speed") else [])
                + ([{"seed": x["seed"]}] if x.get("seed") is not None else [])
                for x in lines
            ],
        ]
    )


class LineCache:
    def __init__(self, folder: Path):
        self.dir = folder
        folder.mkdir(parents=True, exist_ok=True)

    def get(self, key: str) -> tuple[Path, dict] | None:
        w, j = self.dir / f"{key}.wav", self.dir / f"{key}.json"
        if w.exists() and j.exists():
            try:
                return w, json.loads(j.read_text(encoding="utf-8"))
            except ValueError:
                return None
        return None

    def put(self, key: str, wav: Path, meta: dict) -> Path:
        dst = self.dir / f"{key}.wav"
        shutil.copyfile(wav, dst)
        (self.dir / f"{key}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        return dst


# ---------------------------------------------------------------- pilih take
def _longest_gap(y: np.ndarray, sr: int) -> float:
    fd = meter.frame_db(y, sr, 0.03, 0.01)
    sp = fd > max(float(fd.max()) - 40, -55)
    idx = np.where(sp)[0]
    if len(idx) < 2:
        return 0.0
    inner = ~sp[idx[0] : idx[-1] + 1]
    best = cur = 0
    for v in inner:
        cur = cur + 1 if v else 0
        best = max(best, cur)
    return best * 0.01


def score_take(y: np.ndarray, sr: int, expected: str, heard: str | None) -> dict:
    """skor lebih kecil = lebih jelas. heard=None → ASR tidak ada, pakai cek audio saja"""
    dur = len(y) / sr
    exp_dur = max(0.6, len(expected) / 14.5)  # ±14,5 huruf/detik untuk bicara bahasa Indonesia
    r = max(dur, 0.05) / exp_dur
    pen = 0.0
    if r < 0.55 or r > 1.9:
        pen += 0.4 * abs(math.log(r))
    gap = _longest_gap(y, sr)
    if gap > 0.8:
        pen += 0.3 * (gap - 0.8)
    if y.size and float(np.mean(np.abs(y) > 0.99)) > 0.001:
        pen += 0.2
    if heard is None:
        return {"score": round(pen, 4), "wer": None, "heard": None, "dur": round(dur, 2)}
    w, c = T.wer(expected, heard), T.cer(expected, heard)
    return {"score": round(0.7 * w + 0.3 * c + pen, 4), "wer": round(w, 3), "heard": heard, "dur": round(dur, 2)}


def take_seed(sentence: str, k: int, base: int | None = None) -> int:
    """benih versi ke-k: dari teks (bawaan) atau dari `base` (baris punya `seed`: sama untuk semua kandidat 🎧 Coba ejaan)"""
    b = int(hashlib.sha1(sentence.encode("utf-8")).hexdigest()[:8], 16) if base is None else int(base)
    return (b + 7919 * k) % (2**31 - 1)


def _cfg_num(cfg, name: str, d: float) -> float:
    v = getattr(cfg, name, None) if cfg is not None else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0 else d


def line_budget(sentence: str, cfg=None) -> float:
    """batas waktu (detik) membuat semua versi untuk satu potongan teks: max(LINE_BUDGET_MIN, LINE_BUDGET_PER_SEC × perkiraan ucapan)"""
    mn = _cfg_num(cfg, "line_budget_min", LINE_BUDGET_MIN)
    per = _cfg_num(cfg, "line_budget_per_sec", LINE_BUDGET_PER_SEC)
    return max(mn, per * speedmod.est_audio_sec(len(sentence)))


def take_budget(sentence: str) -> float:
    """nama lama line_budget (bawaan .env)"""
    return line_budget(sentence)


def plan_takes(name: str, sentence: str, want: int, budget: float, speed, batch: bool) -> int:
    """
    jumlah versi terbesar ≤ `want` yang perkiraan waktunya (speed.estimate; batch = sekaligus, selain itu n × 1 versi) masih muat
    di `budget`; minimal 1. Tanpa catatan kecepatan → `want` apa adanya. Dikurangi → alasannya dicatat di log.
    """
    want = max(1, int(want))
    if speed is None or want <= 1:
        return want
    chars = len(sentence)

    def est(n: int) -> float:
        return float(speed.estimate(name, chars, n)) if batch else n * float(speed.estimate(name, chars, 1))

    n = want
    while n > 1 and est(n) > budget:
        n -= 1
    if n < want:
        log.info(
            "  laptop: %d versi (bukan %d) supaya muat batas %s dtk — %d versi diperkirakan %s dtk",
            n, want, _n1(budget, 0), want, _n1(est(want), 0),
        )
    return n


def _n1(x: float, d: int = 1) -> str:
    """angka gaya Indonesia (koma desimal) untuk log"""
    return f"{float(x):.{d}f}".replace(".", ",")


def _takes_beam(asr) -> bool:
    import inspect

    try:
        return "beam" in inspect.signature(asr.transcribe).parameters
    except (TypeError, ValueError):
        return False


def heard_take(asr, y: np.ndarray, sr: int, tmp: Path, k: int, beam: int = 1) -> str | None:
    """teks yang terdengar ASR untuk satu take; ASR baru → langsung dari array 16 kHz (tanpa tulis wav), beam kecil"""
    if asr is None or not asr.available or not y.size:
        return None
    try:
        if _takes_beam(asr):
            return asr.transcribe(natural.to16k(y, sr), words=False, beam=beam)[0]
        p = ff.write_wav(tmp / f"take-{k}.wav", y, sr)
        return asr.transcribe(p, words=False)[0]
    except Exception as e:
        log.warning("Cek ASR gagal (%s) — take dinilai dari audio saja.", e)
        return None


def choose_take(takes: list[tuple[np.ndarray, dict]], sr: int) -> int:
    """
    indeks take terpilih: kejelasan (score) utama; take yang kejelasannya dalam +natural.NEAR dari terbaik dinilai kealamiannya
    (nada pyin + MOS UTMOS bila ada) dan bersaing di situ. Take di luar itu tidak dinilai (hemat waktu). Info nada/MOS ditulis ke
    dict skor take yang dinilai.
    """
    best = min(float(sc["score"]) for _, sc in takes)
    for y, sc in takes:
        if float(sc["score"]) <= best + natural.NEAR + 1e-9:
            nat = natural.naturalness(y, sr)
            sc.update({"st": nat["st"], "mono": nat["mono"], "mos": nat["mos"]})
    return natural.choose([sc for _, sc in takes])


def pick_take(engine, sentence: str, ref: Path, st: dict, asr, tmp: Path, on_take=None, seed: int | None = None, speed=None, cfg=None) -> tuple[np.ndarray, dict]:
    """
    Buat beberapa versi satu potongan teks lalu pilih yang paling jelas (+ alami). Mesin dengan synth_batch (Chatterbox) → semua
    versi dibuat SEKALIGUS dalam satu panggilan (jumlahnya direncanakan dari `speed` supaya muat batas waktu); semua salah ucap →
    satu batch tambahan maks 2 versi kalau waktunya masih ada. Mesin lain → satu-satu dengan cek waktu seperti dulu.
    `speed` (speed.Speed) & `cfg` opsional — pemanggil lama tanpa keduanya tetap jalan.
    """
    cfg = cfg if cfg is not None else getattr(engine, "cfg", None)
    name = str(getattr(engine, "name", "") or "mesin")
    beam = int(_cfg_num(cfg, "asr_beam_takes", 1))
    budget = take_budget(sentence) if cfg is None else line_budget(sentence, cfg)
    batch_fn = getattr(engine, "synth_batch", None)
    batch = callable(batch_fn) and bool(getattr(cfg, "tts_batch", True) if cfg is not None else True)
    takes: list[tuple[np.ndarray, dict]] = []
    t0 = time.monotonic()
    trial = bool(st.get("trial"))
    want = 1 if trial else int(st["takes"])

    def add(k: int, y: np.ndarray) -> str | None:
        # hening awal/akhir dibuang tanpa memakan ekor napas / nada turun akhir kalimat (sisa 150 ms + fade 30 ms)
        y = natural.trim_take(y, engine.sr)
        heard = heard_take(asr, y, engine.sr, tmp, k, beam)
        sc = score_take(y, engine.sr, sentence, heard)
        sc["take"] = k + 1
        takes.append((y, sc))
        if on_take:
            on_take(k)
        return heard

    if batch:
        n = plan_takes(name, sentence, want, budget, speed, True)

        def run(ks: list[int]) -> tuple[float, bool]:
            t1 = time.monotonic()
            ys = batch_fn(sentence, ref, st, [take_seed(sentence, k, seed) for k in ks])
            wall = time.monotonic() - t1
            durs = [len(y) / engine.sr for y in ys]
            avg = sum(durs) / max(1, len(durs))
            if speed is not None:
                speed.record(name, avg, wall, len(ks))
            log.info("  %s dtk suara dalam %s dtk (%s)", _n1(avg), _n1(wall), f"{len(ks)} versi sekaligus" if len(ks) > 1 else "1 versi")
            got = [add(k, y) for k, y in zip(ks, ys)]
            return wall, any(h is not None for h in got)

        wall, heard_any = run(list(range(n)))
        # semua versi salah ucap (> 35%) → satu batch tambahan (maks 2 versi) kalau waktu masih ada
        if heard_any and not trial and min(t[1]["score"] for t in takes) > ONE_PASS_BAD:
            extra = EXTRA_TAKES
            spent = time.monotonic() - t0
            est = float(speed.estimate(name, len(sentence), extra)) if speed is not None else wall
            if spent + est <= budget:
                run(list(range(n, n + extra)))
            else:
                log.info("  semua versi kurang jelas, tapi versi tambahan tidak muat batas %s dtk (sudah %s dtk)", _n1(budget, 0), _n1(spent, 0))
    else:
        n = plan_takes(name, sentence, want, budget, speed, False)
        min_takes = min(MIN_TAKES, n)
        k = 0
        heard = None
        while k < n:
            t1 = time.monotonic()
            y = engine.synth(sentence, ref, st, take_seed(sentence, k, seed))
            if speed is not None:
                speed.record(name, len(y) / engine.sr, time.monotonic() - t1, 1)
            heard = add(k, y)
            k += 1
            # semua versi jelek (salah ucap > 35%) → coba maksimal 2 versi tambahan
            if k == n and n < want + EXTRA_TAKES and min(t[1]["score"] for t in takes) > ONE_PASS_BAD and heard is not None and not trial:
                n += 1
            # batas waktu wajar: minimal 2 versi, versi berikutnya hanya kalau perkiraan selesainya masih di dalam batas
            if k < n and k >= min_takes:
                spent = time.monotonic() - t0
                if spent + spent / k > budget:
                    log.info("  batas waktu %s dtk: %d versi dalam %s dtk — versi lain dilewati", _n1(budget, 0), k, _n1(spent, 0))
                    break
    i = choose_take(takes, engine.sr)
    best = takes[i]
    info = best[1]
    wers = [sc["wer"] for _, sc in takes if sc.get("wer") is not None]
    if wers:
        info["wer_min"] = round(min(wers), 3)
    if len(takes) > 1:
        info["alt"] = [{k_: sc.get(k_) for k_ in ("take", "score", "wer", "mos", "st")} for j, (_, sc) in enumerate(takes) if j != i]
        log.info(
            "  %d versi → pilih versi %d (skor %.2f, WER %s, MOS %s, nada ±%s st): %s",
            len(takes), info["take"], info["score"], info["wer"], info.get("mos"), info.get("st"), sentence[:60],
        )
    return best


# ---------------------------------------------------------------- satu baris VO
def _joined(parts: list[np.ndarray], labels: list[str], sr: int, bed, key: str) -> np.ndarray:
    """sambung potongan dengan jeda alami (natural.natural_pauses) berisi room tone + crossfade; hening sisa di ujung ikut dihitung"""
    parts = natural.match_levels(parts, sr)  # take tiap potongan bisa beda 2–4 dB → tanpa lompatan volume di sambungan
    targets = natural.natural_pauses(labels, key)
    gaps = [natural.gap_fill(parts[i], parts[i + 1], sr, targets[i]) for i in range(len(parts) - 1)]
    return natural.join(parts, gaps, sr, bed, seed=int(hashlib.sha1(key.encode("utf-8")).hexdigest()[:6], 16))


def per_sentence(engine, sents: list[str], ref: Path, st: dict, asr, work: Path, tick, bed, key: str, **kw) -> tuple[np.ndarray, dict]:
    """
    mode lama per kalimat untuk satu potongan: tiap kalimat dipilih sendiri lalu disambung room tone. Skor = rata-rata berbobot
    huruf. `kw` diteruskan ke pick_take (seed, dan opsional speed / cfg).
    """
    ys, infos = [], []
    for s in sents:
        y, info = pick_take(engine, s, ref, st, asr, work, tick, **kw)
        ys.append(y)
        infos.append(info)
    w = [max(1, len(s)) for s in sents]

    def avg(k: str) -> float | None:
        vals = [(float(i[k]), wi) for i, wi in zip(infos, w) if isinstance(i.get(k), (int, float))]
        return round(sum(a * b for a, b in vals) / sum(b for _, b in vals), 4) if len(vals) == len(infos) else None

    y = _joined(ys, sents, engine.sr, bed, key)
    nat = natural.summary(infos)
    info = {"score": avg("score"), "wer": avg("wer"), "dur": round(len(y) / engine.sr, 2), "mode": "per-kalimat", "parts": infos, "mos": nat["mos"], "st": nat["st"]}
    return y, info


def make_line(engine, ln: dict, ref: Path, st: dict, asr, work: Path, on_step=None, speed=None, cfg=None) -> tuple[Path, dict]:
    """
    satu baris VO. `speed` (rt.speed: catatan kecepatan → jumlah versi yang muat batas waktu + perkiraan selesai) dan `cfg`
    (rt.cfg: LINE_BUDGET_*, ASR_BEAM_TAKES, TTS_BATCH) opsional — pemanggil lama tanpa keduanya tetap jalan seperti dulu.
    """
    spoken = ln["spell"] or ln["text"]
    chunks = T.chunk_text(spoken, ONE_PASS_CHARS) or [spoken]
    # benih dasar dari website (hanya dikirim kalau ada → pemanggilan lama pick_take tetap sama); speed/cfg juga hanya kalau ada
    kw = {"seed": ln["seed"]} if ln.get("seed") is not None else {}
    if speed is not None:
        kw["speed"] = speed
    if cfg is not None:
        kw["cfg"] = cfg
    sr = engine.sr
    bed = natural.ref_bed(ref, sr)
    parts: list[np.ndarray] = []
    picks = []
    total_takes = len(chunks) * st["takes"]
    done = [0]
    n_sents = 0
    tidy = {"fixed": 0, "added": 0.0, "cut": 0.0}

    def tick(_k: int) -> None:
        done[0] += 1
        if on_step:
            on_step(min(1.0, done[0] / max(1, total_takes)))

    for ci, ch in enumerate(chunks):
        sents = T.split_sentences(ch) or [ch]
        n_sents += len(sents)
        y, info = pick_take(engine, ch, ref, st, asr, work, tick, **kw)
        info["mode"] = "satu-tarikan"
        # cadangan per kalimat hanya kalau SEMUA versi satu tarikan salah ucap (WER terkecil > 0,35), bukan cuma versi terpilih
        wer_min = info.get("wer_min", info.get("wer"))
        if wer_min is not None and float(wer_min) > ONE_PASS_BAD and len(sents) > 1 and not st.get("trial"):
            log.info("Baris %s: satu tarikan masih salah ucap (WER terkecil %.2f) → coba per kalimat", ln["id"], wer_min)
            total_takes += len(sents) * st["takes"]
            y2, info2 = per_sentence(engine, sents, ref, st, asr, work, tick, bed, f"{ln['text']}|{ci}", **kw)
            # intonasi per kalimat ter-reset (kurang natural) → dipakai hanya kalau JELAS lebih jelas (bukan selisih derau ASR)
            if info2["score"] is not None and float(info2["score"]) < float(info["score"]) - natural.NEAR:
                log.info("Baris %s: mode per kalimat lebih jelas (skor %.2f < %.2f) → dipakai", ln["id"], info2["score"], info["score"])
                y, info = y2, info2
        if info.get("mode") == "satu-tarikan":
            # jeda antar kalimat di dalam take: rapikan ke rentang alami dengan room tone (bukan hening digital)
            y, fx = natural.tidy_pauses(y, sr, sents, bed, seed=ci + 1)
            if fx["fixed"]:
                log.info("Baris %s: %d jeda dirapikan (+%.2f / −%.2f dtk)", ln["id"], fx["fixed"], fx["added"], fx["cut"])
                for k_ in tidy:
                    tidy[k_] = round(tidy[k_] + fx[k_], 3)
        picks.append(info)
        parts.append(y)
    labels = [(T.split_sentences(c) or [c])[-1] for c in chunks]
    raw_y = _joined(parts, labels, sr, bed, ln["text"]) if parts else np.zeros(sr // 2, np.float32)
    raw = ff.write_wav(work / f"{ln['id']}-raw.wav", raw_y if raw_y.size else np.zeros(sr // 2, np.float32), sr)
    final = work / f"{ln['id']}.wav"
    dur = post.process_vo(raw, final)
    words: list[dict] = []
    if asr is not None and asr.available:
        try:
            _, hyp = asr.transcribe(final, words=True)
            words = T.align_words(ln["text"], hyp, dur) if hyp else []
        except Exception as e:
            log.warning("Timestamp kata dari ASR gagal (%s) — diperkirakan.", e)
    if not words:
        words = T.estimate_words(ln["text"], dur)
    nat = natural.summary(picks)
    nat["mode"] = "per-kalimat" if any(p.get("mode") == "per-kalimat" for p in picks) else "satu-tarikan"
    meta = {"dur": round(dur, 3), "words": words, "takes": picks, "sentences": n_sents, "chunks": len(chunks), "natural": nat}
    if tidy["fixed"]:
        meta["tidy"] = tidy
    return final, meta


# ---------------------------------------------------------------- muat di jendela adegan teaser
def speech_end(meta: dict) -> float:
    """panjang ucapan asli: kata terakhir + 0,12 dtk (maks dur); tanpa timestamp kata = dur (sama dengan voSpeechEnd di website)"""
    dur = float(meta.get("dur") or 0)
    last = 0.0
    for w in meta.get("words") or []:
        try:
            last = max(last, float(w.get("e") or 0))
        except (AttributeError, TypeError, ValueError):
            continue
    return min(dur, last + SPEECH_PAD) if last > 0 else dur


def find_pauses(y: np.ndarray, sr: int) -> list[tuple[float, float]]:
    """
    Hening di DALAM ucapan (antara suara pertama & terakhir, bukan hening di ujung): [(mulai, akhir)] detik, panjang ≥ PAUSE_LEN.
    Hening = jendela 30 ms yang lebih pelan dari puncak − 40 dB (min -55 dBFS), sama dengan _longest_gap. Napas / desah yang
    terdengar tidak dihitung hening (tidak dipotong).
    """
    fd = meter.frame_db(y, sr, 0.03, 0.01)
    if fd.size < 3:
        return []
    sp = fd > max(float(fd.max()) - 40, -55)
    idx = np.where(sp)[0]
    if len(idx) < 2:
        return []
    hop, win = 0.01, 0.03
    out: list[tuple[float, float]] = []
    run = None
    for j in range(int(idx[0]), int(idx[-1]) + 1):
        if not sp[j]:
            run = j if run is None else run
        elif run is not None:
            a, b = run * hop, (j - 1) * hop + win  # gabungan jendela yang hening
            if b - a >= PAUSE_LEN - 1e-9:
                out.append((round(a, 4), round(b, 4)))
            run = None
    return out


def _remap(t: float, cuts: list[tuple[float, float]]) -> float:
    """detik di audio lama → detik di audio yang potongan `cuts` [(mulai, akhir)]-nya sudah dibuang"""
    gone = 0.0
    for a, b in cuts:
        if t >= b:
            gone += b - a
        elif t > a:
            gone += t - a
    return t - gone


def squeeze_pauses(wav: Path, meta: dict, need: float, work: Path, lid: str) -> tuple[Path, dict]:
    """
    Padatkan jeda di dalam baris (hening antar kalimat dari text.pauses, mis. "…" 0,45–0,62 dtk) sebanyak `need` detik — langkah
    termurah sebelum suara dipercepat: suara tidak diubah sama sekali, hanya hening di tengah tiap jeda yang dibuang (sebanding
    panjang jedanya), tiap jeda disisakan min PAUSE_MIN dtk. Waktu kata digeser ikut. Tidak ada jeda yang bisa dipadatkan → apa adanya.
    Balikan meta tambahan: squeeze (detik hening yang dibuang).
    """
    if need <= 1e-3:
        return wav, meta
    y, sr = ff.read_wav(wav)
    if y.ndim > 1:
        y = y.mean(axis=1)
    pauses = find_pauses(y, sr)
    room = [(a, b, (b - a) - PAUSE_MIN) for a, b in pauses if (b - a) - PAUSE_MIN > 0.005]
    total = sum(r for _, _, r in room)
    if total <= 0.005:
        return wav, meta
    take = min(need, total)
    cuts: list[tuple[float, float]] = []
    for a, b, r in room:
        c = r * take / total
        mid = (a + b) / 2
        cuts.append((mid - c / 2, mid + c / 2))
    # potong dari belakang (indeks depan tidak bergeser), crossfade 10 ms di titik potong supaya room tone / napas tidak klik
    y2 = np.asarray(y, dtype=np.float32)
    for a, b in reversed(cuts):
        y2 = natural.cut(y2, int(round(a * sr)), int(round(b * sr)), sr)
    dst = ff.write_wav(work / f"{lid}-sq.wav", y2, sr)
    dur = len(y2) / sr
    words = [{**w, "s": round(_remap(float(w.get("s") or 0), cuts), 3), "e": round(_remap(float(w.get("e") or 0), cuts), 3)} for w in meta.get("words") or [] if isinstance(w, dict)]
    gone = round(sum(b - a for a, b in cuts), 3)
    log.info("Baris %s: %d jeda dipadatkan, %.2f dtk hening dibuang", lid, len(cuts), gone)
    return dst, {**meta, "dur": round(dur, 3), "words": words, "squeeze": round(float(meta.get("squeeze") or 0) + gone, 3)}


def _stretch(wav: Path, meta: dict, f: float, work: Path, lid: str, tag: str) -> tuple[Path, dict] | None:
    """time-stretch ffmpeg atempo faktor `f` (nada tetap), waktu kata & dur diskalakan, loudness disamakan lagi; gagal → None"""
    y = ff.decode(wav, post.SR, mono=True, af=f"atempo={f:.5f}")
    if y.size < int(0.05 * post.SR):
        log.warning("Baris %s: hasil ubah kecepatan kosong — dipakai versi asli.", lid)
        return None
    y = post.fade(y, post.SR, 0.003, 0.02)
    y, _ = meter.normalize(y, post.SR, post.VO_LUFS, post.VO_TP)
    dst = ff.write_wav(work / f"{lid}-{tag}.wav", y, post.SR)
    old = float(meta.get("dur") or 0)
    new = len(y) / post.SR
    k = new / old if old > 0 else 1 / f
    words = [{**w, "s": round(float(w.get("s") or 0) * k, 3), "e": round(float(w.get("e") or 0) * k, 3)} for w in meta.get("words") or [] if isinstance(w, dict)]
    return dst, {**meta, "dur": round(new, 3), "words": words}


def fit_to_max(wav: Path, meta: dict, mx: float | None, work: Path, lid: str) -> tuple[Path, dict]:
    """
    Ucapan lebih panjang dari `mx` detik → (1) jeda di dalam baris dipadatkan dulu (squeeze_pauses, min 0,12 dtk per jeda);
    (2) masih kepanjangan → time-stretch ffmpeg atempo (tempo naik, nada tetap), faktor ≈ min(1,3, ucapan/mx).
    Waktu kata & dur disesuaikan, loudness disamakan lagi (-16 LUFS / TP -1,5). Tanpa `mx` / sudah muat → apa adanya.
    Balikan meta tambahan: squeeze (detik jeda dibuang), speed (persen dipercepat), fit (muat atau belum walau sudah maks).
    """
    if not mx or mx <= 0:
        return wav, meta
    sp = speech_end(meta)
    if sp <= mx + 1e-3:
        return wav, meta
    sp0 = sp
    wav, meta = squeeze_pauses(wav, meta, sp - mx, work, lid)
    sp = speech_end(meta)
    if sp <= mx + 1e-3:
        log.info("Baris %s: ucapan %.2f dtk > jendela %.2f dtk → cukup jeda dipadatkan %.2f dtk (muat)", lid, sp0, mx, meta.get("squeeze") or 0)
        return wav, {**meta, "max": mx, "fit": True}
    # ucapan baru = min(dur/f, kata_terakhir/f + 0,12) — ekor 0,12 dtk tidak ikut terskala, jadi faktor dari kata terakhir
    # dihitung terhadap (mx − 0,12); pilih faktor terkecil yang cukup
    dur = float(meta.get("dur") or 0)
    last = sp - SPEECH_PAD if sp < dur else 0.0
    need = dur / mx
    if last > 0 and mx > SPEECH_PAD:
        need = min(need, last / (mx - SPEECH_PAD))
    f = min(MAX_SPEED, need)
    if f < 1.005:  # selisih < 0,5% — tidak terdengar, tidak perlu diproses
        return wav, ({**meta, "max": mx, "fit": sp <= mx + 0.01} if meta.get("squeeze") else meta)
    got = _stretch(wav, meta, f, work, lid, "fit")
    if not got:
        return wav, meta
    dst, out = got
    out = {**out, "speed": int(round((f - 1) * 100)), "max": mx}
    out["fit"] = speech_end(out) <= mx + 0.01
    log.info("Baris %s: ucapan %.2f dtk > jendela %.2f dtk → jeda dipadatkan %.2f dtk, dipercepat %.0f%% (%s)", lid, sp0, mx, out.get("squeeze") or 0, (f - 1) * 100, "muat" if out["fit"] else "masih belum muat")
    return dst, out


def apply_speed(wav: Path, meta: dict, f: float, work: Path, lid: str) -> tuple[Path, dict]:
    """
    Kecepatan diatur sendiri di website (job baris `speed`, × normal): atempo persis faktor itu (nada tetap), tanpa memadatkan jeda
    dan tanpa melihat `max`. Balikan meta tambahan: tempo (faktor), speed (persen, negatif = diperlambat).
    """
    f = max(SPEED_MIN, min(SPEED_MAX, float(f)))
    if abs(f - 1) < 0.005:
        return wav, {**meta, "tempo": 1.0}
    got = _stretch(wav, meta, f, work, lid, "tempo")
    if not got:
        return wav, meta
    dst, out = got
    log.info("Baris %s: kecepatan diatur %.2f× → %.2f dtk", lid, f, out["dur"])
    return dst, {**out, "tempo": round(f, 3), "speed": int(round((f - 1) * 100))}


def overflow(wav: Path, meta: dict, mx: float, work: Path, lid: str) -> float:
    """kelebihan relatif ucapan terhadap jendela `mx` SESUDAH jeda dipadatkan (0 = muat tanpa atempo)"""
    sp = speech_end(meta)
    if not mx or sp <= mx + 1e-3:
        return 0.0
    _, m2 = squeeze_pauses(wav, meta, sp - mx, work, f"{lid}-cek")
    return max(0.0, speech_end(m2) / mx - 1.0)


def line_clarity(meta: dict) -> float | None:
    """skor kejelasan satu baris (rata-rata skor take terpilih berbobot durasi; lebih kecil = lebih jelas)"""
    vals = [(float(t["score"]), max(0.05, float(t.get("dur") or 0.05))) for t in meta.get("takes") or [] if isinstance(t, dict) and isinstance(t.get("score"), (int, float))]
    if not vals:
        return None
    return sum(a * b for a, b in vals) / sum(b for _, b in vals)


def line_heard(meta: dict) -> str | None:
    """
    teks yang terdengar oleh pengecek ucapan (ASR) untuk baris ini, untuk sorot salah dengar di website (row.heard): gabungan
    `heard` take terpilih per potongan (meta.takes, urut); potongan mode per kalimat tidak punya `heard` sendiri → gabungan
    `parts[].heard` per kalimat. Ada potongan / kalimat tanpa hasil ASR (ASR mati / gagal) → None: teks sebagian akan membuat
    website menyorot kata yang sebenarnya terucap sebagai "tidak terdengar". Spasi dirapikan, maks 400 huruf (potong di spasi).
    """
    takes = meta.get("takes")
    if not isinstance(takes, list) or not takes:
        return None
    got: list[str] = []
    for t in takes:
        if not isinstance(t, dict):
            return None
        if isinstance(t.get("heard"), str):
            got.append(t["heard"])
            continue
        parts = t.get("parts")
        if not isinstance(parts, list) or not parts:
            return None
        for p in parts:
            h = p.get("heard") if isinstance(p, dict) else None
            if not isinstance(h, str):
                return None
            got.append(h)
    s = re.sub(r"\s+", " ", " ".join(got)).strip()
    if not s:
        return None
    if len(s) > HEARD_MAX:
        cut = s[:HEARD_MAX]
        sp = cut.rfind(" ")
        s = (cut[:sp] if sp > HEARD_MAX * 0.6 else cut).strip()
    return s


def native_fit(wav: Path, meta: dict, mx: float | None, st: dict, work: Path, lid: str, regen) -> tuple[Path, dict]:
    """
    Tempo alami dulu, baru atempo (baris adegan teaser yang punya `max`): sesudah jeda dipadatkan masih kelebihan > 4% → `regen(st2)`
    membuat ulang baris SEKALI dengan cfg_weight + 0,2 (maks 0,85; exaggeration tetap) — balikan (wav, meta) atau None kalau mesin
    tidak bisa mengatur tempo asli. Dipakai versi yang butuh atempo paling sedikit selama kejelasannya tidak memburuk > 0,05; sisa
    kelebihan tetap lewat fit_to_max (padatkan jeda → atempo maks 1,3×). Meta tambahan: native (persen lebih cepat dari tempo asli),
    native_cfg. Tanpa `max` / sudah muat / kelebihan kecil → persis fit_to_max.
    """
    if not mx or mx <= 0:
        return fit_to_max(wav, meta, mx, work, lid)
    over = overflow(wav, meta, mx, work, lid)
    cw = float(st.get("cfg_weight", 0.35))
    if over <= NATIVE_OVER or cw >= NATIVE_CFG_MAX - 1e-6:
        return fit_to_max(wav, meta, mx, work, lid)
    st2 = {**st, "cfg_weight": round(min(NATIVE_CFG_MAX, cw + NATIVE_CFG_STEP), 3)}
    try:
        got = regen(st2)
    except (EngineDown, EngineFailed) as e:
        log.warning("Baris %s: buat ulang dengan tempo lebih cepat gagal (%s) — dipercepat biasa.", lid, e)
        got = None
    if not got:
        return fit_to_max(wav, meta, mx, work, lid)
    wav2, meta2 = got
    a_wav, a = fit_to_max(wav, meta, mx, work, lid)
    b_wav, b = fit_to_max(wav2, meta2, mx, work, f"{lid}-n")
    sa, sb = int(a.get("speed") or 0), int(b.get("speed") or 0)
    ca, cb = line_clarity(meta), line_clarity(meta2)
    clear_ok = ca is None or cb is None or cb <= ca + NATIVE_WORSE
    fit_a, fit_b = speech_end(a) <= mx + 0.01, speech_end(b) <= mx + 0.01
    sp1, sp2 = speech_end(meta), speech_end(meta2)
    native = int(round((sp1 / sp2 - 1) * 100)) if sp2 > 0 else 0
    if clear_ok and (sb < sa or (fit_b and not fit_a)) and native > 0:
        log.info("Baris %s: tempo asli dipercepat %d%% (cfg_weight %.2f) → atempo tinggal %d%% (sebelumnya %d%%)", lid, native, st2["cfg_weight"], sb, sa)
        return b_wav, {**b, "native": native, "native_cfg": st2["cfg_weight"]}
    log.info("Baris %s: versi tempo asli lebih cepat tidak membantu (lebih cepat %d%%, atempo %d%% vs %d%%, kejelasan %s vs %s) — pakai versi biasa", lid, native, sb, sa, None if cb is None else round(cb, 3), None if ca is None else round(ca, 3))
    return a_wav, a


def line_natural(meta: dict, manual: bool) -> dict:
    """ringkasan kealamian satu baris untuk website: MOS rata-rata (bila ada), variasi nada, mode, persen dipercepat asli vs atempo"""
    nat = meta.get("natural") if isinstance(meta.get("natural"), dict) else {}
    out = {"mos": nat.get("mos"), "st": nat.get("st"), "mono": nat.get("mono"), "mode": nat.get("mode") or "satu-tarikan"}
    out["native"] = int(meta.get("native") or 0)
    out["atempo"] = int(meta.get("speed") or 0)
    if manual:
        out["manual"] = True
    return out


def job_natural(rows: list[dict]) -> dict:
    """ringkasan kealamian satu job (rata-rata MOS & variasi nada, berapa baris monoton / dipercepat asli / di-atempo)"""
    nats = [r["natural"] for r in rows if isinstance(r.get("natural"), dict)]

    def mean(k: str) -> float | None:
        v = [float(n[k]) for n in nats if isinstance(n.get(k), (int, float))]
        return round(sum(v) / len(v), 3) if v else None

    return {
        "lines": len(nats),
        "mos": mean("mos"),
        "st": mean("st"),
        "monoton": sum(1 for n in nats if (n.get("mono") or 0) > 0.25),
        "native": sum(1 for n in nats if (n.get("native") or 0) > 0),
        "atempo": sum(1 for n in nats if (n.get("atempo") or 0) > 0 and not n.get("manual")),
        "per_kalimat": sum(1 for n in nats if n.get("mode") == "per-kalimat"),
        "mos_status": natural.mos_status(),
    }


# ---------------------------------------------------------------- job
# perkiraan sisa waktu (pesan job "· sisa ±40 dtk"): kerja di luar mesin suara per baris (cek ASR, ffmpeg, cache) & penutup job
ETA_LINE_EXTRA = 1.0
ETA_CACHED_LINE = 0.3
ETA_TAIL = 2.0
# waktu muat mesin bila belum pernah diukur (detik) — Chatterbox di RTX 5050 ±34 dtk
ETA_LOAD_DEFAULT = {"chatterbox": 35.0, "pocket": 10.0}


def _accepts(fn, name: str) -> bool:
    """fungsi `fn` menerima argumen kata kunci `name`? (make_line versi baru menerima speed=; versi lama tidak — dicek dari tanda
    tangannya, bukan dengan menangkap TypeError yang bisa saja berasal dari dalam fungsi)"""
    import inspect

    try:
        ps = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    return name in ps or any(p.kind is inspect.Parameter.VAR_KEYWORD for p in ps.values())


def _speed(rt: Runtime):
    """catatan kecepatan worker (rt.speed); tidak ada (tes / pemanggil lama) → catatan sementara berisi perkiraan bawaan"""
    if getattr(rt, "speed", None) is not None:
        return rt.speed
    try:
        from .speed import Speed

        return Speed(None)
    except ImportError:
        return None


def _engine_loaded(rt: Runtime, name: str) -> bool:
    try:
        return name in rt.engines.loaded()
    except Exception:  # pengelola mesin palsu / lama tanpa loaded() → anggap sudah siap
        return True


def run(ctx: JobCtx) -> None:
    rt = ctx.rt
    job = ctx.job
    lines = parse_lines(job.get("lines"))
    if not lines:
        raise JobError("Tidak ada kalimat VO untuk dibuat.")
    # takes bila website tidak menentukan: TAKES di .env (bawaan 3, 1–4) — dihormati apa adanya, termasuk 1–2 untuk laptop lambat
    st = norm_settings(job.get("settings"), int(getattr(rt.cfg, "takes", DEFAULT_TAKES) or DEFAULT_TAKES))
    # 🎧 Coba ejaan: 1 versi apa adanya per kandidat (tanpa versi tambahan / mode per kalimat yang dipilih dari cek ASR — ASR tidak
    # bisa membedakan ə dan é, jadi pemilihan itu justru membuat perbandingan antar-ejaan tidak adil)
    if is_trial(job.get("settings")):
        st = {**st, "takes": 1, "trial": True}
    natural.configure(bool(getattr(rt.cfg, "natural_mos", True)), Path(rt.cfg.models) / "torch-hub" if getattr(rt.cfg, "models", None) else None)
    voice, ref, vhash = voice_ref(rt, job.get("voice_id"), ctx)
    order = rt.engines.order(job.get("engine"))

    # cache tingkat job: naskah + suara + setelan + posisi sama → pakai hasil lama
    first = next((e for e in order if not rt.engines.is_down(e)), order[0])
    key = job_key(first, vhash, lines, st)
    prev = rt.supa.select("studio_voice_jobs", select="id,result,engine_used", cache_key=f"eq.{key}", status="eq.selesai", order="finished_at.desc", limit="1")
    if prev and prev[0].get("result") and prev[0]["id"] != ctx.id:
        ctx.done({"result": prev[0]["result"], "engine_used": prev[0].get("engine_used") or first, "cache_key": key}, "Selesai (memakai hasil yang sama sebelumnya)")
        log.info("Job %s: pakai cache dari job %s", ctx.id, prev[0]["id"])
        return

    errors = []
    for name in order:
        try:
            result = synth_job(ctx, name, lines, voice, ref, vhash, st)
        except EngineDown as e:
            errors.append(f"{name}: {e}")
            continue
        except EngineFailed as e:
            errors.append(f"{name}: {e}")
            rt.engines.mark_down(name, str(e))
            continue
        msg = "Suara selesai dibuat" + (" (Chatterbox, GPU laptop)" if name == "chatterbox" else f" dengan pocket-tts (CPU laptop). Kredit: {result.get('credit')}")
        ctx.done({"result": result, "engine_used": name, "cache_key": job_key(name, vhash, lines, st)}, msg)
        rows = result.get("lines") or []
        voice_sec = sum(float(r.get("dur") or 0) for r in rows)
        hits = int(getattr(ctx, "cache_hits", 0) or 0)
        est0 = getattr(ctx, "est0", None)
        log.info(
            "Job selesai: %d kalimat%s, %.0f dtk suara, %.0f dtk proses%s",
            len(rows), f" ({hits} dari cache)" if hits else "", voice_sec, time.monotonic() - getattr(ctx, "t0", time.monotonic()),
            f" (perkiraan awal {est0:.0f} dtk)" if isinstance(est0, (int, float)) else "",
        )
        return
    log.error("Semua mesin suara gagal: %s", " | ".join(errors))
    raise JobError(FAIL_MSG)


def synth_job(ctx: JobCtx, name: str, lines: list[dict], voice: dict, ref: Path, vhash: str, st: dict) -> dict:
    from .supa import UploadPool, norm_path

    rt = ctx.rt
    cache = LineCache(rt.cfg.cache / "tts")
    work = rt.cfg.tmp / f"tts-{ctx.id}"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    engine = None
    asr = rt.asr
    n = len(lines)
    out_lines: list[dict] = []
    clips: list[tuple[np.ndarray, float]] = []
    cues: list[dict] = []
    t_next = 0.0
    speed = _speed(rt)
    # make_line versi baru (mesin cepat) menerima speed= untuk batas waktu & jumlah versi; versi lama tidak → kecepatan dicatat di sini
    line_kw = {"speed": speed} if speed is not None and _accepts(make_line, "speed") else {}
    takes = int(st.get("takes") or 1)

    # perkiraan awal: baris yang belum ada di cache × kecepatan mesin (+ waktu muat mesin kalau belum dimuat)
    keys = [line_key(name, vhash, ln, st) for ln in lines]
    hits = [cache.get(k) for k in keys]
    est = [
        ETA_CACHED_LINE if hits[i] else (speed.estimate(name, len(ln["spell"] or ln["text"]), takes) if speed is not None else 6.0 * len(ln["spell"] or ln["text"]) / 14.5) + ETA_LINE_EXTRA
        for i, ln in enumerate(lines)
    ]
    need_engine = any(h is None for h in hits)
    load_left = 0.0
    if need_engine and not _engine_loaded(rt, name):
        load_left = (speed.load_sec(name) if speed is not None else None) or ETA_LOAD_DEFAULT.get(name, 30.0)
    tail = ETA_TAIL + 0.1 * n
    ctx.est0 = round(sum(est) + load_left + tail, 1)
    ctx.cache_hits = sum(1 for h in hits if h)
    ctx.eta(ctx.est0)
    real_done = est_done = 0.0  # waktu nyata vs perkiraan baris yang sudah dibuat → koreksi perkiraan sisa

    def left_after(i: int) -> float:
        k = max(0.3, min(5.0, real_done / est_done)) if est_done > 0.5 else 1.0
        return sum(est[i + 1 :]) * k + load_left + tail

    pool = UploadPool(rt.supa, workers=int(getattr(rt.cfg, "upload_workers", 3) or 3))
    try:
        for i, ln in enumerate(lines):
            if i:
                ctx.check_cancel()  # dibatalkan dari website → berhenti di sini (antar baris), bukan di tengah GPU
                pool.check()  # unggahan baris sebelumnya gagal → jangan buang waktu GPU untuk baris lain
            base = 0.05 + 0.85 * i / n
            ctx.progress(base, f"Membuat suara kalimat {i + 1} dari {n}…", force=True)
            k = keys[i]
            hit = hits[i]
            t_line = time.monotonic()
            if hit:
                wav, meta = hit
                log.info("Baris %s: pakai cache", ln["id"])
            else:
                if engine is None:
                    ctx.progress(base, "Menyiapkan mesin suara…", force=True)
                    t_load = time.monotonic()
                    engine = rt.engines.get(name)
                    took = time.monotonic() - t_load
                    if took > 0.2 and speed is not None and not getattr(rt, "loading", False):
                        speed.record_load(name, took)  # dimuat di job ini (PRELOAD=0); saat pemanasan latar dicatat worker
                    load_left = 0.0
                    ctx.eta(left_after(i - 1))  # mesin sudah siap: sisa = baris ini dst.
                    t_line = time.monotonic()
                t_gen = time.monotonic()
                wav, meta = make_line(engine, ln, ref, st, asr, work, lambda f, b=base, ix=i: ctx.progress(b + 0.85 / n * 0.9 * f, f"Membuat suara kalimat {ix + 1} dari {n}…"), **line_kw)
                if not line_kw and speed is not None:
                    speed.record(name, float(meta.get("dur") or 0), time.monotonic() - t_gen, takes)
                wav = cache.put(k, wav, meta)
            # kecepatan diatur sendiri → atempo persis; selain itu adegan teaser: ucapan lebih panjang dari jendelanya → jeda
            # dipadatkan, lalu tempo asli dipercepat (buat ulang, cfg_weight naik) dan sisanya baru atempo (maks 1,3×) — cache baris
            # tetap suara mentah (versi cepat punya kunci cache sendiri)
            if ln.get("speed"):
                wav, meta = apply_speed(wav, meta, ln["speed"], work, ln["id"])
            else:

                def regen(st2: dict, ln=ln, base=base, i=i):
                    nonlocal engine
                    k2 = line_key(name, vhash, ln, st2)
                    hit2 = cache.get(k2)
                    if hit2:
                        log.info("Baris %s: versi tempo lebih cepat dari cache", ln["id"])
                        return hit2
                    if engine is None:
                        if name not in NATIVE_TEMPO_ENGINES:  # pocket-tts tidak punya tempo asli → jangan muat model sia-sia
                            return None
                        engine = rt.engines.get(name)
                    if not getattr(engine, "native_tempo", False):
                        return None
                    ctx.progress(base + 0.85 / n * 0.9, f"Kalimat {i + 1} kepanjangan — dibuat ulang dengan tempo bicara lebih cepat…", force=True)
                    wdir = work / "cepat"
                    wdir.mkdir(parents=True, exist_ok=True)
                    w2, m2 = make_line(engine, ln, ref, st2, asr, wdir, **line_kw)
                    return cache.put(k2, w2, m2), m2

                wav, meta = native_fit(wav, meta, ln.get("max"), st, work, ln["id"], regen)
            # mp3 dibuat & diunggah di latar (paralel) sementara baris berikutnya dibuat GPU
            path = norm_path(f"vo/{ctx.id}/{ln['id']}.mp3")
            pool.submit(path, lambda w=wav, d=work / f"{ln['id']}.mp3": ff.encode_mp3(w, d, 48000, "160k", mono=True), "audio/mpeg")
            start = ln["start"] if ln["start"] is not None else t_next
            t_next = start + meta["dur"] + 0.3
            y, sr = ff.read_wav(wav)
            clips.append((y if sr == 48000 else ff.decode(wav, 48000), start))
            cues.extend(T.group_cues(meta["words"], start))
            row = {"id": ln["id"], "scene_id": ln["scene_id"], "path": path, "dur": meta["dur"], "words": meta["words"], "start": start}
            if meta.get("speed"):
                row["speed"] = meta["speed"]
            if meta.get("tempo") is not None:
                row["tempo"] = meta["tempo"]
            if meta.get("squeeze"):
                row["squeeze"] = meta["squeeze"]
            row["natural"] = line_natural(meta, bool(ln.get("speed")))
            # teks yang terdengar ASR (versi terpilih yang benar-benar dipakai) → website menyorot kata yang salah ucap
            heard = line_heard(meta)
            if heard:
                row["heard"] = heard
            out_lines.append(row)
            # perkiraan sisa diperbarui dari waktu nyata baris yang sudah dibuat
            if not hit:
                real_done += time.monotonic() - t_line
                est_done += est[i]
            ctx.eta(left_after(i))
        ctx.progress(0.92, "Menyusun VO lengkap…", force=True)
        full = mix.place_clips(clips, 48000, tail=0.5, ceiling_db=-1.0)
        full_wav = ff.write_wav(work / "full.wav", full, 48000)
        # full.mp3 & srt diunggah bersamaan (sisa mp3 baris yang belum selesai ikut ditunggu)
        full_path = norm_path(f"vo/{ctx.id}/full.mp3")
        srt_path = norm_path(f"vo/{ctx.id}/full.srt")
        pool.submit(full_path, lambda: ff.encode_mp3(full_wav, work / "full.mp3", 48000, "160k", mono=True), "audio/mpeg")
        pool.submit(srt_path, T.to_srt(cues).encode("utf-8"), "application/x-subrip")
        ctx.eta(ETA_TAIL)
        ctx.progress(0.95, "Mengunggah VO…", force=True)
        pool.wait()
        eng_label = engine.label if engine else ("Bank suara · Chatterbox (GPU laptop)" if name == "chatterbox" else "Bank suara · pocket-tts (CPU laptop)")
        credit = getattr(engine, "credit", None) if engine else None
        if name == "pocket" and not credit:
            from .engines.pocket_engine import CREDIT

            credit = CREDIT
        return {
            "lines": out_lines,
            "full_path": full_path,
            "srt_path": srt_path,
            "dur": round(len(full) / 48000, 3),
            "engine": name,
            "label": eng_label,
            "credit": credit,
            "voice": {"id": voice["id"], "name": voice.get("name")},
            "settings": st,
            "natural": job_natural(out_lines),
            "worker": rt.cfg.worker_id,
            "versi": VERSION,
        }
    finally:
        pool.close(cancel=True)  # error / batal: unggahan yang belum mulai dibatalkan, yang sedang jalan ditunggu dulu
        shutil.rmtree(work, ignore_errors=True)
