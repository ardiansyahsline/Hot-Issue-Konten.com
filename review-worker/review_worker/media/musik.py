"""Cocok musik campaign (pemilik: worker-media). Mesin: Panako (STRATEGY=PANAKO, tahan ubah tempo/nada) → cadangan Olaf
(STRATEGY=OLAF, ±5% tempo) → cadangan "chroma" (librosa chroma CENS + geser nada ±2 semitone + tempo 0,85–1,15, tanpa paket baru).
Demucs opsional (REVIEW_DEMUCS=1) hanya bila skor awal rendah. Indeks per campaign di data/materi/<campaign>/panako/.

Cara pakai Panako (AGPL-3.0, tidak diubah, dipanggil sebagai program Java terpisah): CLI aslinya butuh LMDB untuk query, dan
LMDB memesan berkas 1 TB → tidak jalan di Windows. Jadi dipakai pembantu kecil tools/PanakoSekali.java: dalam SATU proses Java
lagu referensi dimasukkan ke storage memori (sidik jari dibaca dari cache .tdb per campaign, dihitung sekali), lalu audio video
clipper dicocokkan. Hasil: detik mulai–selesai di video & di lagu, skor, faktor tempo & nada.

yakin (0..1) dari skor Panako: 0,4 + 0,3·min(1, skor/30) + 0,3·min(1, persen_detik_cocok/0,6). Hasil Panako sendiri sudah
lolos saringan ketat (≥ 5 sidik jari searah & ≥ 4 dtk cocok), jadi setiap hasil = kecocokan nyata; yakin hanya membedakan kuat /
lemah (rumus "skor/(durasi×8)" di draf kontrak memberi 0,09 untuk lagu yang dipercepat 4% padahal jelas cocok — lihat CATATAN)."""
from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import numpy as np

from ..log import get
from ..skema import CocokLagu, HasilMusik, MateriRef, ReferensiCampaign
from .ff import CHILD_FLAGS, IS_WIN, ffmpeg_bin

log = get("musik")
YAKIN_COCOK = 0.5  # di bawah ini = tidak cocok
YAKIN_DEMUCS = 0.6  # di bawah ini (atau tanpa hasil) dan REVIEW_DEMUCS=1 → coba lagi setelah vokal dipisah
CHROMA_SR, CHROMA_HOP = 22050, 2048  # ±10,8 kolom chroma per detik
CHROMA_AMBANG = 0.92  # dikalibrasi selftest: lagu lain ±0,88–0,89, lagu sama (tempo/nada diubah) ≥ 0,96
CHROMA_YAKIN_MAKS = 0.75  # cadangan kasar → keyakinan dibatasi supaya hakim tahu ini lebih lemah dari Panako
DRIVER = "PanakoSekali"
_mesin_cache: dict[tuple, tuple[str, str]] = {}
_mesin_lock = threading.Lock()


# ------------------------------------------------------------------ cari Java & Panako
def _root(cfg) -> Path:
    return Path(getattr(cfg, "root", Path(__file__).resolve().parents[2]))


def cari_java(cfg) -> Optional[str]:
    exe = "java.exe" if IS_WIN else "java"
    calon = []
    if getattr(cfg, "java", ""):
        calon.append(Path(cfg.java))
    jdk = _root(cfg) / "tools" / "jdk"
    calon.append(jdk / "bin" / exe)
    if jdk.exists():
        calon += sorted(jdk.glob(f"*/bin/{exe}"))  # zip Temurin berisi folder jdk-21.x.y+z/
    for c in calon:
        if c.is_file():
            return str(c)
    return shutil.which("java")


def cari_jar(cfg) -> Optional[str]:
    calon = [Path(cfg.panako_jar)] if getattr(cfg, "panako_jar", "") else []
    calon.append(_root(cfg) / "tools" / "panako" / "panako.jar")
    for c in calon:
        if c.is_file():
            return str(c)
    return None


def _folder_driver(jar: str) -> Path:
    return Path(jar).resolve().parent / "drv"  # di sebelah panako.jar (tools/panako/drv, di-gitignore)


