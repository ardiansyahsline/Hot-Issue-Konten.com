"""Klien Anthropic PALSU untuk selftest (pemilik: hakim-ai) — tanpa internet / kunci API.

KlienPalsu(jawaban) meniru `anthropic.Anthropic()` cukup untuk hakim: `.messages.create(**kwargs)` mencatat kwargs ke
`.panggilan` lalu membalas dengan objek `anthropic.types.Message` ASLI (divalidasi SDK bila paket anthropic terpasang; kalau
tidak, SimpleNamespace dengan bentuk sama): `content` = [blok thinking kosong, blok text JSON], `stop_reason`, `stop_details`,
`usage` lengkap (`cache_read_input_tokens`, `cache_creation_input_tokens`, `cache_creation.ephemeral_1h_input_tokens` /
`ephemeral_5m_input_tokens`), `_request_id`.

jawaban (satu, atau list = dipakai berurutan per panggilan; item terakhir diulang):
- dict → JSON KeputusanAI (stop_reason "end_turn")
- "refusal" → stop_reason "refusal" + stop_details {type: refusal, category: general_harms}
- "max_tokens" → stop_reason "max_tokens", teks JSON terpotong
- "rusak" → teks bukan JSON
- Exception (mis. galat("auth")) → dilempar
Cache ditiru seperti API: prefix system yang sama dengan panggilan sebelumnya (ttl 1h) → cache_read; baru → cache_creation 1h.
"""
from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace
from typing import Any, Optional

MODEL = "claude-haiku-5-5"


