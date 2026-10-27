"""
pocket-tts-indonesian (huggingface.co/tryzz889/pocket-tts-indonesian, CC-BY-4.0) di CPU — cadangan kalau GPU gagal.
Kredit wajib (CC-BY-4.0): dicatat di log, README, dan hasil job (result.credit).

Pemuat tangguh:
  1. POCKET_CONFIG di .env (path / hf:// ke file .yaml) → dipakai langsung
  2. file .yaml di repo model (path relatif diubah jadi absolut)
  3. tanpa .yaml: config dirakit dari templat bawaan paket pocket-tts + bobot .safetensors (+ tokenizer) dari repo
Semua file dicari LOKAL saja (tidak pernah mengunduh di tengah job): rujukan hf:// / https:// di config diganti path file yang sudah
ada di cache (localize_yaml). Belum ada → EngineDown "belum diunduh"; unduhannya lewat SIAPKAN-MODEL.bat / models.prepare
(fetch_ref).
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

import numpy as np

from .. import log as vlog
from . import EngineDown, EngineFailed, safetensors_header, to_mono

log = vlog.get("pocket")

CREDIT = "pocket-tts-indonesian oleh tryzz889 (CC-BY-4.0), berbasis Pocket TTS dari Kyutai"
TEMPLATES = ["english_2026-01", "english", "english_2026-04"]
PATTERNS = ["*.yaml", "*.yml", "*.safetensors", "*.json", "*.model", "*.md", "*.txt"]
WEIGHT_KEYS = [("weights_path",), ("weights_path_without_voice_cloning",), ("flow_lm", "weights_path"), ("mimi", "weights_path"), ("flow_lm", "lookup_table", "tokenizer_path")]


def _get(d: dict, path: tuple) -> object:
    for k in path:
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _set(d: dict, path: tuple, v: object) -> None:
    for k in path[:-1]:
        d = d.setdefault(k, {})
    d[path[-1]] = v


def _is_remote(v: str) -> bool:
    return "://" in v


def patch_yaml(src: Path, out_dir: Path) -> Path:
    """salin yaml repo, ubah path bobot relatif → absolut (relatif terhadap folder yaml)"""
    import yaml

    d = yaml.safe_load(src.read_text(encoding="utf-8")) or {}
    for path in WEIGHT_KEYS:
        v = _get(d, path)
        if isinstance(v, str) and v and not _is_remote(v) and not Path(v).is_absolute():
            p = (src.parent / v).resolve()
            if p.exists():
                _set(d, path, str(p))
    out = out_dir / f"repo-{src.stem}.yaml"
    out.write_text(yaml.safe_dump(d, sort_keys=False), encoding="utf-8")
    return out


def _vocab_size(tok: Path) -> int | None:
    try:
        if tok.suffix == ".json":
            v = json.loads(tok.read_text(encoding="utf-8")).get("model", {}).get("vocab")
            return len(v) if v else None
        import sentencepiece

        return sentencepiece.SentencePieceProcessor(model_file=str(tok)).vocab_size()
    except Exception:
        return None


def build_yaml(template: Path, weights: Path, tok: Path | None, out_dir: Path) -> Path:
    """rakit config dari templat bawaan pocket-tts + bobot lokal"""
    import yaml

    d = yaml.safe_load(template.read_text(encoding="utf-8")) or {}
    head = safetensors_header(weights)
    keys = list(head)
    bundle = d.get("weights_path")
    d.pop("weights_path_without_voice_cloning", None)
    if any(k.startswith("flow_lm.") for k in keys):  # bundel lengkap TTSModel
        d["weights_path"] = str(weights)
        if not any(k.startswith("mimi.") for k in keys) and bundle:
            _set(d, ("mimi", "weights_path"), bundle)  # Mimi (codec) diambil dari bundel resmi
    else:  # hanya FlowLM (format training)
        d.pop("weights_path", None)
        _set(d, ("flow_lm", "weights_path"), str(weights))
        _set(d, ("mimi", "weights_path"), bundle)
    emb = next((head[k]["shape"] for k in keys if k.endswith(("conditioner.embed.weight", "transcript_in_segment.embed.weight"))), None)
    if tok is not None:
        _set(d, ("flow_lm", "lookup_table", "tokenizer_path"), str(tok))
        _set(d, ("flow_lm", "lookup_table", "tokenizer"), "tokenizers" if tok.suffix == ".json" else "sentencepiece")
        n = _vocab_size(tok)
        if n:
            _set(d, ("flow_lm", "lookup_table", "n_bins"), n)
    if emb:  # ukuran tabel di bobot paling bisa dipercaya (n_bins + 1 untuk padding)
        _set(d, ("flow_lm", "lookup_table", "n_bins"), int(emb[0]) - 1)
    out = out_dir / f"auto-{template.stem}-{weights.stem}.yaml"
    out.write_text(yaml.safe_dump(d, sort_keys=False), encoding="utf-8")
    return out


def candidates(snap: Path, templates_dir: Path, out_dir: Path) -> list[tuple[str, Path]]:
    out_dir.mkdir(parents=True, exist_ok=True)
    tries: list[tuple[str, Path]] = []
    for y in sorted([*snap.rglob("*.yaml"), *snap.rglob("*.yml")]):
        try:
            tries.append((f"yaml repo {y.name}", patch_yaml(y, out_dir)))
        except Exception as e:
            log.warning("yaml %s tidak bisa dibaca: %s", y.name, e)
    weights = sorted(snap.rglob("*.safetensors"), key=lambda p: -p.stat().st_size)
    tok = next((p for p in snap.rglob("*.json") if "tokenizer" in p.name.lower()), None) or next(iter(snap.rglob("*.model")), None)
    for tpl in TEMPLATES:
        t = templates_dir / f"{tpl}.yaml"
        if not t.exists():
            continue
        for w in weights[:2]:
            try:
                tries.append((f"templat {tpl} + {w.name}", build_yaml(t, w, tok, out_dir)))
            except Exception as e:
                log.warning("bobot %s tidak bisa dibaca: %s", w.name, e)
    return tries


# ---------------------------------------------------------------- rujukan file (hf:// / https://) → file lokal
def _parse_hf(ref: str) -> tuple[str, str, str | None]:
    """hf://pemilik/repo/jalur/file@revisi → (repo, file, revisi) — sama dengan pocket_tts.utils.download_if_necessary"""
    rest = ref.removeprefix("hf://")
    parts = rest.split("/")
    repo, filename = "/".join(parts[:2]), "/".join(parts[2:])
    rev = None
    if "@" in filename:
        filename, rev = filename.split("@", 1)
    return repo, filename, rev


