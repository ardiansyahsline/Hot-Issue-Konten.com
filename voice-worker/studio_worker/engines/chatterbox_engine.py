"""
Chatterbox-TTS-Indonesian (huggingface.co/grandhigh/Chatterbox-TTS-Indonesian, Apache-2.0) di GPU + voice cloning.

Pemuat tangguh — isi repo model tidak selalu sama:
  1. repo berisi file standar (ve, t3_cfg, s3gen, tokenizer[, conds]) → dirakit langsung (seperti ChatterboxTTS.from_local)
  2. repo format multilingual (t3_mtl*.safetensors + grapheme_mtl*.json) → ChatterboxMultilingualTTS
  3. repo HANYA berisi bobot t3 (hasil fine-tune) → model dasar ResembleAI/chatterbox dimuat, lalu state dict t3 diganti
Semua langkah dicatat jelas di log.

Muat cepat: file dicari di cache lokal dulu (tanpa cek jaringan); worker TIDAK pernah mengunduh di tengah job — model belum ada →
EngineDown("… jalankan SIAPKAN-MODEL.bat"); unduh hanya lewat allow_download=True (perintah siapkan-model). Modul dibangun langsung
di GPU (bobot acak awal tidak dihitung di CPU dulu), bobot dibaca langsung ke GPU, waktu tiap tahap dicatat.
Membuat suara: jalur cepat t3fast (bf16, SDPA, beberapa versi sekaligus, hook tidak bocor) dengan cadangan cara bawaan.
"""
from __future__ import annotations

import inspect
import logging
import time
from pathlib import Path

import numpy as np

from .. import log as vlog
from . import EngineDown, EngineFailed, safetensors_header, to_mono

log = vlog.get("chatterbox")

PATTERNS = ["*.safetensors", "*.pt", "*.bin", "*.json", "*.yaml", "*.md", "*.txt"]
BASE_EN = ["ve.safetensors", "t3_cfg.safetensors", "s3gen.safetensors", "tokenizer.json", "conds.pt"]
BASE_MTL = ["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"]
T3_KEYS = ("text_emb.weight", "speech_emb.weight", "speech_head.weight")
# sampling yang lebih stabil & tidak mengulang kata (sama dengan bawaan generate() Chatterbox terbaru) — dikirim HANYA kalau
# generate() versi terpasang punya parameternya (versi lama tetap jalan)
SAMPLING = {"min_p": 0.05, "repetition_penalty": 1.2}


def _keys(p: Path) -> list[str]:
    if p.suffix == ".safetensors":
        try:
            return list(safetensors_header(p))
        except Exception:
            return []
    return []


def _is_t3(p: Path) -> bool:
    ks = _keys(p)
    return any(k.endswith(T3_KEYS) or ".tfmr.layers." in f".{k}" for k in ks)


def scan(folder: Path) -> dict:
    """cari komponen model di folder snapshot → {ve, t3, s3gen, tok, conds, mtl}"""
    files = [p for p in folder.rglob("*") if p.is_file() and ".cache" not in p.parts]
    by = {p.name: p for p in files}
    out: dict = {"ve": None, "t3": None, "s3gen": None, "tok": None, "conds": by.get("conds.pt"), "mtl": False}
    out["ve"] = by.get("ve.safetensors") or by.get("ve.pt")
    out["s3gen"] = by.get("s3gen.safetensors") or by.get("s3gen.pt")
    t3 = by.get("t3_cfg.safetensors") or next((p for p in files if p.name.startswith("t3_mtl") and p.suffix == ".safetensors"), None)
    if t3 is None:
        # bobot fine-tune dengan nama lain: pilih file yang isinya tensor T3 (utamakan yang namanya mengandung "t3")
        cands = [p for p in files if p.suffix in (".safetensors",) and p.name not in ("ve.safetensors", "s3gen.safetensors") and _is_t3(p)]
        cands.sort(key=lambda p: (("t3" not in p.name.lower()), -p.stat().st_size))
        t3 = cands[0] if cands else next((p for p in files if p.suffix in (".pt", ".bin") and "t3" in p.name.lower()), None)
    out["t3"] = t3
    grapheme = next((p for p in files if p.name.startswith("grapheme_mtl") and p.suffix == ".json"), None)
    tok = by.get("tokenizer.json")
    out["mtl"] = bool((t3 and t3.name.startswith("t3_mtl")) or (grapheme and not tok))
    out["tok"] = grapheme if out["mtl"] and grapheme else tok
    return out