def pastikan_driver(cfg, java: str, jar: str) -> Optional[Path]:
    """PanakoSekali.class (dikompilasi pasang-panako.ps1; kalau belum ada & javac tersedia → dikompilasi di sini)"""
    sumber = _root(cfg) / "tools" / f"{DRIVER}.java"
    out = _folder_driver(jar)
    kelas = out / f"{DRIVER}.class"
    if kelas.exists() and (not sumber.exists() or kelas.stat().st_mtime >= sumber.stat().st_mtime):
        return out
    if not sumber.exists():
        return None
    javac = Path(java).with_name("javac.exe" if IS_WIN else "javac")
    javac_s = str(javac) if javac.exists() else shutil.which("javac")
    if not javac_s:
        return None
    out.mkdir(parents=True, exist_ok=True)
    p = subprocess.run([javac_s, "-nowarn", "--release", "11", "-cp", jar, "-d", str(out), str(sumber)],
                       capture_output=True, timeout=180, creationflags=CHILD_FLAGS)
    return out if p.returncode == 0 and kelas.exists() else None


def _env_java() -> dict:
    """PATH memuat folder ffmpeg (Panako memanggil `ffmpeg` lewat pipe) + tanpa JAVA_TOOL_OPTIONS aneh dari luar"""
    env = dict(os.environ)
    ff = ffmpeg_bin()
    if os.path.sep in ff or (os.altsep and os.altsep in ff):
        env["PATH"] = str(Path(ff).parent) + os.pathsep + env.get("PATH", "")
    return env


def _konfig(strategi: str, cache: Path) -> list[str]:
    cache.mkdir(parents=True, exist_ok=True)
    pipe_env, pipe_arg = ("cmd", "/c") if IS_WIN else ("/bin/sh", "-c")
    return [f"STRATEGY={strategi}", f"PANAKO_CACHE_FOLDER={cache / 'panako'}", f"OLAF_CACHE_FOLDER={cache / 'olaf'}",
            f"PANAKO_LMDB_FOLDER={cache / 'tidak-dipakai'}", f"OLAF_LMDB_FOLDER={cache / 'tidak-dipakai'}",
            f"DECODER_PIPE_ENVIRONMENT={pipe_env}", f"DECODER_PIPE_ENVIRONMENT_ARG={pipe_arg}",
            f"DECODER_PIPE_LOG_FILE={cache / 'decoder_log.txt'}", "AVAILABLE_PROCESSORS=1", "CHECK_DUPLICATE_FILE_NAMES=FALSE",
            "PANAKO_MIN_MATCH_DURATION=4", "OLAF_MIN_MATCH_DURATION=4", "NUMBER_OF_QUERY_RESULTS=20",
            # sedikit lebih peka dari bawaan (10/5/2): musik di video clipper sering pelan di bawah suara & dikompres AAC.
            # Dicek selftest: 11 lagu lain tetap 0 salah-cocok, lagu campaign +4% tempo/nada di bawah derau tetap ketemu.
            "PANAKO_MIN_HITS_UNFILTERED=7", "PANAKO_MIN_HITS_FILTERED=4", "PANAKO_QUERY_RANGE=3"]


