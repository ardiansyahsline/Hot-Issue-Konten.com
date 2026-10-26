"""
Chatterbox-TTS-Indonesian (huggingface.co/grandhigh/Chatterbox-TTS-Indonesian, Apache-2.0) di GPU + voice cloning.

Pemuat tangguh — isi repo model tidak selalu sama:
  1. repo berisi file standar (ve, t3_cfg, s3gen, tokenizer[, conds]) → dirakit langsung (seperti ChatterboxTTS.from_local)
  2. repo format multilingual (t3_mtl*.safetensors + grapheme_mtl*.json) → ChatterboxMultilingualTTS
  3. repo HANYA berisi bobot t3 (hasil fine-tune) → model dasar ResembleAI/chatterbox dimuat, lalu state dict t3 diganti
Semua langkah dicatat jelas di log.
"""
from __future__ import annotations

import inspect
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


def _download(repo: str, token: str | None, patterns: list[str]) -> Path:
    from huggingface_hub import snapshot_download

    return Path(snapshot_download(repo_id=repo, token=token or None, allow_patterns=patterns))


def _state(path: Path) -> dict:
    import torch

    if path.suffix == ".safetensors":
        from safetensors.torch import load_file

        sd = load_file(str(path))
    else:
        sd = torch.load(str(path), map_location="cpu", weights_only=True)
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


def load_model(cfg, device: str = "cuda"):
    """balikan (model, mtl: bool, sumber: str)"""
    import torch
    from chatterbox.models.s3gen import S3Gen
    from chatterbox.models.t3 import T3
    from chatterbox.models.t3.modules.t3_config import T3Config
    from chatterbox.models.tokenizers import EnTokenizer, MTLTokenizer
    from chatterbox.models.voice_encoder import VoiceEncoder

    if cfg.chatterbox_dir:
        src = Path(cfg.chatterbox_dir).expanduser()
        if not src.exists():
            raise EngineDown(f"CHATTERBOX_DIR tidak ada: {src}")
        log.info("Pakai model lokal %s", src)
    else:
        log.info("Mengunduh / mengecek model %s (pertama kali bisa lama, ±3 GB)…", cfg.chatterbox_repo)
        try:
            src = _download(cfg.chatterbox_repo, cfg.hf_token, PATTERNS)
        except Exception as e:
            raise EngineDown(f"model {cfg.chatterbox_repo} tidak bisa diunduh: {e}") from e
    f = scan(src)
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
        try:
            base = scan(_download(cfg.chatterbox_base_repo, cfg.hf_token, BASE_MTL if f["mtl"] else BASE_EN))
        except Exception as e:
            raise EngineDown(f"model dasar {cfg.chatterbox_base_repo} tidak bisa diunduh: {e}") from e
        for k in ("ve", "s3gen", "tok"):
            f[k] = f[k] or base[k]
        if not (f["ve"] and f["s3gen"] and f["tok"]):
            raise EngineDown("komponen model dasar Chatterbox tidak lengkap")

    ve = VoiceEncoder()
    ve.load_state_dict(_state(f["ve"]))
    ve.to(device).eval()

    t3_sd = _clean_t3(_state(f["t3"]))
    n_text = int(t3_sd["text_emb.weight"].shape[0]) if "text_emb.weight" in t3_sd else (2454 if f["mtl"] else 704)
    t3 = T3(T3Config(text_tokens_dict_size=n_text))
    missing, unexpected = t3.load_state_dict(t3_sd, strict=False)
    real_missing = [k for k in missing if not k.endswith("rotary_emb.inv_freq")]
    if real_missing:
        if len(real_missing) > 4 or any(k.startswith(("tfmr.", "speech_head", "text_emb", "speech_emb")) for k in real_missing):
            raise EngineDown(f"bobot t3 tidak cocok ({len(real_missing)} tensor hilang, mis. {real_missing[:3]})")
        log.warning("t3: %d tensor tidak ada di file (dipakai bawaan): %s", len(real_missing), real_missing[:5])
    if unexpected:
        log.info("t3: %d tensor tambahan diabaikan", len(unexpected))
    t3.to(device).eval()

    s3 = S3Gen()
    s3.load_state_dict(_state(f["s3gen"]), strict=False)
    s3.to(device).eval()

    tok = MTLTokenizer(str(f["tok"])) if f["mtl"] else EnTokenizer(str(f["tok"]))
    vsize = tok.tokenizer.get_vocab_size()
    if vsize > n_text:
        log.warning("Ukuran kosakata tokenizer (%d) > tabel teks t3 (%d) — kemungkinan tokenizer salah pasangan", vsize, n_text)

    if f["mtl"]:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        model = ChatterboxMultilingualTTS(t3, s3, ve, tok, device)
    else:
        from chatterbox.tts import ChatterboxTTS

        model = ChatterboxTTS(t3, s3, ve, tok, device)
    del t3_sd
    torch.cuda.empty_cache() if device == "cuda" else None
    return model, bool(f["mtl"]), f"{cfg.chatterbox_repo} ({mode})"