MISSING_MSG = "model Chatterbox belum diunduh — jalankan SIAPKAN-MODEL.bat"


def _download(repo: str, token: str | None, patterns: list[str]) -> Path:
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(repo_id=repo, token=token or None, allow_patterns=patterns))


def _local(repo: str, token: str | None, patterns: list[str]) -> Path | None:
    """snapshot yang SUDAH ada di cache HuggingFace laptop (tanpa cek jaringan sama sekali), atau None"""
    try:
        from .. import models as vmodels  # pemuat model bersama (siapkan-model) bila ada

        fn = getattr(vmodels, "hf_local", None)
        if callable(fn):
            p = fn(repo, patterns, token or None)
            return Path(p) if p else None
    except ImportError:
        pass
    except Exception as e:
        log.debug("models.hf_local %s gagal: %s", repo, e)
    try:
        from huggingface_hub import snapshot_download

        return Path(snapshot_download(repo_id=repo, token=token or None, allow_patterns=patterns, local_files_only=True))
    except Exception:
        return None


def _source(repo: str, token: str | None, patterns: list[str], allow_download: bool, need=None) -> Path:
    """folder model: lokal dulu; tidak ada / tidak lengkap (`need(scan)` False) → unduh HANYA kalau allow_download (siapkan-model)"""
    p = _local(repo, token, patterns)
    if p is not None and (need is None or need(scan(p))):
        return p
    if not allow_download:
        raise EngineDown(MISSING_MSG)
    log.info("Mengunduh model %s (sekali saja, ±3 GB)…", repo)
    try:
        return _download(repo, token, patterns)
    except Exception as e:
        raise EngineDown(f"model {repo} tidak bisa diunduh: {e}") from e


def resolve_files(cfg, allow_download: bool = False) -> tuple[dict, str, str]:
    """
    Cari (atau unduh, kalau allow_download) file komponen Chatterbox → (scan dict, mode "lengkap"/"hanya-t3", sumber).
    Tanpa torch — dipakai juga oleh perintah siapkan-model untuk mengunduh.
    """
    if cfg.chatterbox_dir:
        src = Path(cfg.chatterbox_dir).expanduser()
        if not src.exists():
            raise EngineDown(f"CHATTERBOX_DIR tidak ada: {src}")
        log.info("Pakai model lokal %s", src)
        f = scan(src)
    else:
        f = scan(_source(cfg.chatterbox_repo, cfg.hf_token, PATTERNS, allow_download, need=lambda s: bool(s["t3"])))
    log.info(
        "Isi repo: t3=%s ve=%s s3gen=%s tokenizer=%s format=%s",
        f["t3"] and f["t3"].name, f["ve"] and f["ve"].name, f["s3gen"] and f["s3gen"].name, f["tok"] and f["tok"].name, "multilingual" if f["mtl"] else "standar",
    )
    if not f["t3"]:
        raise EngineDown(f"bobot t3 tidak ditemukan di {cfg.chatterbox_repo}")
    mode = "lengkap"
    if not (f["ve"] and f["s3gen"] and f["tok"]):
        mode = "hanya-t3"
        log.info("Repo hanya berisi sebagian komponen → ambil sisanya dari model dasar %s", cfg.chatterbox_base_repo)
        pats = BASE_MTL if f["mtl"] else BASE_EN
        base = scan(_source(cfg.chatterbox_base_repo, cfg.hf_token, pats, allow_download, need=lambda s: bool(s["ve"] and s["s3gen"] and s["tok"])))
        for k in ("ve", "s3gen", "tok", "conds"):
            f[k] = f[k] or base[k]
        if not (f["ve"] and f["s3gen"] and f["tok"]):
            raise EngineDown("komponen model dasar Chatterbox tidak lengkap")
    return f, mode, f"{cfg.chatterbox_dir or cfg.chatterbox_repo} ({mode})"


def _state(path: Path, device: str = "cpu") -> dict:
    """state dict langsung ke `device` (safetensors load_file(device=…) / torch.load(map_location=…, weights_only=True))"""
    import torch

    if path.suffix == ".safetensors":
        from safetensors.torch import load_file

        try:
            sd = load_file(str(path), device=str(device))
        except Exception:  # versi safetensors lama / device tidak dikenal → CPU dulu
            sd = load_file(str(path))
    else:
        sd = torch.load(str(path), map_location=device, weights_only=True)
    if isinstance(sd, dict) and "model" in sd and isinstance(sd["model"], (list, tuple)):
        sd = sd["model"][0]
    if isinstance(sd, dict) and "state_dict" in sd and isinstance(sd["state_dict"], dict):
        sd = sd["state_dict"]
    return sd