def jalankan_panako(cfg, strategi: str, cache: Path, refs: list[Path], queries: list[Path], timeout: float = 600) -> dict:
    """→ {"simpan": {path: durasi}, "hasil": [dict…], "kosong": [path…]}. Melempar RuntimeError (pesan awam) kalau gagal."""
    java, jar = cari_java(cfg), cari_jar(cfg)
    if not java or not jar:
        raise RuntimeError("Java / Panako belum terpasang")
    drv = pastikan_driver(cfg, java, jar)
    if drv is None:
        raise RuntimeError("pembantu PanakoSekali belum dikompilasi (jalankan tools\\pasang-panako.ps1)")
    cp = os.pathsep.join([jar, str(drv)])
    args = [java, "-Xmx1g", "-cp", cp, DRIVER, *_konfig(strategi, cache)]
    args += [f"ref={Path(p).resolve()}" for p in refs] + [f"query={Path(p).resolve()}" for p in queries]
    try:
        p = subprocess.run(args, capture_output=True, timeout=timeout, cwd=str(cache), env=_env_java(), creationflags=CHILD_FLAGS)
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("Panako terlalu lama (timeout)") from e
    except OSError as e:
        raise RuntimeError("Java tidak bisa dijalankan") from e
    out = {"simpan": {}, "hasil": [], "kosong": [], "siap": False}
    gagal = None
    for baris in p.stdout.decode("utf-8", "replace").splitlines():
        kol = baris.rstrip("\r").split("\t")
        if kol[0] == "SIAP":
            out["siap"] = True
        elif kol[0] == "SIMPAN" and len(kol) >= 3:
            out["simpan"][kol[1]] = _f(kol[2])
        elif kol[0] == "KOSONG" and len(kol) >= 2:
            out["kosong"].append(kol[1])
        elif kol[0] == "HASIL" and len(kol) >= 11:
            out["hasil"].append({"query": kol[1], "q_mulai": _f(kol[2]), "q_selesai": _f(kol[3]), "ref": kol[4],
                                 "r_mulai": _f(kol[5]), "r_selesai": _f(kol[6]), "skor": _f(kol[7]), "tempo": _f(kol[8]),
                                 "nada": _f(kol[9]), "persen": _f(kol[10])})
        elif kol[0] == "GAGAL":
            gagal = kol[1] if len(kol) > 1 else "?"
    if gagal or p.returncode != 0 or not out["siap"]:
        ekor = p.stderr.decode("utf-8", "replace").strip().splitlines()[-2:]
        raise RuntimeError(f"Panako {strategi} gagal: {(gagal or ' | '.join(ekor))[:200]}")
    return out


def _f(s: str) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return 0.0


def _nada_uji(path: Path, detik: float = 12.0, seed: int = 5) -> None:
    """lagu sintetis kecil (nada acak + perkusi) untuk cek mesin — sidik jari butuh puncak spektrum yang berubah-ubah"""
    import soundfile as sf

    sr, r, out, t = 16000, np.random.default_rng(seed), [], 0.0
    while t < detik:
        d = float(r.choice([0.125, 0.25, 0.25, 0.5]))
        n = int(sr * d)
        tt = np.arange(n) / sr
        x = sum(np.sin(2 * np.pi * (220 * 2 ** (int(r.integers(0, 24)) / 12)) * tt) * 0.5 ** k for k in range(3))
        x = x * np.minimum(1, np.arange(n) / 200) * np.exp(-tt * 3)
        out.append(x)
        t += d
    y = np.concatenate(out)
    sf.write(str(path), (y / (np.abs(y).max() + 1e-9) * 0.8).astype(np.float32), sr)


def cek_mesin(cfg) -> tuple[str, str]:
    """→ (mesin yang siap: panako / olaf / chroma / tidak_ada, pesan awam). Dipakai `review cek` & detak jantung."""
    pilihan = str(getattr(cfg, "musik", "panako") or "panako").lower()
    if pilihan in ("mati", "off", "0", "tidak_ada"):
        return "tidak_ada", "Cek musik dimatikan (REVIEW_MUSIK=mati)."
    java, jar = cari_java(cfg), cari_jar(cfg)
    kunci = (pilihan, java, jar)
    with _mesin_lock:
        if kunci in _mesin_cache:
            return _mesin_cache[kunci]
        hasil = _cek_mesin(cfg, pilihan, java, jar)
        _mesin_cache[kunci] = hasil
        return hasil


def _chroma_siap() -> bool:
    try:
        import librosa  # noqa: F401

        return True
    except Exception:
        return False