def sampling_kwargs(fn) -> dict:
    """min_p / repetition_penalty yang didukung signature generate() (parameter bernama; **kwargs saja tidak dianggap mendukung)"""
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return {}
    return {k: v for k, v in SAMPLING.items() if k in params and params[k].kind in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY)}


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


class ChatterboxEngine:
    name = "chatterbox"
    label = "Bank suara · Chatterbox (GPU laptop)"
    credit = "Chatterbox-TTS-Indonesian oleh grandhigh (Apache-2.0), berbasis Chatterbox dari Resemble AI"
    # tempo bicara asli ikut cfg_weight (lebih tinggi = lebih cepat) → baris teaser yang kepanjangan boleh dibuat ulang lebih cepat
    # sebelum di-atempo (jobs_tts.native_fit)
    native_tempo = True

    def __init__(self, cfg):
        import torch

        self.cfg = cfg
        import perth

        if getattr(perth, "PerthImplicitWatermarker", None) is None:
            # watermark suara AI dari Resemble wajib ada; biasanya karena setuptools terlalu baru (pkg_resources hilang)
            raise EngineDown("paket resemble-perth tidak lengkap (butuh setuptools<81) — jalankan ulang install.ps1")
        gpu, vram = check_gpu()
        log.info("GPU: %s (%.1f GB VRAM), PyTorch %s CUDA %s", gpu, vram, torch.__version__, torch.version.cuda)
        self.model, self.mtl, src = load_model(cfg, "cuda")
        self.sr = int(self.model.sr)
        self.lang = self._lang(cfg.chatterbox_lang) if self.mtl else None
        self._ref: tuple[str, float] | None = None
        self._sampling = sampling_kwargs(self.model.generate)
        log.info("Chatterbox dimuat dari %s%s", src, f", bahasa={self.lang}" if self.lang else "")
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

    def synth(self, text: str, ref: Path, st: dict, seed: int) -> np.ndarray:
        import torch

        ex = float(st.get("exaggeration", 0.6))
        cw = float(st.get("cfg_weight", 0.35))
        temp = float(st.get("temperature", 0.8))
        for attempt in range(2):
            try:
                key = (str(ref), ex)
                if self._ref != key:  # klip referensi cukup diproses sekali per suara
                    self.model.prepare_conditionals(str(ref), exaggeration=ex)
                    self._ref = key
                torch.manual_seed(seed)
                torch.cuda.manual_seed_all(seed)
                t0 = time.time()
                extra = getattr(self, "_sampling", {})
                if self.mtl:
                    wav = self.model.generate(text, language_id=self.lang, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
                else:
                    wav = self.model.generate(text, exaggeration=ex, cfg_weight=cw, temperature=temp, **extra)
                y = to_mono(wav)
                log.debug("chatterbox %.1f dtk audio dalam %.1f dtk", len(y) / self.sr, time.time() - t0)
                return y
            except torch.cuda.OutOfMemoryError as e:
                torch.cuda.empty_cache()
                if attempt:
                    raise EngineFailed("VRAM GPU penuh") from e
                log.warning("VRAM penuh, coba sekali lagi…")
            except Exception as e:  # RuntimeError/AssertionError model, juga error lain (mis. AttributeError) → EngineFailed → pindah ke pocket
                self._ref = None
                if attempt:
                    raise EngineFailed(f"Chatterbox error: {e}") from e
                log.warning("Chatterbox error (%s), coba sekali lagi…", e)
        raise EngineFailed("Chatterbox gagal")

    def close(self) -> None:
        self.model = None  # type: ignore[assignment]