def _clean_t3(sd: dict) -> dict:
    # buang awalan dari skrip fine-tune (t3. / module. / model.)
    for pre in ("module.", "model.", "t3."):
        if sd and all(k.startswith(pre) for k in sd):
            sd = {k[len(pre) :]: v for k, v in sd.items()}
    return sd


def _build(ctor, device: str, what: str):
    """bangun modul langsung di `device` (bobot acak awal tidak dihitung di CPU dulu); gagal → bangun di CPU"""
    import torch

    if device != "cpu":
        try:
            with torch.device(device):
                return ctor()
        except Exception as e:
            log.warning("Membangun %s langsung di %s gagal (%s) — dibangun di CPU", what, device, str(e)[:200])
    return ctor()


def mtl_tokenizer(path: Path):
    """
    MTLTokenizer bawaan memanggil hf_hub_download (tabel Cangjie, hanya untuk bahasa Mandarin) setiap kali dibuat = request
    internet tiap worker start. Di sini dipaksa lokal saja (tanpa jaringan); tidak ada → konversi Mandarin mati (tidak dipakai).
    """
    from chatterbox.models.tokenizers import tokenizer as tk

    orig = getattr(tk, "hf_hub_download", None)
    tlog = logging.getLogger(tk.__name__)
    lvl = tlog.level

    def local_only(*a, **k):
        k["local_files_only"] = True
        return orig(*a, **k)

    if orig is not None:
        tk.hf_hub_download = local_only
    tlog.setLevel(logging.ERROR)  # "Could not load Cangjie mapping" / "pkuseg not available": tidak penting untuk bahasa Indonesia
    try:
        return tk.MTLTokenizer(str(path))
    finally:
        if orig is not None:
            tk.hf_hub_download = orig
        tlog.setLevel(lvl)


def load_model(cfg, device: str = "cuda", allow_download: bool = False):
    """balikan (model, mtl: bool, sumber: str). Info tambahan di atribut model: _vw_t3_path, _vw_conds_path, _vw_times."""
    import gc

    import torch
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.t3 import T3
    from chatterbox.models.t3.modules.t3_config import T3Config
    from chatterbox.models.tokenizers import EnTokenizer
    from chatterbox.models.voice_encoder import VoiceEncoder

    times: dict[str, float] = {}
    t = time.time()
    f, mode, src = resolve_files(cfg, allow_download)
    times["cari"] = time.time() - t

    t = time.time()
    ve = _build(VoiceEncoder, device, "VoiceEncoder")
    sd = _state(f["ve"], device)
    ve.load_state_dict(sd)
    del sd
    ve.to(device).eval()
    times["ve"] = time.time() - t

    t = time.time()
    t3_sd = _clean_t3(_state(f["t3"], device))
    n_text = int(t3_sd["text_emb.weight"].shape[0]) if "text_emb.weight" in t3_sd else (2454 if f["mtl"] else 704)
    t3 = _build(lambda: T3(T3Config(text_tokens_dict_size=n_text)), device, "T3")
    missing, unexpected = t3.load_state_dict(t3_sd, strict=False)
    del t3_sd
    real_missing = [k for k in missing if not k.endswith("rotary_emb.inv_freq")]
    if real_missing:
        if len(real_missing) > 4 or any(k.startswith(("tfmr.", "speech_head", "text_emb", "speech_emb")) for k in real_missing):
            raise EngineDown(f"bobot t3 tidak cocok ({len(real_missing)} tensor hilang, mis. {real_missing[:3]})")
        log.warning("t3: %d tensor tidak ada di file (dipakai bawaan): %s", len(real_missing), real_missing[:5])
    if unexpected:
        log.info("t3: %d tensor tambahan diabaikan", len(unexpected))
    t3.to(device).eval()
    times["t3"] = time.time() - t

    t = time.time()
    s3 = _build(S3Gen, device, "S3Gen")
    sd = _state(f["s3gen"], device)
    s3.load_state_dict(sd, strict=False)
    del sd
    s3.to(device).eval()
    times["s3gen"] = time.time() - t

    t = time.time()
    tok = mtl_tokenizer(f["tok"]) if f["mtl"] else EnTokenizer(str(f["tok"]))
    vsize = tok.tokenizer.get_vocab_size()
    if vsize > n_text:
        log.warning("Ukuran kosakata tokenizer (%d) > tabel teks t3 (%d) — kemungkinan tokenizer salah pasangan", vsize, n_text)
    if f["mtl"]:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        model = ChatterboxMultilingualTTS(t3, s3, ve, tok, device)
    else:
        from chatterbox.tts import ChatterboxTTS

        model = ChatterboxTTS(t3, s3, ve, tok, device)
    times["lain"] = time.time() - t
    model._vw_t3_path = f["t3"]
    model._vw_conds_path = f.get("conds")
    model._vw_times = {k: round(v, 1) for k, v in times.items()}
    gc.collect()
    if device == "cuda":
        torch.cuda.empty_cache()
    return model, bool(f["mtl"]), src