def _cek_mesin(cfg, pilihan: str, java: Optional[str], jar: Optional[str]) -> tuple[str, str]:
    alasan = []
    if pilihan in ("panako", "olaf"):
        if not java:
            alasan.append("Java belum terpasang")
        elif not jar:
            alasan.append("Panako belum dipasang (tools\\pasang-panako.ps1)")
        else:
            with tempfile.TemporaryDirectory(prefix="cek-panako-") as d:
                wav = Path(d) / "uji.wav"
                _nada_uji(wav)
                for strategi in (["PANAKO", "OLAF"] if pilihan == "panako" else ["OLAF"]):
                    try:
                        r = jalankan_panako(cfg, strategi, Path(d) / "c", [wav], [wav], timeout=120)
                        if r["hasil"]:
                            nama = strategi.lower()
                            return nama, ("Panako siap (tahan ubah tempo & nada)." if nama == "panako"
                                          else "Panako mode OLAF siap (tahan ubah tempo ±5%).")
                        alasan.append(f"{strategi}: uji cocok kosong")
                    except Exception as e:  # noqa: BLE001
                        alasan.append(str(e)[:120])
    if _chroma_siap():
        pesan = "Cek musik pakai cara cadangan (chroma, lebih kasar)"
        return "chroma", pesan + (f" — {alasan[0]}." if alasan else ".")
    return "tidak_ada", "Cek musik tidak tersedia" + (f" — {alasan[0]}." if alasan else ".")


# ------------------------------------------------------------------ indeks & audio referensi
def folder_indeks(cfg, campaign_id: str) -> Path:
    return Path(getattr(cfg, "materi", Path("data/materi"))) / campaign_id / "panako"


def audio_ref(m: MateriRef) -> Optional[Path]:
    """file audio referensi: lagu → path_lokal (WAV 16 kHz dari materi.py); trailer → <id>.wav di sebelahnya"""
    p = Path(m.path_lokal)
    if m.jenis == "trailer":
        p = p.with_name(f"{m.id}.wav")
    return p if p.exists() and p.stat().st_size > 1000 else None


def _materi_audio(ref: ReferensiCampaign) -> list[tuple[MateriRef, Path]]:
    out = []
    for m in ref.materi:
        if m.status == "siap" and m.jenis in ("lagu", "trailer"):
            a = audio_ref(m)
            if a is not None:
                out.append((m, a))
    return out


def indeks_lagu(rt, campaign_id: str, lagu: list[MateriRef]) -> None:
    """panako store untuk lagu referensi yang belum diindeks (idempoten: cache .tdb per campaign); juga cache chroma"""
    pasangan = [(m, audio_ref(m)) for m in lagu]
    pasangan = [(m, a) for m, a in pasangan if a is not None]
    if not pasangan:
        return
    mesin, _ = cek_mesin(rt.cfg)
    if mesin in ("panako", "olaf"):
        try:
            jalankan_panako(rt.cfg, mesin.upper(), folder_indeks(rt.cfg, campaign_id), [a for _, a in pasangan], [], timeout=1800)
        except Exception as e:  # noqa: BLE001
            log.warning("indeks Panako campaign gagal (%s) — dicoba lagi saat cek video", str(e)[:120])
    if _chroma_siap():
        for _m, a in pasangan:
            try:
                _chroma_file(a)
            except Exception as e:  # noqa: BLE001
                log.warning("chroma referensi gagal (%s)", type(e).__name__)


# ------------------------------------------------------------------ cadangan chroma (librosa, tanpa paket baru)
def _chroma(path: Path, durasi_maks: float = 600.0) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(path), sr=CHROMA_SR, mono=True, duration=durasi_maks)
    if y.size < CHROMA_SR:
        return np.zeros((12, 0), dtype=np.float32)
    c = librosa.feature.chroma_cens(y=y, sr=CHROMA_SR, hop_length=CHROMA_HOP)
    # kolom senyap (norma 0) → tidak boleh "cocok" dengan apa pun
    n = np.linalg.norm(c, axis=0, keepdims=True)
    return np.where(n > 1e-6, c / np.maximum(n, 1e-6), 0).astype(np.float32)


