"""
Job kind 'tts': VO dari bank suara.
  per baris → pecah kalimat → tiap kalimat dibuat 2 versi (takes) → pilih yang paling jelas (cek ASR: WER/CER + cek durasi/hening)
  → sambung dengan jeda alami (0,18–0,4 dtk; lebih panjang setelah "…") → post-processing ffmpeg (-16 LUFS / TP -1,5)
  → timestamp per kata (faster-whisper) dipetakan ke kata TEKS ASLI (kolom spell hanya untuk mesin suara)
  → upload vo/<job>/<baris>.mp3, vo/<job>/full.mp3 (tiap baris di detik `start`), vo/<job>/full.srt
Cache: hasil job selesai dengan cache_key sama dipakai ulang; per baris juga di-cache di laptop (data/cache/tts).
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import shutil
from pathlib import Path

import numpy as np

from . import VERSION, ff, meter, mix, post
from . import log as vlog
from . import text as T
from .engines import EngineDown, EngineFailed
from .jobctx import JobCtx, JobError, Runtime

log = vlog.get("tts")

FAIL_MSG = "Mesin suara laptop gagal — website otomatis pakai cadangan Edge-TTS"
CACHE_V = "tts-v1"
SEED_VOICE = "alif-energik"


# ---------------------------------------------------------------- input
def _num(v, d: float, lo: float, hi: float) -> float:
    try:
        x = float(str(v).replace(",", "."))
        return d if math.isnan(x) else max(lo, min(hi, x))
    except (TypeError, ValueError):
        return d


def norm_settings(raw: dict | None, default_takes: int = 2) -> dict:
    s = raw if isinstance(raw, dict) else {}
    return {
        "exaggeration": round(_num(s.get("exaggeration"), 0.6, 0.25, 1.0), 3),
        "cfg_weight": round(_num(s.get("cfg_weight", s.get("cfg")), 0.35, 0.0, 1.0), 3),
        "temperature": round(_num(s.get("temperature"), 0.8, 0.3, 1.2), 3),
        "takes": int(_num(s.get("takes"), default_takes, 1, 4)),
    }


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
        spell = T.clean_text(str(x.get("spell") or ""))[:1200] or None
        st = x.get("start")
        start = _num(st, -1, 0, 3600) if st is not None else -1
        out.append({"id": lid, "scene_id": str(x.get("scene_id") or ""), "text": text, "spell": spell, "start": start if start >= 0 else None})
    return out


# ---------------------------------------------------------------- suara referensi
def voice_ref(rt: Runtime, voice_id: str | None, ctx: JobCtx | None = None) -> tuple[dict, Path, str]:
    from . import jobs_clean

    supa = rt.supa
    if voice_id:
        rows = supa.select("studio_voices", id=f"eq.{voice_id}", select="*")
    else:  # tanpa pilihan: pakai suara bawaan bank (Alif - Energik)
        rows = supa.select("studio_voices", seed_key=f"eq.{SEED_VOICE}", select="*")
    if not rows:
        raise JobError("Suara tidak ditemukan di bank suara. Pilih suara lain atau tambahkan rekaman dulu.")
    v = rows[0]
    if not v.get("consent"):
        raise JobError("Suara ini belum ada izin pemiliknya — tidak bisa dipakai untuk meniru suara.")
    if not v.get("clean_path") or v.get("status") != "siap":
        if ctx:
            ctx.progress(0.02, "Membersihkan rekaman referensi dulu…", force=True)
        v = jobs_clean.clean_voice(rt, v)
    tag = hashlib.sha1(f"{v['clean_path']}|{v.get('updated_at')}".encode()).hexdigest()[:12]
    ref = rt.cfg.cache / "voices" / v["id"] / f"clean-{tag}.wav"
    if not ref.exists():
        rt.supa.download(v["clean_path"], ref)
    vhash = hashlib.sha1(ref.read_bytes()).hexdigest()[:16]
    return v, ref, vhash


# ---------------------------------------------------------------- cache
def _sha(obj) -> str:
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()


def line_key(engine: str, vhash: str, ln: dict, st: dict) -> str:
    return _sha([CACHE_V, engine, vhash, ln["text"], ln["spell"] or "", st])


def job_key(engine: str, vhash: str, lines: list[dict], st: dict) -> str:
    return _sha([CACHE_V, engine, vhash, st, [[x["id"], x["scene_id"], x["text"], x["spell"] or "", x["start"]] for x in lines]])


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


def take_seed(sentence: str, k: int) -> int:
    return (int(hashlib.sha1(sentence.encode("utf-8")).hexdigest()[:8], 16) + 7919 * k) % (2**31 - 1)


def pick_take(engine, sentence: str, ref: Path, st: dict, asr, tmp: Path, on_take=None) -> tuple[np.ndarray, dict]:
    takes: list[tuple[np.ndarray, dict]] = []
    n = st["takes"]
    k = 0
    while k < n:
        y = engine.synth(sentence, ref, st, take_seed(sentence, k))
        y = meter.trim_silence(y, engine.sr, -50, 0.04)
        heard = None
        if asr is not None and asr.available and y.size:
            p = ff.write_wav(tmp / f"take-{k}.wav", y, engine.sr)
            try:
                heard = asr.transcribe(p, words=False)[0]
            except Exception as e:
                log.warning("Cek ASR gagal (%s) — take dinilai dari audio saja.", e)
        sc = score_take(y, engine.sr, sentence, heard)
        sc["take"] = k + 1
        takes.append((y, sc))
        if on_take:
            on_take(k)
        k += 1
        # semua versi jelek (salah ucap > 35%) → coba maksimal 2 versi tambahan
        if k == n and n < st["takes"] + 2 and min(t[1]["score"] for t in takes) > 0.35 and heard is not None:
            n += 1
    best = min(takes, key=lambda t: t[1]["score"])
    if len(takes) > 1:
        log.info("  %d versi → pilih versi %d (skor %.2f, WER %s): %s", len(takes), best[1]["take"], best[1]["score"], best[1]["wer"], sentence[:60])
    return best


# ---------------------------------------------------------------- satu baris VO
def make_line(engine, ln: dict, ref: Path, st: dict, asr, work: Path, on_step=None) -> tuple[Path, dict]:
    spoken = ln["spell"] or ln["text"]
    sents = T.split_sentences(spoken) or [spoken]
    gaps = T.pauses(sents, ln["text"])
    sr = engine.sr
    parts: list[np.ndarray] = []
    picks = []
    total_takes = len(sents) * st["takes"]
    done = [0]

    def tick(_k: int) -> None:
        done[0] += 1
        if on_step:
            on_step(min(1.0, done[0] / max(1, total_takes)))

    for i, s in enumerate(sents):
        y, info = pick_take(engine, s, ref, st, asr, work, tick)
        picks.append(info)
        parts.append(y)
        if i < len(gaps):
            parts.append(np.zeros(int(gaps[i] * sr), dtype=np.float32))
    raw = ff.write_wav(work / f"{ln['id']}-raw.wav", np.concatenate(parts) if parts else np.zeros(sr // 2, np.float32), sr)
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
    meta = {"dur": round(dur, 3), "words": words, "takes": picks, "sentences": len(sents)}
    return final, meta


# ---------------------------------------------------------------- job
def run(ctx: JobCtx) -> None:
    rt = ctx.rt
    job = ctx.job
    lines = parse_lines(job.get("lines"))
    if not lines:
        raise JobError("Tidak ada kalimat VO untuk dibuat.")
    st = norm_settings(job.get("settings"), rt.cfg.takes)
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
        return
    log.error("Semua mesin suara gagal: %s", " | ".join(errors))
    raise JobError(FAIL_MSG)


def synth_job(ctx: JobCtx, name: str, lines: list[dict], voice: dict, ref: Path, vhash: str, st: dict) -> dict:
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
    try:
        for i, ln in enumerate(lines):
            base = 0.05 + 0.85 * i / n
            ctx.progress(base, f"Membuat suara kalimat {i + 1} dari {n}…", force=True)
            k = line_key(name, vhash, ln, st)
            hit = cache.get(k)
            if hit:
                wav, meta = hit
                log.info("Baris %s: pakai cache", ln["id"])
            else:
                if engine is None:
                    ctx.progress(base, "Menyiapkan mesin suara…", force=True)
                    engine = rt.engines.get(name)
                wav, meta = make_line(engine, ln, ref, st, asr, work, lambda f, b=base, ix=i: ctx.progress(b + 0.85 / n * 0.9 * f, f"Membuat suara kalimat {ix + 1} dari {n}…"))
                wav = cache.put(k, wav, meta)
            mp3 = ff.encode_mp3(wav, work / f"{ln['id']}.mp3", 48000, "160k", mono=True)
            path = rt.supa.upload(f"vo/{ctx.id}/{ln['id']}.mp3", mp3, "audio/mpeg")
            start = ln["start"] if ln["start"] is not None else t_next
            t_next = start + meta["dur"] + 0.3
            y, sr = ff.read_wav(wav)
            clips.append((y if sr == 48000 else ff.decode(wav, 48000), start))
            cues.extend(T.group_cues(meta["words"], start))
            out_lines.append({"id": ln["id"], "scene_id": ln["scene_id"], "path": path, "dur": meta["dur"], "words": meta["words"], "start": start})
        ctx.progress(0.92, "Menyusun VO lengkap…", force=True)
        full = mix.place_clips(clips, 48000, tail=0.5, ceiling_db=-1.0)
        full_wav = ff.write_wav(work / "full.wav", full, 48000)
        full_path = rt.supa.upload(f"vo/{ctx.id}/full.mp3", ff.encode_mp3(full_wav, work / "full.mp3", 48000, "160k", mono=True), "audio/mpeg")
        srt_path = rt.supa.upload(f"vo/{ctx.id}/full.srt", T.to_srt(cues).encode("utf-8"), "application/x-subrip")
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
            "worker": rt.cfg.worker_id,
            "versi": VERSION,
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)