def sampling_kwargs(fn) -> dict:
    """
    min_p / repetition_penalty yang didukung signature generate() (parameter bernama; **kwargs saja tidak dianggap mendukung).
    Kalau bawaan repetition_penalty di generate() versi/fork terpasang LEBIH KETAT dari 1,2 (mis. 2,0 di sebagian versi
    multilingual yang gampang mengulang kata), nilainya tidak diturunkan — dibiarkan bawaan model.
    """
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return {}
    out = {}
    for k, v in SAMPLING.items():
        p = params.get(k)
        if p is None or p.kind not in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
            continue
        d = p.default
        if k == "repetition_penalty" and isinstance(d, (int, float)) and not isinstance(d, bool) and float(d) > v:
            continue
        out[k] = v
    return out


def check_gpu() -> tuple[str, float]:
    """pastikan GPU benar-benar bisa dipakai PyTorch (RTX 50xx / sm_120 butuh build cu128+)"""
    import torch

    if not torch.cuda.is_available():
        raise EngineDown("GPU NVIDIA tidak terdeteksi oleh PyTorch (driver / torch CUDA belum terpasang)")
    name = torch.cuda.get_device_name(0)
    cap = torch.cuda.get_device_capability(0)
    vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
    cuda_v = torch.version.cuda or "0"
    try:
        major, minor = (int(x) for x in cuda_v.split(".")[:2])
    except ValueError:
        major, minor = 0, 0
    if cap[0] >= 12 and (major, minor) < (12, 8):
        raise EngineDown(f"{name} (sm_{cap[0]}{cap[1]}) butuh PyTorch CUDA 12.8+, terpasang CUDA {cuda_v} — jalankan ulang install.ps1")
    archs = getattr(torch.cuda, "get_arch_list", lambda: [])()
    if archs and f"sm_{cap[0]}{cap[1]}" not in archs and not any(a.startswith("compute_") for a in archs):
        log.warning("Build PyTorch ini tidak menyebut sm_%d%d (%s) — dicoba tetap jalan", cap[0], cap[1], ",".join(archs))
    try:  # tes kecil: gagal di sini = "no kernel image"
        x = torch.randn(64, 64, device="cuda")
        float((x @ x).sum().item())
    except Exception as e:
        raise EngineDown(f"GPU {name} tidak bisa menjalankan PyTorch: {e}") from e
    return name, vram



def fast_sampling(fn) -> dict:
    """
    Setelan sampling jalur cepat = yang dipakai cara lama: min_p 0,05; repetition_penalty 1,2 kecuali bawaan generate() lebih ketat
    (multilingual: 2,0); top_p = bawaan generate() (1,0 di chatterbox 0.1.7).
    """
    out = {"min_p": SAMPLING["min_p"], "repetition_penalty": SAMPLING["repetition_penalty"], "top_p": 1.0}
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return out
    d = getattr(params.get("repetition_penalty"), "default", None)
    if isinstance(d, (int, float)) and not isinstance(d, bool) and float(d) > out["repetition_penalty"]:
        out["repetition_penalty"] = float(d)
    tp = getattr(params.get("top_p"), "default", None)
    if isinstance(tp, (int, float)) and not isinstance(tp, bool) and 0 < float(tp) <= 1:
        out["top_p"] = float(tp)
    return out