def _chroma_file(path: Path) -> np.ndarray:
    """chroma referensi di-cache sebagai <file>.chroma.npy (dihitung sekali per lagu)"""
    st = path.stat()
    cache = path.with_name(path.name + f".chroma-{int(st.st_size)}-{int(st.st_mtime)}.npy")
    if cache.exists():
        try:
            return np.load(cache)
        except (OSError, ValueError):
            pass
    c = _chroma(path)
    try:
        for lama in path.parent.glob(path.name + ".chroma-*.npy"):
            lama.unlink(missing_ok=True)
        np.save(cache, c)
    except OSError:
        pass
    return c


def cocok_chroma(q: np.ndarray, r: np.ndarray, jendela: float = 6.0, langkah: float = 2.0) -> Optional[dict]:
    """jendela 6 dtk dari audio video dicari di lagu referensi (geser nada ±2, tempo 0,85–1,15). Rantai jendela berurutan dengan
    posisi lagu yang konsisten = cocok. → {q_mulai, q_selesai, r_mulai, r_selesai, skor, tempo, nada, n_jendela} atau None"""
    fps = CHROMA_SR / CHROMA_HOP
    L, S = int(round(jendela * fps)), max(1, int(round(langkah * fps)))
    nq, nr = q.shape[1], r.shape[1]
    if nq < L or nr < int(L * 1.2):
        return None
    tempo_list = (0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15)
    hasil = []  # per jendela: (skor, offset_ref, tempo, geser)
    j = np.arange(L)
    for w in range(0, nq - L + 1, S):
        terbaik = (-1.0, 0, 1.0, 0)
        blok_q = q[:, w:w + L]
        if float(np.linalg.norm(blok_q, axis=0).mean()) < 0.5:  # jendela senyap
            hasil.append(terbaik)
            continue
        for k in (0, 1, -1, 2, -2):
            m = np.roll(blok_q, k, axis=0).T @ r  # (L, nr) kemiripan kosinus
            for f in tempo_list:
                span = int(np.ceil((L - 1) * f)) + 1
                if span >= nr:
                    continue
                o = np.arange(0, nr - span)
                idx = o[:, None] + np.round(j * f).astype(int)[None, :]
                skor = m[j[None, :], idx].mean(axis=1)
                i = int(np.argmax(skor))
                if skor[i] > terbaik[0]:
                    terbaik = (float(skor[i]), int(o[i]), f, k)
        hasil.append(terbaik)
    # rantai terpanjang: jendela berturut-turut ≥ ambang dengan offset konsisten (± 1,5 dtk)
    tol = 1.5 * fps
    rantai, best = [], []
    for wi, (s, o, f, k) in enumerate(hasil):
        if s >= CHROMA_AMBANG and rantai:
            w0, o0, f0 = rantai[0][0] * S, rantai[0][2], rantai[0][3]
            harap = o0 + (wi * S - w0) * f0
            if abs(o - harap) <= tol:
                rantai.append((wi, s, o, f, k))
            else:
                rantai = [(wi, s, o, f, k)]
        elif s >= CHROMA_AMBANG:
            rantai = [(wi, s, o, f, k)]
        else:
            rantai = []
        if len(rantai) > len(best) or (len(rantai) == len(best) and rantai and np.mean([x[1] for x in rantai]) >
                                        np.mean([x[1] for x in best] or [0])):
            best = list(rantai)
    # minimal 3 jendela berurutan (±10 dtk) — atau 2 jendela yang sangat mirip; lagu lain jarang lolos ini
    if not best or len(best) < 2 or (len(best) == 2 and np.mean([x[1] for x in best]) < 0.97):
        return None
    w_awal, w_akhir = best[0][0] * S, best[-1][0] * S + L
    f = float(np.median([x[3] for x in best]))
    k = int(round(float(np.median([x[4] for x in best]))))
    return {"q_mulai": w_awal / fps, "q_selesai": min(nq, w_akhir) / fps, "r_mulai": best[0][2] / fps,
            "r_selesai": (best[0][2] + (w_akhir - w_awal) * f) / fps, "skor": float(np.mean([x[1] for x in best])),
            "tempo": f, "nada": float(2 ** (-k / 12.0)), "n_jendela": len(best)}  # chroma video digeser k → aslinya −k semitone


