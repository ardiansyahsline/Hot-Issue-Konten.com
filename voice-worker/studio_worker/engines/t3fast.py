"""
Jalur cepat Chatterbox (T3 → S3Gen → watermark Perth) — hasilnya sama dengan `model.generate()` bawaan, tapi:

  - beberapa versi (takes) dibuat SEKALIGUS dalam satu batch: konteks (suara + teks) dihitung sekali di batch 2 (cond + uncond
    untuk CFG), cache KV lalu diperbanyak jadi n versi; tiap versi punya pengacak (torch.Generator) sendiri dari benihnya,
    jadi versi ke-k sama dengan kalau dibuat sendiri dengan benih itu;
  - attention SDPA (cepat) di 27 layer; hanya 3 layer yang dipakai pengecek keselarasan (LLAMA_ALIGNED_HEADS) memakai attention
    "eager" lewat salinan config sendiri — model bawaan memaksa SEMUA 30 layer eager + output_attentions di tiap langkah;
  - pengecek keselarasan (AlignmentStreamAnalyzer bawaan, hanya model multilingual) di-port per versi dan memakai SATU set forward
    hook permanen (dipasang sekali). Bawaan memasang 3 hook BARU tiap panggilan tanpa pernah dilepas (makin lama makin lambat);
  - sinkron GPU ±1× per langkah (bawaan: beberapa .item() + multinomial yang juga sinkron + salinan attention ke CPU per hook);
  - opsional bf16 untuk transformer T3 saja (embedding, cond encoder, speech_head, S3Gen tetap fp32);
  - batas token dari panjang teks (bawaan selalu 1000 token = 40 dtk, take gagal-EOS membuang waktu sampai habis).

Semantik sampling meniru T3.inference bawaan persis: CFG (baris uncond = embedding teks nol) → pengecek keselarasan (tekan EOS,
paksa EOS) → repetition penalty (termasuk token BOS) → temperature → min_p → top_p → softmax → sampel. Sampel memakai algoritma
yang sama dengan torch.multinomial(num_samples=1) (q ~ Exp(1), argmax p/q) tanpa sinkron/validasi di host — logits tidak wajar
(NaN/inf, mis. bf16 meluap) ditandai lalu dilempar sebagai NonFinite di sinkron berikutnya.
"""
from __future__ import annotations

import copy
import math
import time
from contextlib import contextmanager

import numpy as np

# sama dengan chatterbox/models/t3/inference/alignment_stream_analyzer.py
LLAMA_ALIGNED_HEADS = [(12, 15), (13, 11), (9, 2)]
BIG = float(2**15)  # ±2**15 aman untuk semua dtype ≥ 16 bit (sama dengan bawaan)
TOKENS_PER_SEC = 25  # token suara S3 per detik
MAX_TOKENS = 1000  # batas bawaan model.generate()
SPEECH_VOCAB = 6561  # token suara valid < 6561 (6561 = SOS, 6562 = EOS)
STEP_CB = 10  # on_step dipanggil tiap sekian langkah


class NonFinite(RuntimeError):
    """logits NaN / inf (biasanya bf16 meluap) — pemanggil pindah ke fp32 lalu mengulang"""


def max_tokens_for(text: str, max_sec: float | None = None) -> int:
    """batas token suara dari panjang teks: ceil(25 × min(40, 2,5 × perkiraan + 3)), perkiraan = huruf / 14,5 (min 4 dtk)"""
    est = max(4.0, len(text or "") / 14.5)
    sec = min(40.0, 2.5 * est + 3.0)
    if max_sec and max_sec > 0:
        sec = min(sec, max(2.0, float(max_sec)))
    return int(max(TOKENS_PER_SEC, min(MAX_TOKENS, math.ceil(TOKENS_PER_SEC * sec))))


def hook_count(module) -> int:
    """jumlah forward hook di semua submodul (untuk memastikan hook tidak menumpuk)"""
    return sum(len(m._forward_hooks) for m in module.modules())


def param_dtype(module):
    """dtype parameter pertama modul (None kalau tanpa parameter)"""
    p = next(iter(module.parameters()), None)
    return None if p is None else p.dtype


