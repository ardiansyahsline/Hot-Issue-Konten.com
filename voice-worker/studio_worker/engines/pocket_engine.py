"""
pocket-tts-indonesian (huggingface.co/tryzz889/pocket-tts-indonesian, CC-BY-4.0) di CPU — cadangan kalau GPU gagal.
Kredit wajib (CC-BY-4.0): dicatat di log, README, dan hasil job (result.credit).

Pemuat tangguh:
  1. POCKET_CONFIG di .env (path / hf:// ke file .yaml) → dipakai langsung
  2. file .yaml di repo model (path relatif diubah jadi absolut)
  3. tanpa .yaml: config dirakit dari templat bawaan paket pocket-tts + bobot .safetensors (+ tokenizer) dari repo
"""
from __future__ import annotations

import json
from pathlib import Path

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


def load_model(cfg):
    from pocket_tts import TTSModel
    from pocket_tts.utils.config import CONFIGS_DIR

    if cfg.pocket_config:
        log.info("Pakai POCKET_CONFIG=%s", cfg.pocket_config)
        return TTSModel.load_model(config=cfg.pocket_config), cfg.pocket_config
    from huggingface_hub import snapshot_download

    try:
        snap = Path(snapshot_download(repo_id=cfg.pocket_repo, token=cfg.hf_token or None, allow_patterns=PATTERNS))
    except Exception as e:
        raise EngineDown(f"model {cfg.pocket_repo} tidak bisa diunduh: {e}") from e
    errors = []
    for name, yml in candidates(snap, Path(CONFIGS_DIR), cfg.models / "pocket"):
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