def _yakin_chroma(d: dict) -> float:
    kuat = (d["skor"] - CHROMA_AMBANG) / (1 - CHROMA_AMBANG)
    return round(float(min(CHROMA_YAKIN_MAKS, 0.45 + 0.2 * max(0.0, kuat) + 0.03 * d["n_jendela"])), 3)


# ------------------------------------------------------------------ cocokkan
def _yakin_panako(h: dict) -> float:
    pct = h["persen"] / 100.0 if h["persen"] > 1.0 else h["persen"]
    return round(float(min(1.0, 0.4 + 0.3 * min(1.0, h["skor"] / 30.0) + 0.3 * min(1.0, pct / 0.6))), 3)


def _faktor(v: float) -> Optional[float]:
    if v <= 0:
        return None
    return round(v / 100.0 if v > 5 else v, 4)  # beberapa versi mencetak persen


def _lagu(m: MateriRef, mulai: float, selesai: float, rm: float, rs: float, skor: float, tempo, nada, yakin: float) -> CocokLagu:
    nama = m.nama if m.jenis == "lagu" else f"{m.nama} (audio trailer)"
    return CocokLagu(material_id=m.id, nama=nama[:120], mulai=round(mulai, 2), selesai=round(selesai, 2), ref_mulai=round(rm, 2),
                     ref_selesai=round(rs, 2), skor=round(skor, 3), faktor_tempo=tempo, faktor_nada=nada, yakin=yakin)


def _cocok_panako(rt, mesin: str, audio: Path, pasangan, campaign_id: str) -> list[CocokLagu]:
    peta = {str(a.resolve()): m for m, a in pasangan}
    peta.update({str(a): m for m, a in pasangan})
    r = jalankan_panako(rt.cfg, mesin.upper(), folder_indeks(rt.cfg, campaign_id), [a for _, a in pasangan], [audio])
    per_materi: dict[str, CocokLagu] = {}
    for h in r["hasil"]:
        m = peta.get(h["ref"]) or peta.get(str(Path(h["ref"]).resolve()))
        if m is None:
            continue
        c = _lagu(m, h["q_mulai"], h["q_selesai"], h["r_mulai"], h["r_selesai"], h["skor"], _faktor(h["tempo"]),
                  _faktor(h["nada"]), _yakin_panako(h))
        lama = per_materi.get(m.id)
        if lama is None or c.yakin > lama.yakin:
            per_materi[m.id] = c
    return sorted(per_materi.values(), key=lambda c: -c.yakin)


def _cocok_chroma_semua(audio: Path, pasangan) -> list[CocokLagu]:
    q = _chroma(audio)
    out = []
    for m, a in pasangan:
        d = cocok_chroma(q, _chroma_file(a))
        if d:
            out.append(_lagu(m, d["q_mulai"], d["q_selesai"], d["r_mulai"], d["r_selesai"], d["skor"], round(d["tempo"], 3),
                             round(d["nada"], 4), _yakin_chroma(d)))
    return sorted(out, key=lambda c: -c.yakin)


def _demucs(rt, audio: Path, kerja: Path) -> Optional[Path]:
    """pisahkan vokal (Demucs htdemucs) → no_vocals.wav; None kalau Demucs tidak terpasang / gagal"""
    try:
        import importlib.util

        if importlib.util.find_spec("demucs") is None:
            return None
    except Exception:
        return None
    out = kerja / "demucs"
    dev = "cpu"
    try:
        import torch

        dev = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        pass
    with rt.gpu.pegang("demucs"):
        p = subprocess.run([sys.executable, "-m", "demucs.separate", "--two-stems", "vocals", "-n", "htdemucs", "-d", dev,
                            "-o", str(out), str(audio)], capture_output=True, timeout=900, creationflags=CHILD_FLAGS)
    if p.returncode != 0:
        log.warning("Demucs gagal (kode %s)", p.returncode)
        return None
    hasil = list(out.glob("htdemucs/*/no_vocals.wav"))
    return hasil[0] if hasil else None