def _http_cache(url: str) -> Path:
    """letak cache unduhan https:// milik pocket-tts (~/.cache/pocket_tts/<sha256 url><akhiran>)"""
    return Path.home() / ".cache" / "pocket_tts" / (hashlib.sha256(url.encode()).hexdigest() + Path(urlparse(url).path).suffix)


def ref_local(ref: str) -> Path | None:
    """file yang dirujuk config sudah ada di laptop? (tanpa jaringan)"""
    if not isinstance(ref, str) or not ref:
        return None
    if ref.startswith("hf://"):
        from .. import models

        repo, filename, rev = _parse_hf(ref)
        return models.hf_file_local(repo, filename, rev)
    if ref.startswith(("http://", "https://")):
        p = _http_cache(ref)
        return p if p.is_file() else None
    p = Path(ref)
    return p if p.exists() else None


def fetch_ref(ref: str, token: str | None = None) -> Path:
    """UNDUH satu rujukan config (hanya untuk models.prepare / SIAPKAN-MODEL, tidak pernah di job)"""
    if ref.startswith("hf://"):
        from huggingface_hub import hf_hub_download

        repo, filename, rev = _parse_hf(ref)
        last: Exception | None = None
        for _ in range(3):
            try:
                return Path(hf_hub_download(repo_id=repo, filename=filename, revision=rev, token=token or None))
            except Exception as e:  # noqa: PERF203
                last = e
                if type(e).__name__ in ("GatedRepoError", "RepositoryNotFoundError", "EntryNotFoundError", "RevisionNotFoundError"):
                    break
        raise last  # type: ignore[misc]
    if ref.startswith(("http://", "https://")):
        from .. import unduh

        return unduh.fetch(ref, _http_cache(ref), label="pocket-tts", log=log.info)
    return Path(ref)


def refs_of(yml: Path) -> list[str]:
    """rujukan jarak jauh (hf:// / https://) di config pocket"""
    import yaml

    d = yaml.safe_load(Path(yml).read_text(encoding="utf-8")) or {}
    out = []
    for path in WEIGHT_KEYS:
        v = _get(d, path)
        if isinstance(v, str) and _is_remote(v) and v not in out:
            out.append(v)
    return out