def convert_params(module, dt) -> None:
    """
    Semua parameter `module` → dtype `dt`, ATOMIK: tensor baru dibuat semua dulu, baru ditukar. Gagal di tengah (mis. VRAM penuh)
    → tensor baru dibuang, semua parameter tetap seperti semula (tidak pernah campuran bf16 + fp32 = RuntimeError dtype di forward).
    Buffer (mis. rotary inv_freq) tidak diubah.
    """
    import torch

    params = [p for p in module.parameters() if p.dtype != dt]
    if not params:
        return
    new: list = []
    try:
        with torch.no_grad():
            for p in params:
                new.append(p.data.to(dt))
    except BaseException:
        new.clear()
        raise
    with torch.no_grad():
        for p, d in zip(params, new):
            p.data = d


def _is_hf_capture(fn) -> bool:
    # hook perekam keluaran milik transformers 5.x (dipasang sekali per model, dibutuhkan output_attentions bawaan) — jangan dilepas
    return getattr(fn, "__name__", "") == "output_capturing_hook"


@contextmanager
def no_leak(t3):
    """
    Pembungkus jalur bawaan (model.generate / T3.inference): hook baru yang dipasang AlignmentStreamAnalyzer bawaan dilepas lagi
    sesudahnya (id hook dicatat sebelum/sesudah) dan config attention (_attn_implementation, output_attentions) dikembalikan.
    """
    tf = t3.tfmr
    cfg = tf.config
    before = {id(m): set(m._forward_hooks.keys()) for m in tf.modules()}
    attn0 = getattr(cfg, "_attn_implementation", None)
    out0 = bool(getattr(cfg, "output_attentions", False))
    try:
        yield
    finally:
        for m in tf.modules():
            old = before.get(id(m), set())
            for hid in [h for h in list(m._forward_hooks.keys()) if h not in old]:
                if _is_hf_capture(m._forward_hooks[hid]):
                    continue
                m._forward_hooks.pop(hid, None)
                getattr(m, "_forward_hooks_with_kwargs", {}).pop(hid, None)
                getattr(m, "_forward_hooks_always_called", {}).pop(hid, None)
        try:
            if not out0:
                cfg.output_attentions = False
            cfg._attn_implementation = attn0
            if out0:
                cfg.output_attentions = True
        except Exception:
            pass
        t3.compiled = False
        if hasattr(t3, "patched_model"):
            t3.patched_model = None  # lepas referensi analyzer bawaan


class Align:
    """
    Port per-versi AlignmentStreamAnalyzer.step (chatterbox 0.1.7) — keadaan sama, tapi attention diberikan dari luar (satu set hook
    bersama) dan jumlah kolom/baris diakumulasi bertahap (O(1) per langkah). Balikan step(): (tekan_eos, paksa_eos).
    Beda yang disengaja: teks ≤ 5 token tidak membuat error (bawaan: max() atas tensor kosong) — dianggap tidak mengulang.
    """

    def __init__(self, S: int):
        self.S = int(S)
        self.curr_frame_pos = 0
        self.text_position = 0
        self.started = False
        self.complete = False
        self.completed_at: int | None = None
        self.T = 0  # jumlah baris matriks keselarasan
        self.first4 = -math.inf  # max A[:, :4]
        self.last2: np.ndarray | None = None  # A[-2:, -2:]
        self.tail = np.zeros(min(3, self.S), np.float64)  # A[completed_at:, -3:].sum(0)
        self.rep = 0.0  # A[completed_at:, :-5].max(1).sum()
        self.generated_tokens: list[int] = []
        self.forced = None  # alasan paksa EOS terakhir (untuk log/tes)

    def step(self, chunk: np.ndarray, last_token: int | None) -> tuple[bool, bool]:
        S = self.S
        a = np.array(chunk, dtype=np.float32, copy=True).reshape(-1, S)
        a[:, self.curr_frame_pos + 1 :] = 0
        was_complete = self.completed_at is not None
        for r in a:
            if was_complete:  # baris sesudah titik selesai
                if self.tail.size:
                    self.tail += r[-3:]
                if S > 5:
                    self.rep += float(r[:-5].max())
            self.T += 1
        self.first4 = max(self.first4, float(a[:, :4].max()) if S else -math.inf)
        rows = a[-2:, -2:] if self.last2 is None or a.shape[0] >= 2 else np.concatenate([self.last2[-1:], a[-1:, -2:]], axis=0)
        self.last2 = rows
        cur = int(a[-1].argmax())
        discontinuity = not (-4 < cur - self.text_position < 7)
        if not discontinuity:
            self.text_position = cur
        false_start = (not self.started) and (float(self.last2.max()) > 0.1 or self.first4 < 0.5)
        self.started = not false_start
        self.complete = self.complete or self.text_position >= S - 3
        if self.complete and self.completed_at is None:
            self.completed_at = self.T
        long_tail = self.complete and bool(self.tail.size) and float(self.tail.max()) >= 5
        alignment_repetition = self.complete and self.rep > 5
        if last_token is not None:
            self.generated_tokens.append(int(last_token))
            if len(self.generated_tokens) > 8:
                self.generated_tokens = self.generated_tokens[-8:]
        token_repetition = len(self.generated_tokens) >= 3 and self.generated_tokens[-1] == self.generated_tokens[-2]
        suppress = cur < S - 3 and S > 5
        force = bool(long_tail or alignment_repetition or token_repetition)
        self.forced = ("long_tail" if long_tail else "alignment_repetition" if alignment_repetition else "token_repetition") if force else None
        self.curr_frame_pos += 1
        return suppress, force