def cocokkan_musik(rt, audio: Path, ref: ReferensiCampaign, kerja: Path) -> HasilMusik:
    """audio = WAV video clipper. Tanpa lagu referensi → status tidak_ada_referensi"""
    mesin, pesan_mesin = cek_mesin(rt.cfg)
    if mesin == "tidak_ada":
        return HasilMusik(status="nonaktif", mesin="tidak_ada", catatan=pesan_mesin)
    pasangan = _materi_audio(ref)
    ada_lagu = any(m.jenis == "lagu" for m, _ in pasangan)
    if not pasangan:
        return HasilMusik(status="tidak_ada_referensi", mesin=mesin, catatan="Belum ada lagu referensi untuk campaign ini.")
    if audio is None or not Path(audio).exists():
        return HasilMusik(status="tidak_cocok", mesin=mesin, catatan="Video tanpa suara.")
    catatan = []
    t0 = time.monotonic()

    def coba(src: Path) -> tuple[list[CocokLagu], str]:
        nonlocal mesin
        if mesin in ("panako", "olaf"):
            try:
                return _cocok_panako(rt, mesin, src, pasangan, ref.campaign_id), mesin
            except Exception as e:  # noqa: BLE001
                log.warning("%s gagal (%s) → cadangan chroma", mesin, str(e)[:120])
                catatan.append(f"{mesin} gagal, pakai cara cadangan")
                if not _chroma_siap():
                    raise
                mesin = "chroma"
        return _cocok_chroma_semua(src, pasangan), "chroma"

    try:
        semua, dipakai = coba(Path(audio))
        demucs = False
        terbaik = semua[0] if semua else None
        if bool(getattr(rt.cfg, "demucs", False)) and (terbaik is None or terbaik.yakin < YAKIN_DEMUCS):
            sepi = _demucs(rt, Path(audio), kerja)
            if sepi is not None:
                semua2, dipakai = coba(sepi)
                if semua2 and (terbaik is None or semua2[0].yakin > terbaik.yakin):
                    semua, terbaik, demucs = semua2, semua2[0], True
                    catatan.append("cocok setelah vokal dipisah (Demucs)")
            else:
                catatan.append("Demucs tidak tersedia")
    except Exception as e:  # noqa: BLE001
        log.warning("cek musik gagal (%s)", type(e).__name__)
        return HasilMusik(status="gagal", mesin=mesin, catatan="Cek musik gagal.")
    log.info("cek musik %s: %d kandidat dalam %.1f dtk", dipakai, len(semua), time.monotonic() - t0)
    if terbaik is not None and terbaik.yakin >= YAKIN_COCOK:
        if terbaik.material_id and not ada_lagu:
            catatan.append("yang cocok audio trailer (belum ada lagu referensi)")
        return HasilMusik(status="cocok", mesin=dipakai, terbaik=terbaik, semua=semua[:5], demucs=demucs,
                          catatan="; ".join(catatan))
    if not ada_lagu:
        catatan.insert(0, "Belum ada lagu referensi; audio trailer tidak cocok")
        return HasilMusik(status="tidak_ada_referensi", mesin=dipakai, semua=semua[:5], demucs=demucs, catatan="; ".join(catatan))
    return HasilMusik(status="tidak_cocok", mesin=dipakai, terbaik=None, semua=semua[:5], demucs=demucs,
                      catatan="; ".join(catatan) or "Lagu campaign tidak terdengar di video.")


def sidik_audio(cfg, path: Path) -> dict:
    """ringkasan sidik jari audio untuk review_materials.fingerprint.audio"""
    mesin, _ = cek_mesin(cfg)
    try:
        import soundfile as sf

        dur = float(sf.info(str(path)).duration)
    except Exception:
        dur = 0.0
    return {"mesin": mesin, "ok": mesin != "tidak_ada", "durasi": round(dur, 2),
            "sha1": hashlib.sha1(path.read_bytes()).hexdigest()[:12] if path.exists() else None}