def _token_kira(teks: str) -> int:
    return max(1, len(teks) // 3)


def _sdk():
    try:
        import anthropic  # noqa: F401
        from anthropic.types import Message

        return Message
    except ImportError:
        return None


def buat_respons(teks: Optional[str], stop_reason: str, usage: dict, request_id: str, model: str = MODEL,
                 stop_details: Optional[dict] = None) -> Any:
    content = [{"type": "thinking", "thinking": "", "signature": "sig-palsu"}]
    if teks is not None:
        content.append({"type": "text", "text": teks})
    data = {"id": "msg_" + request_id[-12:], "type": "message", "role": "assistant", "model": model, "content": content,
            "stop_reason": stop_reason, "stop_sequence": None, "stop_details": stop_details, "usage": usage}
    Message = _sdk()
    if Message is not None:
        msg = Message.model_validate(data)
        msg._request_id = request_id  # di SDK diisi dari header request-id
        return msg

    def ns(x):
        if isinstance(x, dict):
            return SimpleNamespace(**{k: ns(v) for k, v in x.items()})
        if isinstance(x, list):
            return [ns(v) for v in x]
        return x

    m = ns(data)
    m._request_id = request_id
    return m


def galat(jenis: str) -> Exception:
    """error SDK asli: auth (401), izin (403), batas (429), server (500), sibuk (529), koneksi, timeout, buruk (400)"""
    import anthropic

    try:
        import httpx2 as hx
    except ImportError:  # SDK lama memakai httpx
        import httpx as hx  # type: ignore[no-redef]
    req = hx.Request("POST", "https://api.anthropic.com/v1/messages")

    def resp(kode: int) -> Any:
        return hx.Response(kode, request=req, headers={"request-id": f"req_galat_{kode}"})

    body = {"type": "error", "error": {"type": "x", "message": f"galat palsu {jenis}"}}
    if jenis == "auth":
        return anthropic.AuthenticationError("invalid x-api-key", response=resp(401), body=body)
    if jenis == "izin":
        return anthropic.PermissionDeniedError("permission", response=resp(403), body=body)
    if jenis == "batas":
        return anthropic.RateLimitError("rate limit", response=resp(429), body=body)
    if jenis == "server":
        return anthropic.InternalServerError("server", response=resp(500), body=body)
    if jenis == "sibuk":
        return anthropic.APIStatusError("overloaded", response=resp(529), body=body)
    if jenis == "buruk":
        return anthropic.BadRequestError("output_config.format: schema invalid", response=resp(400), body=body)
    if jenis == "timeout":
        return anthropic.APITimeoutError(request=req)
    return anthropic.APIConnectionError(request=req)


class _Messages:
    def __init__(self, induk: "KlienPalsu"):
        self.induk = induk

    def create(self, **kw: Any) -> Any:
        return self.induk._jawab(kw)


class KlienPalsu:
    def __init__(self, jawaban: Any = None, *, model: str = MODEL, output_tokens: int = 1400):
        self.daftar = list(jawaban) if isinstance(jawaban, list) else [jawaban]
        self.model = model
        self.output_tokens = output_tokens
        self.panggilan: list[dict] = []
        self.messages = _Messages(self)
        self._cache: set[str] = set()

    def _usage(self, kw: dict) -> dict:
        """tiru hitungan cache API: breakpoint = ujung tiap blok system ber-cache_control. Hit = breakpoint terpanjang yang sudah
        ada di cache; tulis = breakpoint terpanjang baru (≥ 512 token, minimum Haiku 5.5) dikurangi hit; sisanya input biasa."""
        system = kw.get("system") or []
        prefix, titik = "", []  # (token prefix, kunci, ttl)
        for blok in system:
            prefix += blok.get("text", "")
            cc = blok.get("cache_control")
            if cc:
                titik.append((_token_kira(prefix), hashlib.sha256((kw.get("model", "") + prefix).encode()).hexdigest(),
                              cc.get("ttl", "5m")))
        sys_tok = _token_kira(prefix) if system else 0
        hit = max([t for t, k, _ in titik if k in self._cache] or [0])
        baru = [(t, k, ttl) for t, k, ttl in titik if k not in self._cache and t >= 512 and t > hit]
        tulis1h = tulis5m = 0
        if baru:
            t, _k, ttl = max(baru)
            if ttl == "1h":
                tulis1h = t - hit
            else:
                tulis5m = t - hit
        for _t, k, _ttl in baru:
            self._cache.add(k)
        tercakup = hit + tulis1h + tulis5m
        user = 0
        for m in kw.get("messages") or []:
            for b in m.get("content") or []:
                user += 440 if b.get("type") == "image" else _token_kira(b.get("text", ""))
        return {"input_tokens": user + max(0, sys_tok - tercakup), "output_tokens": self.output_tokens,
                "cache_read_input_tokens": hit, "cache_creation_input_tokens": tulis1h + tulis5m,
                "cache_creation": {"ephemeral_1h_input_tokens": tulis1h, "ephemeral_5m_input_tokens": tulis5m},
                "server_tool_use": None, "service_tier": "standard", "inference_geo": None, "speed": None, "output_tokens_details": None}

    def _jawab(self, kw: dict) -> Any:
        self.panggilan.append(kw)
        n = len(self.panggilan)
        j = self.daftar[min(n - 1, len(self.daftar) - 1)]
        if isinstance(j, BaseException):
            raise j
        usage = self._usage(kw)
        rid = f"req_palsu_{n:04d}"
        if j == "refusal":
            usage["output_tokens"] = 12
            return buat_respons(None, "refusal", usage, rid, self.model,
                                {"type": "refusal", "category": "general_harms", "explanation": "palsu"})
        if j == "max_tokens":
            usage["output_tokens"] = kw.get("max_tokens", 8000)
            return buat_respons('{"checklist":[{"poin_id":"p01","hasil":"lol', "max_tokens", usage, rid, self.model)
        if j == "rusak":
            return buat_respons("Maaf, saya tidak bisa membuat JSON.", "end_turn", usage, rid, self.model)
        teks = json.dumps(j if j is not None else {}, ensure_ascii=False)
        return buat_respons(teks, "end_turn", usage, rid, self.model)