def localize_yaml(src: Path, out_dir: Path | None = None) -> tuple[Path, list[str]]:
    """
    salin config dengan semua rujukan hf:// / https:// diganti path file lokal. Balikan (config baru, rujukan yang BELUM ada).
    weights_path_without_voice_cloning opsional (dibuang kalau belum ada); sisanya wajib.
    """
    import yaml

    src = Path(src)
    d = yaml.safe_load(src.read_text(encoding="utf-8")) or {}
    miss: list[str] = []
    for path in WEIGHT_KEYS:
        v = _get(d, path)
        if not isinstance(v, str) or not _is_remote(v):
            continue
        p = ref_local(v)
        if p is not None:
            _set(d, path, str(p))
        elif path == ("weights_path_without_voice_cloning",):
            d.pop("weights_path_without_voice_cloning", None)
        else:
            miss.append(v)
    out = Path(out_dir or src.parent) / f"lokal-{src.stem}.yaml"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml.safe_dump(d, sort_keys=False), encoding="utf-8")
    return out, miss


def _brief(refs: list[str]) -> str:
    return ", ".join(r.split("@")[0].split("/")[-1] for r in refs[:2])


def load_model(cfg):
    from pocket_tts import TTSModel
    from pocket_tts.utils.config import CONFIGS_DIR

    from .. import models

    out_dir = Path(cfg.models) / "pocket"
    out_dir.mkdir(parents=True, exist_ok=True)
    if cfg.pocket_config:
        src = ref_local(cfg.pocket_config)
        if src is None:
            raise EngineDown(f"POCKET_CONFIG {cfg.pocket_config} belum diunduh — jalankan SIAPKAN-MODEL.bat")
        yml, miss = localize_yaml(src, out_dir)
        if miss:
            raise EngineDown(f"pocket-tts: file model belum diunduh ({_brief(miss)}) — jalankan SIAPKAN-MODEL.bat")
        log.info("Pakai POCKET_CONFIG=%s", cfg.pocket_config)
        return TTSModel.load_model(config=str(yml)), cfg.pocket_config
    snap = models.hf_local(cfg.pocket_repo, PATTERNS, cfg.hf_token or None)
    if snap is None:
        raise EngineDown(f"model {cfg.pocket_repo} belum diunduh — jalankan SIAPKAN-MODEL.bat (atau tunggu unduhan latar selesai)")
    errors = []
    for name, yml0 in candidates(snap, Path(CONFIGS_DIR), out_dir):
        yml, miss = localize_yaml(yml0, out_dir)
        if miss:
            errors.append(f"{name}: belum diunduh {_brief(miss)}")
            continue
        try:
            m = TTSModel.load_model(config=str(yml))
            log.info("pocket-tts dimuat (%s)", name)
            return m, name
        except Exception as e:
            errors.append(f"{name}: {type(e).__name__}: {str(e)[:160]}")
            log.info("Percobaan muat pocket-tts gagal (%s): %s", name, str(e)[:200])
    raise EngineDown(("pocket-tts-indonesian gagal dimuat — " + " | ".join(errors[:3])) if errors else f"repo {cfg.pocket_repo} tidak berisi config/bobot")


class PocketEngine:
    name = "pocket"
    label = "Bank suara · pocket-tts (CPU laptop)"
    credit = CREDIT

    def __init__(self, cfg):
        import torch

        import pocket_tts  # noqa: F401  (paket ini memasang torch.set_num_threads(1) saat import)

        torch.set_num_threads(cfg.cpu_threads)
        self.model, src = load_model(cfg)
        self.sr = int(self.model.sample_rate)
        self._ref: str | None = None
        self._state = None
        log.info("pocket-tts siap di CPU (%d thread) dari %s. Kredit: %s", cfg.cpu_threads, src, CREDIT)

    def synth(self, text: str, ref: Path, st: dict, seed: int) -> np.ndarray:
        import torch

        try:
            if self._ref != str(ref):
                self._state = self.model.get_state_for_audio_prompt(Path(ref))
                self._ref = str(ref)
            torch.manual_seed(seed)
            audio = self.model.generate_audio(self._state, text, copy_state=True)
            return to_mono(audio)
        except Exception as e:
            self._ref = None
            raise EngineFailed(f"pocket-tts error: {e}") from e

    def close(self) -> None:
        self.model = None
        self._state = None