def bf16_native() -> bool:
    """
    GPU punya bf16 ASLI (compute capability ≥ 8 = RTX 30xx ke atas)? torch 2.8 `is_bf16_supported()` bawaannya juga True untuk
    bf16 EMULASI di GPU lama (GTX 16xx / RTX 20xx, sm < 80) — di sana bf16 justru lebih lambat dari fp32, jadi tidak dipakai.
    """
    import torch

    if not torch.cuda.is_available():
        return False
    try:
        if int(torch.cuda.get_device_capability(0)[0]) < 8:
            return False
    except Exception:
        return False
    fn = getattr(torch.cuda, "is_bf16_supported", None)
    if not callable(fn):
        return True
    try:
        return bool(fn(including_emulation=False))
    except TypeError:  # torch lama tanpa parameter itu (belum menghitung emulasi)
        return bool(fn())


def want_dtype(name: str | None) -> str:
    """TTS_DTYPE auto|bf16|fp32 → "bf16"/"fp32" (auto = bf16 kalau GPU punya bf16 asli, compute capability ≥ 8)"""
    name = (name or "auto").lower()
    if name in ("fp32", "float32"):
        return "fp32"
    ok = bf16_native()
    if name in ("bf16", "bfloat16") and not ok:
        log.warning("TTS_DTYPE=bf16 tapi GPU tidak punya bf16 asli (butuh RTX 30xx ke atas) → fp32")
    return "bf16" if ok else "fp32"


def free_vram() -> None:
    """
    Lepas memori GPU yang sudah tidak dipakai (cache KV percobaan yang gagal, dsb.). Dipanggil DI LUAR blok except: selama blok
    except aktif, traceback error masih menahan frame percobaan yang gagal beserta tensornya.
    """
    import gc

    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


WARM_TEXT = "Halo, ini pemanasan mesin suara."