class Fast:
    """
    Generator cepat untuk ChatterboxTTS / ChatterboxMultilingualTTS (objek model bawaan: t3, s3gen, tokenizer, conds,
    watermarker, sr, device). Dibuat sekali per model; hook keselarasan dipasang sekali (install) dan bisa dilepas (remove).
    attn: "sdpa" (bawaan; 3 layer keselarasan eager) atau "eager" (semua layer eager seperti bawaan — untuk tes / cadangan).
    """

    def __init__(self, model, language_id: str | None = None, dtype: str = "fp32", attn: str = "sdpa", log=None):
        import torch

        self.torch = torch
        self.model = model
        self.t3 = model.t3
        self.tf = self.t3.tfmr
        self.hp = self.t3.hp
        self.lang = language_id
        self.log = log
        self.attn = attn if attn in ("sdpa", "eager") else "sdpa"
        self.analyzer = bool(getattr(self.hp, "is_multilingual", False)) and not getattr(self.t3, "is_gpt", False)
        self.mtl = self._is_mtl(model)
        self.dtype = torch.float32
        self._cap: dict | None = None
        self._handles: list = []
        self._orig_cfg: dict = {}
        self.last: dict = {}
        self.last_aligns: list = []
        self.install()
        if str(dtype).lower() in ("bf16", "bfloat16"):
            try:
                self.set_dtype("bf16")
            except BaseException:  # objek ini tidak jadi dipakai → hook & config eager jangan ditinggal terpasang
                self.remove()
                raise

    @staticmethod
    def _is_mtl(model) -> bool:
        try:
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS

            return isinstance(model, ChatterboxMultilingualTTS)
        except Exception:
            return bool(getattr(getattr(model, "t3", None), "hp", None) and model.t3.hp.is_multilingual)

    @property
    def device(self):
        return self.t3.device

    # ------------------------------------------------------------------ hook & config
    def install(self) -> None:
        """pasang SATU set hook di 3 layer keselarasan + salinan config eager untuk layer itu (sekali saja)"""
        if self._handles or not self.analyzer:
            return
        prev = getattr(self.tf, "_t3fast_owner", None)
        if prev is not None and prev is not self:
            prev.remove()
        base = self.tf.config
        for layer, head in LLAMA_ALIGNED_HEADS:
            att = self.tf.layers[layer].self_attn
            self._orig_cfg[layer] = att.config
            c = copy.copy(base)
            c._attn_implementation = "eager"
            att.config = c
            self._handles.append(att.register_forward_hook(self._hook(layer)))
        self.tf._t3fast_owner = self

    def remove(self) -> None:
        for h in self._handles:
            try:
                h.remove()
            except Exception:
                pass
        self._handles = []
        for layer, c in self._orig_cfg.items():
            self.tf.layers[layer].self_attn.config = c
        self._orig_cfg = {}
        if getattr(self.tf, "_t3fast_owner", None) is self:
            self.tf._t3fast_owner = None

    def _hook(self, layer: int):
        def t3fast_attn_hook(module, args, output):
            cap = self._cap
            if cap is not None and isinstance(output, tuple) and len(output) > 1 and output[1] is not None:
                cap[layer] = output[1]  # referensi saja (tanpa salin / sinkron)

        return t3fast_attn_hook

    # ------------------------------------------------------------------ dtype
    def set_dtype(self, want: str, reload=None) -> str:
        """
        "bf16" → parameter transformer T3 jadi bfloat16 (buffer rotary tetap fp32); "fp32" → kembali float32. Kembali ke fp32
        memakai `reload()` (state dict tfmr asli, kunci tanpa awalan "tfmr.") supaya tidak membawa pembulatan bf16; tanpa reload
        → bobot bf16 diperbesar ke fp32 apa adanya.
        Atomik: ganti dtype gagal (mis. VRAM penuh) → error diteruskan, parameter & self.dtype tetap seperti semula. Baca ulang
        bobot asli gagal → tetap fp32 (bobot bf16 diperbesar), hanya peringatan.
        """
        torch = self.torch
        dt = torch.bfloat16 if str(want).lower() in ("bf16", "bfloat16") else torch.float32
        if dt == self.dtype and param_dtype(self.tf) in (None, dt):
            return self.name_dtype
        convert_params(self.tf, dt)
        self.dtype = dt
        if dt == torch.float32 and reload is not None:
            try:
                sd = reload()
                if sd:
                    with torch.no_grad():
                        missing, _ = self.tf.load_state_dict(sd, strict=False)
                    bad = [k for k in missing if "rotary_emb" not in k]
                    if bad and self.log:
                        self.log.warning("t3fast: %d bobot tfmr tidak ada di file saat kembali ke fp32", len(bad))
                    del sd
            except Exception as e:  # dtype sudah konsisten fp32; hanya pembulatan bf16 yang tidak bisa dihapus
                if self.log:
                    self.log.warning("t3fast: bobot asli fp32 tidak bisa dibaca ulang (%s) — dipakai bobot bf16 yang diperbesar", str(e)[:200])
        return self.name_dtype

    @property
    def name_dtype(self) -> str:
        return "bf16" if self.dtype == self.torch.bfloat16 else "fp32"

    # ------------------------------------------------------------------ inti: token suara
    def _forward(self, x, past):
        out = self.tf(
            inputs_embeds=x.to(self.dtype),
            past_key_values=past,
            use_cache=True,
            output_attentions=False,
            output_hidden_states=False,
            return_dict=True,
        )
        h = out.last_hidden_state[:, -1, :].float()
        return self.t3.speech_head(h), out.past_key_values

    def speech_tokens(
        self,
        t3_cond,
        text_tokens,
        n: int,
        seeds: list[int],
        cfg_weight: float = 0.5,
        temperature: float = 0.8,
        repetition_penalty: float = 1.2,
        min_p: float = 0.05,
        top_p: float = 1.0,
        max_new_tokens: int = MAX_TOKENS,
        on_step=None,
    ) -> list:
        """
        text_tokens: (1, L) berisi SOT … EOT. Balikan n tensor 1D token prediksi per versi (seperti `predicted` bawaan: tanpa BOS,
        termasuk EOS di ujung kalau berhenti karena EOS). Statistik di self.last (steps, sec, dtype, attn, n, forced).
        """
        torch = self.torch
        from transformers.generation.logits_process import MinPLogitsWarper, RepetitionPenaltyLogitsProcessor, TopPLogitsWarper

        hp = self.hp
        n = max(1, int(n))
        seeds = [int(s) for s in (seeds or [0])][:n]
        while len(seeds) < n:  # benih kurang → lanjutkan deret (sama dengan jobs_tts.take_seed)
            seeds.append((seeds[-1] + 7919) % (2**31 - 1))
        dev = self.device
        t_start = time.perf_counter()
        use_cfg = float(cfg_weight) > 0.0
        B = 2 if use_cfg else 1
        eos, bos = int(hp.stop_speech_token), int(hp.start_speech_token)
        max_new = max(1, int(max_new_tokens))
        rep_proc = RepetitionPenaltyLogitsProcessor(penalty=float(repetition_penalty))
        minp_proc = MinPLogitsWarper(min_p=float(min_p)) if float(min_p) > 0 else None
        topp_proc = TopPLogitsWarper(top_p=max(1e-6, float(top_p))) if float(top_p) < 1.0 else None
        gens = [torch.Generator(device=dev).manual_seed(s) for s in seeds]

        with torch.inference_mode():
            tt = torch.atleast_2d(text_tokens).to(dtype=torch.long, device=dev)
            assert int((tt == hp.start_text_token).sum()) >= 1 and int((tt == hp.stop_text_token).sum()) >= 1, "SOT/EOT hilang"
            if tt.size(0) != B:
                tt = tt[:1].expand(B, -1).contiguous()
            init_speech = bos * torch.ones_like(tt[:, :1])
            embeds, len_cond = self.t3.prepare_input_embeds(t3_cond=t3_cond, text_tokens=tt, speech_tokens=init_speech, cfg_weight=float(cfg_weight))
            pos_w = self.t3.speech_pos_emb.emb.weight  # get_fixed_embedding(i) = baris ke-i (tanpa tensor baru dari host)
            bos_tok = torch.full((1, 1), bos, dtype=torch.long, device=dev)
            bos_embed = self.t3.speech_emb(bos_tok) + pos_w[0].view(1, 1, -1)
            x = torch.cat([embeds, bos_embed.expand(B, -1, -1)], dim=1)
            i0, j0 = len_cond, len_cond + tt.size(-1)
            S = j0 - i0
            cfg_t = torch.as_tensor(float(cfg_weight), device=dev, dtype=torch.float32)
            aligns = [Align(S) for _ in range(n)] if self.analyzer else []
            cfgobj = self.tf.config
            attn0 = cfgobj._attn_implementation
            self._cap = {} if self.analyzer else None
            try:
                # PREFILL: layer eager butuh mask kausal 4D — mask sdpa boleh None (is_causal) yang membuat layer eager TIDAK kausal.
                # Maka prefill dijalankan dengan config global eager (semua layer, sama dengan bawaan), langkah berikutnya sdpa.
                if self.analyzer or self.attn == "eager":
                    cfgobj._attn_implementation = "eager"
                raw, past = self._forward(x, None)
                if self.attn != "eager":
                    cfgobj._attn_implementation = attn0
                bad = ~torch.isfinite(raw).all()
                lg = torch.nan_to_num(raw, nan=0.0, posinf=BIG, neginf=-BIG)
                if n > 1:
                    past.batch_repeat_interleave(n)
                lg = lg.repeat_interleave(n, dim=0)  # [c×n, u×n] — urutan sama dengan cache
                gen = torch.full((n, max_new + 1), bos, dtype=torch.long, device=dev)
                fin = [False] * n
                length = [0] * n
                prev: list[int] = [bos] * n
                steps = 0
                ended = False
                for i in range(max_new):
                    # ---- satu sinkron: attention langkah ini (keselarasan) + token langkah lalu + tanda logits rusak
                    parts = []
                    if self.analyzer:
                        cap = self._cap
                        if i == 0:
                            maps = torch.stack([cap[l][0, h, j0:, i0:j0] for l, h in LLAMA_ALIGNED_HEADS])  # (3, 2, S)
                        else:
                            maps = torch.stack([cap[l][:n, h, -1, i0:j0] for l, h in LLAMA_ALIGNED_HEADS])  # (3, n, S)
                        parts.append(maps.float().reshape(-1))
                    if i > 0:
                        parts.append(gen[:, i].float())
                    parts.append(bad.float().view(1))
                    host = torch.cat(parts).cpu()
                    if float(host[-1]) > 0:
                        raise NonFinite("logits NaN/inf")
                    if i > 0:
                        off = host.numel() - 1 - n
                        prev = [int(v) for v in host[off : off + n].tolist()]
                        for k in range(n):
                            if not fin[k] and prev[k] == eos:
                                fin[k], length[k] = True, i
                        if all(fin):
                            ended = True
                            break
                    # ---- logits CFG
                    cond = lg[:n]
                    logits = cond + cfg_t * (cond - lg[n : 2 * n]) if use_cfg else cond.clone()
                    # ---- pengecek keselarasan per versi
                    if self.analyzer:
                        a = host[: maps.numel()].view(maps.shape).mean(dim=0).numpy()  # (rows, S), rata-rata 3 kepala
                        sup, frc = [False] * n, [False] * n
                        for k in range(n):
                            if fin[k]:
                                continue
                            chunk = a if i == 0 else a[k : k + 1]
                            sup[k], frc[k] = aligns[k].step(chunk, prev[k])
                        if any(sup) or any(frc):
                            sup_t = torch.tensor(sup, device="cpu")
                            frc_t = torch.tensor(frc, device="cpu")
                            if dev.type == "cuda":
                                sup_t = sup_t.pin_memory().to(dev, non_blocking=True)
                                frc_t = frc_t.pin_memory().to(dev, non_blocking=True)
                            col = logits[:, eos]
                            col = torch.where(frc_t, torch.full_like(col, BIG), torch.where(sup_t, torch.full_like(col, -BIG), col))
                            if any(frc):
                                logits = torch.where(frc_t[:, None], torch.full_like(logits, -BIG), logits)
                            logits[:, eos] = col
                    # ---- repetition penalty (riwayat termasuk BOS) → temperature → min_p → top_p → softmax
                    ids = gen[:, : i + 1]
                    logits = rep_proc(ids, logits)
                    if float(temperature) != 1.0:
                        logits = logits / float(temperature)
                    if minp_proc is not None:
                        logits = minp_proc(ids, logits)
                    if topp_proc is not None:
                        logits = topp_proc(ids, logits)
                    probs = torch.softmax(logits, dim=-1)
                    # ---- sampel = torch.multinomial(p, 1) persis (q ~ Exp(1), argmax p/q), per versi dengan pengacaknya sendiri
                    q = torch.empty_like(probs)
                    for k in range(n):
                        if fin[k]:
                            q[k].fill_(1.0)
                        else:
                            q[k].exponential_(1, generator=gens[k])
                    tok = torch.argmax(probs / q, dim=-1, keepdim=True)  # (n, 1)
                    gen[:, i + 1] = tok[:, 0]
                    steps = i + 1
                    if on_step is not None and steps % STEP_CB == 0:
                        try:
                            on_step(steps, max_new)
                        except Exception:
                            pass
                    if i + 1 >= max_new:
                        break
                    # ---- langkah berikutnya: embedding token + posisi, baris uncond menerima token yang sama
                    emb = self.t3.speech_emb(tok) + pos_w[i + 1].view(1, 1, -1)
                    if use_cfg:
                        emb = torch.cat([emb, emb], dim=0)
                    raw, past = self._forward(emb, past)
                    bad = bad | ~torch.isfinite(raw).all()
                    lg = torch.nan_to_num(raw, nan=0.0, posinf=BIG, neginf=-BIG)
                if not ended:
                    host = torch.cat([gen[:, steps].float(), bad.float().view(1)]).cpu()
                    if float(host[-1]) > 0:
                        raise NonFinite("logits NaN/inf")
                    for k in range(n):
                        if not fin[k]:
                            fin[k] = int(host[k]) == eos
                            length[k] = steps
                out = [gen[k, 1 : length[k] + 1].clone() for k in range(n)]
            finally:
                self._cap = None
                cfgobj._attn_implementation = attn0
        sec = time.perf_counter() - t_start
        self.last_aligns = aligns  # keadaan pengecek per versi (untuk tes / log)
        self.last = {
            "steps": steps,
            "sec": round(sec, 3),
            "steps_per_sec": round(steps / sec, 2) if sec > 0 else None,
            "n": n,
            "dtype": self.name_dtype,
            "attn": self.attn,
            "eos": [bool(f) for f in fin],
            "lengths": length,
            "forced": [a.forced for a in aligns] if aligns else None,
            "max_new": max_new,
        }
        return out

    # ------------------------------------------------------------------ teks → suara
    def text_tokens(self, text: str):
        torch = self.torch
        import torch.nn.functional as F

        if self.mtl:
            from chatterbox.mtl_tts import punc_norm

            t = punc_norm(text)
            tt = self.model.tokenizer.text_to_tokens(t, language_id=self.lang.lower() if self.lang else None)
        else:
            from chatterbox.tts import punc_norm

            t = punc_norm(text)
            tt = self.model.tokenizer.text_to_tokens(t)
        tt = tt.to(self.device)
        tt = F.pad(tt, (1, 0), value=self.hp.start_text_token)
        tt = F.pad(tt, (0, 1), value=self.hp.stop_text_token)
        return tt.to(torch.long)

    def clean(self, tokens) -> list[int]:
        """sama dengan drop_invalid_tokens bawaan (buang sampai SOS, potong di EOS) + hanya token suara valid (< 6561)"""
        t = [int(v) for v in tokens.tolist()]
        sos, eos = SPEECH_VOCAB, SPEECH_VOCAB + 1
        if sos in t:
            t = t[t.index(sos) + 1 :]
        if eos in t:
            t = t[: t.index(eos)]
        return [v for v in t if 0 <= v < SPEECH_VOCAB]

    def generate(
        self,
        text: str,
        n: int,
        seeds: list[int],
        exaggeration: float = 0.5,
        cfg_weight: float = 0.5,
        temperature: float = 0.8,
        repetition_penalty: float = 1.2,
        min_p: float = 0.05,
        top_p: float = 1.0,
        max_new_tokens: int | None = None,
        on_step=None,
        conds=None,
    ) -> list[np.ndarray]:
        """n versi suara (float32 mono, SUDAH diwatermark Perth) untuk `text` dengan conds (bawaan: model.conds)"""
        torch = self.torch
        from chatterbox.models.t3.modules.cond_enc import T3Cond

        model = self.model
        conds = conds if conds is not None else model.conds
        assert conds is not None, "conds belum disiapkan (prepare_conditionals)"
        dev = self.device
        # exaggeration berbeda → T3Cond baru (sama dengan generate() bawaan)
        if float(exaggeration) != float(conds.t3.emotion_adv.view(-1)[0].item()):
            c = conds.t3
            conds.t3 = T3Cond(speaker_emb=c.speaker_emb, cond_prompt_speech_tokens=c.cond_prompt_speech_tokens, emotion_adv=exaggeration * torch.ones(1, 1, 1)).to(device=dev)
        tt = self.text_tokens(text)
        mx = int(max_new_tokens) if max_new_tokens else max_tokens_for(text)
        toks = self.speech_tokens(
            conds.t3, tt, n, seeds, cfg_weight=cfg_weight, temperature=temperature, repetition_penalty=repetition_penalty,
            min_p=min_p, top_p=top_p, max_new_tokens=mx, on_step=on_step,
        )
        t1 = time.perf_counter()
        outs: list[np.ndarray] = []
        seeds = list(seeds) + [0] * max(0, len(toks) - len(seeds))
        with torch.inference_mode():
            for k, tk in enumerate(toks):
                clean = self.clean(tk)
                if not clean:  # tidak ada token suara (langsung EOS) → hening pendek; dinilai jelek oleh pemilih take
                    y = np.zeros(int(0.2 * model.sr), np.float32)
                    outs.append(y)
                    continue
                torch.manual_seed(int(seeds[k]))  # derau S3Gen (flow matching) ikut benih versi ini
                st = torch.tensor(clean, dtype=torch.long, device=dev)
                wav, _ = model.s3gen.inference(speech_tokens=st, ref_dict=conds.gen)
                y = wav.squeeze(0).detach().float().cpu().numpy()
                y = model.watermarker.apply_watermark(y, sample_rate=model.sr)  # watermark suara AI wajib
                outs.append(np.nan_to_num(np.asarray(y, dtype=np.float32).reshape(-1)))
        self.last["s3gen_sec"] = round(time.perf_counter() - t1, 3)
        self.last["audio_sec"] = [round(len(y) / model.sr, 2) for y in outs]
        return outs