class ChatterboxEngine:
    name = "chatterbox"
    label = "Bank suara · Chatterbox (GPU laptop)"
    credit = "Chatterbox-TTS-Indonesian oleh grandhigh (Apache-2.0), berbasis Chatterbox dari Resemble AI"
    # tempo bicara asli ikut cfg_weight (lebih tinggi = lebih cepat) → baris teaser yang kepanjangan boleh dibuat ulang lebih cepat
    # sebelum di-atempo (jobs_tts.native_fit)
    native_tempo = True

    def __init__(self, cfg, allow_download: bool = False):
        import torch

        self.cfg = cfg
        import perth

        if getattr(perth, "PerthImplicitWatermarker", None) is None:
            # watermark suara AI dari Resemble wajib ada; biasanya karena setuptools terlalu baru (pkg_resources hilang)
            raise EngineDown("paket resemble-perth tidak lengkap (butuh setuptools<81) — jalankan ulang install.ps1")
        gpu, vram = check_gpu()
        log.info("GPU: %s (%.1f GB VRAM), PyTorch %s CUDA %s", gpu, vram, torch.__version__, torch.version.cuda)
        # TF32 untuk matmul fp32 (S3Gen, speech_head, cadangan fp32) — aman untuk inferensi, jauh lebih cepat di RTX 30xx ke atas
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        t0 = time.time()
        self.model, self.mtl, src = load_model(cfg, "cuda", allow_download=allow_download)
        self.sr = int(self.model.sr)
        self.lang = self._lang(cfg.chatterbox_lang) if self.mtl else None
        self._ref: tuple[str, float] | None = None
        self._sampling = sampling_kwargs(self.model.generate)  # cara lama (cadangan)
        self._fast_kw = fast_sampling(self.model.generate)
        self.batch = bool(getattr(cfg, "tts_batch", True))
        self._max_batch = 6
        self._fast_fail = 0
        self.builtin = None  # suara bawaan model (conds.pt) — hanya untuk pemanasan
        cp = getattr(self.model, "_vw_conds_path", None)
        if cp:
            try:
                from chatterbox.mtl_tts import Conditionals

                self.builtin = Conditionals.load(cp, map_location="cuda").to("cuda")
            except Exception as e:
                log.info("conds.pt tidak bisa dimuat (%s) — pemanasan T3 dilewati", str(e)[:160])
        self.fast = None
        try:
            from .t3fast import Fast

            self.fast = Fast(self.model, language_id=self.lang, dtype=want_dtype(getattr(cfg, "tts_dtype", "auto")), log=log)
        except Exception as e:
            log.warning("Jalur cepat tidak bisa dipakai (%s) — pakai cara bawaan Chatterbox", str(e)[:200])
        tm = getattr(self.model, "_vw_times", {})
        log.info(
            "Chatterbox dimuat dari %s%s dalam %.1f dtk (cari file %s · VE %s · T3 %s · S3Gen %s dtk)",
            src, f", bahasa={self.lang}" if self.lang else "", time.time() - t0, tm.get("cari"), tm.get("ve"), tm.get("t3"), tm.get("s3gen"),
        )
        fk = self._fast_kw
        if self.fast is not None:
            log.info(
                "Jalur cepat: transformer %s, attention SDPA%s, %s; min_p=%s, repetition_penalty=%s, top_p=%s",
                self.fast.name_dtype, " (+3 layer eager untuk cek keselarasan)" if self.fast.analyzer else "",
                "versi dibuat sekaligus" if self.batch else "versi dibuat satu-satu", fk["min_p"], fk["repetition_penalty"], fk["top_p"],
            )
        else:
            log.info("Sampling: temperature dari setelan%s", "".join(f", {k}={v}" for k, v in self._sampling.items()) or " (versi lama: min_p/repetition_penalty bawaan)")

    def _lang(self, want: str) -> str:
        from chatterbox import mtl_tts

        want = (want or "id").lower()
        if want in mtl_tts.SUPPORTED_LANGUAGES:
            return want
        vocab = self.model.tokenizer.tokenizer.get_vocab()
        if f"[{want}]" in vocab:  # model fine-tune menambah token bahasa sendiri
            mtl_tts.SUPPORTED_LANGUAGES[want] = "Indonesian"
            return want
        log.warning("Token bahasa [%s] tidak ada di model multilingual → pakai 'ms' (Melayu, paling mirip)", want)
        return "ms"

    # ------------------------------------------------------------------ bantu
    def _prepare(self, ref: Path, ex: float) -> None:
        key = (str(ref), ex)
        if self._ref != key:  # klip referensi cukup diproses sekali per suara
            self.model.prepare_conditionals(str(ref), exaggeration=ex)
            self._ref = key

    def _reload_fp32(self) -> dict | None:
        """bobot asli transformer T3 (fp32) dari file — untuk kembali dari bf16 tanpa membawa pembulatan"""
        p = getattr(self.model, "_vw_t3_path", None)
        if not p:
            return None
        sd = _clean_t3(_state(Path(p), "cpu"))  # lewat CPU: tidak menambah VRAM sementara ±2 GB
        return {k[len("tfmr.") :]: v for k, v in sd.items() if k.startswith("tfmr.")}

    def _fp32_for_upstream(self) -> None:
        """
        Cara bawaan (model.generate → T3.inference) memberi masukan fp32 ke transformer: kalau bobotnya masih bf16 (jalur cepat)
        → RuntimeError "expected m1 and m2 to have the same dtype" → cadangan ikut gagal. Maka sebelum cara bawaan dipakai,
        transformer dikembalikan ke fp32 (bobot asli dari file) untuk sisa sesi — juga kalau jalur cepat sudah dimatikan.
        """
        import torch

        from .t3fast import convert_params, param_dtype

        if self.fast is not None:
            ftf = getattr(self.fast, "tf", None)
            if self.fast.name_dtype != "fp32" or (ftf is not None and param_dtype(ftf) not in (None, torch.float32)):
                log.warning("Cara bawaan butuh transformer fp32 → pindah dari %s ke fp32 untuk sesi ini", self.fast.name_dtype)
                self.fast.set_dtype("fp32", reload=self._reload_fp32)
            return
        tf = getattr(getattr(self.model, "t3", None), "tfmr", None)
        if tf is None or param_dtype(tf) in (None, torch.float32):
            return
        log.warning("Cara bawaan butuh transformer fp32 → bobot transformer dikembalikan ke fp32")
        convert_params(tf, torch.float32)
        try:
            sd = self._reload_fp32()
            if sd:
                with torch.no_grad():
                    tf.load_state_dict(sd, strict=False)
        except Exception as e:  # dtype sudah fp32 (konsisten); hanya pembulatan bf16 yang tersisa
            log.warning("Bobot asli fp32 tidak bisa dibaca ulang (%s) — dipakai bobot bf16 yang diperbesar", str(e)[:200])

    def _upstream(self, text: str, ex: float, cw: float, temp: float, seed: int) -> np.ndarray:
        """cara bawaan model.generate() — hook baru dari pengecek keselarasan bawaan dilepas lagi sesudahnya"""
        import torch

        from .t3fast import no_leak

        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        extra = self._sampling
        with no_leak(self.model.t3):
            if self.mtl:
                wav = self.model.generate(text, language_id=self.lang, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
            else:
                wav = self.model.generate(text, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
        return to_mono(wav)

    def _fast_once(self, text: str, ex: float, cw: float, temp: float, seeds: list[int], max_sec, conds=None) -> list[np.ndarray]:
        from .t3fast import NonFinite, max_tokens_for

        kw = dict(exaggeration=ex, cfg_weight=cw, temperature=temp, max_new_tokens=max_tokens_for(text, max_sec), conds=conds, **self._fast_kw)
        ys = None
        try:
            ys = self.fast.generate(text, len(seeds), seeds, **kw)
        except NonFinite:
            if self.fast.name_dtype != "bf16":
                raise
        if ys is None:  # NaN di bf16 — diulang di LUAR except supaya cache KV bf16 yang gagal sudah lepas sebelum fp32 (+1 GB) dimuat
            log.warning("bf16 menghasilkan angka tidak wajar (NaN/inf) → transformer pindah ke fp32 untuk sesi ini, diulang sekali")
            free_vram()
            self.fast.set_dtype("fp32", reload=self._reload_fp32)
            ys = self.fast.generate(text, len(seeds), seeds, **kw)
        return [to_mono(y) for y in ys]

    def _fast_run(self, text: str, ex: float, cw: float, temp: float, seeds: list[int], max_sec, conds=None) -> list[np.ndarray]:
        """n versi sekaligus (TTS_BATCH=1, maks _max_batch per batch) atau satu-satu (TTS_BATCH=0)"""
        if not self.batch:
            return [y for s in seeds for y in self._fast_run_batch(text, ex, cw, temp, [s], max_sec, conds)]
        out: list[np.ndarray] = []
        step = max(1, self._max_batch)
        for i in range(0, len(seeds), step):
            out += self._fast_run_batch(text, ex, cw, temp, seeds[i : i + step], max_sec, conds)
        return out

    def _fast_run_batch(self, text, ex, cw, temp, seeds, max_sec, conds) -> list[np.ndarray]:
        """
        VRAM penuh → kosongkan cache, belah batch (sampai satu-satu); batas batch diingat untuk potongan berikutnya. Pembelahan
        dijalankan di LUAR blok except: di dalamnya traceback masih menahan cache KV percobaan yang gagal, jadi belahannya ikut penuh.
        """
        import torch

        try:
            return self._fast_once(text, ex, cw, temp, seeds, max_sec, conds)
        except torch.cuda.OutOfMemoryError:
            if len(seeds) <= 1:
                raise
        free_vram()
        h = len(seeds) // 2
        self._max_batch = max(1, min(self._max_batch, h))
        log.warning("VRAM penuh untuk %d versi sekaligus → dibelah jadi %d + %d", len(seeds), h, len(seeds) - h)
        return self._fast_run_batch(text, ex, cw, temp, seeds[:h], max_sec, conds) + self._fast_run_batch(text, ex, cw, temp, seeds[h:], max_sec, conds)

    # ------------------------------------------------------------------ dipakai jobs_tts
    def synth_batch(self, text: str, ref: Path, st: dict, seeds: list[int], max_sec: float | None = None) -> list[np.ndarray]:
        """beberapa versi untuk satu teks (benih per versi); jalur cepat bila bisa, cadangan cara bawaan satu-satu"""
        import torch

        ex = float(st.get("exaggeration", 0.6))
        cw = float(st.get("cfg_weight", 0.35))
        temp = float(st.get("temperature", 0.8))
        seeds = [int(s) for s in seeds] or [0]
        for attempt in range(2):
            oom = False
            try:
                return self._synth_once(text, ref, ex, cw, temp, seeds, max_sec)
            except torch.cuda.OutOfMemoryError as e:
                if attempt:
                    raise EngineFailed("VRAM GPU penuh") from e
                oom = True
            except Exception as e:  # RuntimeError/AssertionError model, juga error lain (mis. AttributeError) → EngineFailed → pindah ke pocket
                self._ref = None
                if attempt:
                    raise EngineFailed(f"Chatterbox error: {e}") from e
                log.warning("Chatterbox error (%s), coba sekali lagi…", e)
            # diulang di LUAR except: memori percobaan yang gagal (ditahan traceback) sudah lepas
            free_vram()
            if oom:
                log.warning("VRAM penuh, coba sekali lagi…")
        raise EngineFailed("Chatterbox gagal")

    def _synth_once(self, text: str, ref: Path, ex: float, cw: float, temp: float, seeds: list[int], max_sec) -> list[np.ndarray]:
        import torch

        self._prepare(ref, ex)
        t0 = time.time()
        if self.fast is not None:
            err = None
            try:
                ys = self._fast_run(text, ex, cw, temp, seeds, max_sec)
            except torch.cuda.OutOfMemoryError:
                raise
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:200]}"
            if err is None:
                self._fast_fail = 0
                log.debug("chatterbox cepat: %d versi, %.1f dtk (%s)", len(ys), time.time() - t0, self.fast.last)
                return ys
            # di luar except: cache KV jalur cepat yang gagal sudah lepas sebelum cara bawaan (dan bobot fp32) dimuat
            self._fast_fail += 1
            log.warning("Jalur cepat error (%s) — potongan ini memakai cara bawaan", err)
            free_vram()
            if self._fast_fail >= 3:
                log.warning("Jalur cepat gagal 3× berturut-turut → dimatikan untuk sesi ini")
                self._fp32_for_upstream()  # transformer fp32 dulu (remove() tidak mengembalikan dtype)
                try:
                    self.fast.remove()
                except Exception:
                    pass
                self.fast = None
        self._fp32_for_upstream()
        ys = [self._upstream(text, ex, cw, temp, s) for s in seeds]
        log.debug("chatterbox bawaan: %d versi, %.1f dtk", len(ys), time.time() - t0)
        return ys

    def synth(self, text: str, ref: Path, st: dict, seed: int) -> np.ndarray:
        return self.synth_batch(text, ref, st, [seed])[0]

    def warmup(self) -> dict:
        """
        Pemanasan sekali saat worker hidup: kernel CUDA, pengecek keselarasan, S3Gen & watermark (panggilan pertama librosa/Perth
        bisa belasan detik) — kalimat pendek 1 versi lalu n versi sekaligus memakai suara bawaan model (conds.pt). Tanpa conds.pt
        → T3 dilewati, watermark tetap dipanaskan. Balikan {"sec", "ratio"} (ratio = detik proses per detik suara, n versi).
        """
        t0 = time.time()
        out: dict = {"sec": 0.0, "ratio": None}
        try:
            self.model.watermarker.apply_watermark(np.zeros(self.sr // 2, np.float32), sample_rate=self.sr)
        except Exception as e:
            log.debug("pemanasan watermark gagal: %s", e)
        if self.builtin is None or self.fast is None:
            out["sec"] = round(time.time() - t0, 1)
            out["skip"] = "tanpa conds.pt" if self.builtin is None else "jalur cepat mati"
            return out
        try:
            ex = float(self.builtin.t3.emotion_adv.view(-1)[0].item())
            n = max(1, min(self._max_batch, int(getattr(self.cfg, "takes", 3) or 3))) if self.batch else 1
            self._fast_once(WARM_TEXT, ex, 0.5, 0.8, [1], 3.0, conds=self.builtin)
            t1 = time.time()
            ys = self._fast_once(WARM_TEXT, ex, 0.5, 0.8, list(range(1, n + 1)), 3.0, conds=self.builtin)
            wall = time.time() - t1
            audio = sum(len(y) for y in ys) / max(1, len(ys)) / self.sr
            out.update({"n": n, "ratio": round(wall / audio, 2) if audio > 0.3 else None, "audio": round(audio, 2), "dtype": self.fast.name_dtype})
            out["steps_per_sec"] = self.fast.last.get("steps_per_sec")
        except Exception as e:
            log.warning("Pemanasan Chatterbox gagal (%s) — tidak apa-apa, job tetap jalan", str(e)[:200])
            out["error"] = str(e)[:200]
        out["sec"] = round(time.time() - t0, 1)
        return out

    def close(self) -> None:
        if getattr(self, "fast", None) is not None:
            try:
                self.fast.remove()
            except Exception:
                pass
        self.fast = None
        self.builtin = None
        self.model = None  # type: ignore[assignment]
