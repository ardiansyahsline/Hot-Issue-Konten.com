"""
Tes pengunduh model & persiapan model (tanpa internet, tanpa GPU) — jalankan:  .venv\\Scripts\\python selftest_unduh.py
(juga jalan di venv ringan tanpa torch / huggingface_hub: bagian yang butuh paket itu memakai modul palsu).

Server HTTP lokal palsu: Range + batas kecepatan PER KONEKSI + putus acak + 200 tanpa Range + tanpa Content-Length + redirect
ke alamat "bertanda tangan" yang kedaluwarsa + macet di tengah. Yang dicek:
  - hasil paralel sha256-nya sama persis, lanjut setelah proses dibunuh (Ctrl+C & kill -9), sha salah → gagal/ulang/sumber lain,
    format baris progres, cadangan satu koneksi, redirect kedaluwarsa diminta ulang, macet → sambung ulang;
  - models.status / missing / status_brief dengan folder model palsu, prepare UTMOS + DeepFilterNet3 dari server lokal,
    prepare HuggingFace (palsu) diulang saat putus & memakai max_workers = DOWNLOAD_CONNECTIONS;
  - natural (UTMOS) / clean (DeepFilterNet) / asr (whisper) / pocket TIDAK PERNAH menyentuh jaringan (socket ditambal);
  - _hf_need: model lengkap = 0 byte (tanpa "mengunduh ±3 GB"), Ctrl+C langsung terasa saat unduhan HF, note_result (proses anak),
    siapkan_model --wajib / --latar, NYALAKAN-MESIN-SUARA.bat & install.ps1 tetap CRLF + ASCII dan langkah unduh tidak menggagalkan instal;
  - kecepatan 1 koneksi vs 8 koneksi pada server yang membatasi 200 KB/s per koneksi.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import random
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import types
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="vw-unduh-"))
# semua cache ke folder tes (tidak menyentuh cache asli laptop)
os.environ["HF_HOME"] = str(TMP / "hf")
os.environ.pop("HF_HUB_CACHE", None)
os.environ["XDG_CACHE_HOME"] = str(TMP / "xdg")
os.environ["NO_PROXY"] = ",".join(x for x in (os.environ.get("NO_PROXY", ""), "127.0.0.1", "localhost") if x)
os.environ["no_proxy"] = os.environ["NO_PROXY"]
sys.path.insert(0, str(ROOT))

from studio_worker import config  # noqa: E402

config.apply_thread_limits(2)

from studio_worker import models, natural, unduh  # noqa: E402
from studio_worker import log as vlog  # noqa: E402

vlog.setup(TMP / "logs", prefix="tes")
MiB = 1024 * 1024
results: list[tuple[str, bool, str]] = []
TESTS: list = []
MEASURE: list[str] = []


def test(fn):
    TESTS.append(fn)
    return fn


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def blob(n: int, seed: int) -> bytes:
    return random.Random(seed).randbytes(n)


# ---------------------------------------------------------------- server palsu
class Srv(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), H)
        self.files: dict[str, bytes] = {}
        self.lock = threading.Lock()
        self.rnd = random.Random(7)
        self.reset()

    def reset(self) -> None:
        self.sent = 0
        self.requests = 0
        self.active = 0
        self.max_active = 0
        self.resolves = 0
        self.tok = 0
        self.tok_uses: dict[int, int] = {}
        self.tok_max = 4
        self.stalled = False

    def url(self, path: str) -> str:
        return f"http://127.0.0.1:{self.server_address[1]}{path}"

    def handle_error(self, request, client_address):  # koneksi diputus klien (memang sengaja di tes) → senyap
        pass


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # senyap
        pass

    def _plain(self, code: int, body: bytes = b"") -> None:
        self.send_response(code)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):  # noqa: C901
        srv: Srv = self.server  # type: ignore[assignment]
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        with srv.lock:
            srv.requests += 1
        if u.path.startswith("/r/"):  # "GitHub": alamat asli → redirect ke alamat bertanda tangan
            with srv.lock:
                srv.resolves += 1
                srv.tok += 1
                tok = srv.tok
                srv.tok_uses[tok] = 0
            self.send_response(302)
            self.send_header("Location", f"/s/{u.path[3:]}?tok={tok}" + (f"&{u.query}" if u.query else ""))
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if u.path.startswith("/s/"):
            tok = int(q.get("tok", ["0"])[0])
            with srv.lock:
                uses = srv.tok_uses.get(tok, 10**6)
                srv.tok_uses[tok] = uses + 1
            if uses >= srv.tok_max:
                return self._plain(403, b"kedaluwarsa")
            name = u.path[3:]
        elif u.path.startswith("/f/"):
            name = u.path[3:]
        elif u.path.startswith("/hf/"):  # "HuggingFace" palsu (HF_ENDPOINT)
            name = u.path[4:]
        else:
            return self._plain(404, b"tidak ada")
        data = srv.files.get(name)
        if data is None:
            return self._plain(404, b"tidak ada")
        rate = float(q.get("rate", ["0"])[0])
        drop = float(q.get("drop", ["0"])[0])
        stall = float(q.get("stall", ["0"])[0])
        norange, nolen = "norange" in q, "nolen" in q
        a, b, partial = 0, len(data) - 1, False
        rng = self.headers.get("Range")
        if rng and not norange:
            m = re.match(r"bytes=(\d+)-(\d*)", rng)
            if m:
                a = int(m.group(1))
                b = min(len(data) - 1, int(m.group(2))) if m.group(2) else len(data) - 1
                if a >= len(data):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(data)}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                partial = True
        body = data[a : b + 1]
        self.send_response(206 if partial else 200)
        if partial:
            self.send_header("Content-Range", f"bytes {a}-{b}/{len(data)}")
        if not norange:
            self.send_header("Accept-Ranges", "bytes")
        if nolen:
            self.send_header("Connection", "close")
            self.close_connection = True
        else:
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        with srv.lock:
            srv.active += 1
            srv.max_active = max(srv.max_active, srv.active)
        t0 = time.monotonic()
        sent = 0
        try:
            while sent < len(body):
                piece = body[sent : sent + 16384]
                with srv.lock:
                    cut = drop and len(body) > 1 and sent > 0 and srv.rnd.random() < drop
                    do_stall = stall and not srv.stalled and sent >= len(body) // 2 and len(body) > 1
                    if do_stall:
                        srv.stalled = True
                if cut:  # putus acak di tengah
                    self.close_connection = True
                    return
                if do_stall:
                    time.sleep(stall)
                self.wfile.write(piece)
                sent += len(piece)
                with srv.lock:
                    srv.sent += len(piece)
                if rate:
                    lag = sent / rate - (time.monotonic() - t0)
                    if lag > 0:
                        time.sleep(lag)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        finally:
            with srv.lock:
                srv.active -= 1


SRV = Srv()
threading.Thread(target=SRV.serve_forever, daemon=True).start()


class Cap:
    def __init__(self):
        self.lines: list[str] = []

    def __call__(self, s: str) -> None:
        self.lines.append(s)


PROG = re.compile(r"^TES  \d{1,3}% · \d+/\d+ MB · \d+,\d MB/s · (sisa ±\d+ (dtk|mnt)|sisa ±\d+ jam \d+ mnt|menyambung…)$")


# ---------------------------------------------------------------- tes pengunduh
@test
def t_format_progres():
    s = unduh.fmt_progress("UTMOS", 145 * MiB, 392 * MiB, 5.2 * MiB)
    assert s == "UTMOS  37% · 145/392 MB · 5,2 MB/s · sisa ±48 dtk", s
    assert unduh.fmt_eta(125) == "2 mnt" and unduh.fmt_eta(4000) == "1 jam 7 mnt", (unduh.fmt_eta(125), unduh.fmt_eta(4000))
    big = unduh.fmt_progress("Chatterbox", 1.5 * 1024 * MiB, 3 * 1024 * MiB, 25 * MiB)
    assert big == "Chatterbox  50% · 1,5/3,0 GB · 25,0 MB/s · sisa ±61 dtk", big
    assert unduh.fmt_progress("X", 0, 10 * MiB, 0).endswith("menyambung…")
    return s


@test
def t_paralel_putus_acak_sha_sama():
    data = blob(24 * MiB + 12345, 1)
    SRV.files["a.bin"] = data
    SRV.reset()
    cap = Cap()
    dest = TMP / "dl" / "a.bin"
    t0 = time.monotonic()
    unduh.fetch(SRV.url("/f/a.bin?drop=0.004&rate=6000000"), dest, sha256=sha(data), connections=8, part_mb=1, label="TES", log=cap, every=0.3)
    dt = time.monotonic() - t0
    assert sha(dest.read_bytes()) == sha(data)
    assert not dest.with_name("a.bin.part").exists() and not dest.with_name("a.bin.part.json").exists()
    assert SRV.max_active >= 6, f"paralel cuma {SRV.max_active} koneksi"
    prog = [x for x in cap.lines if x.startswith("TES  ") and "%" in x]
    assert prog and all(PROG.match(x) for x in prog), prog[:3]
    assert any(x.startswith("TES  selesai · ") for x in cap.lines), cap.lines[-2:]
    retried = SRV.requests - 1 - 25
    return f"24 MB, 8 koneksi (maks {SRV.max_active} bersamaan), {max(0, retried)} sambung ulang karena putus acak, sha256 sama, {dt:.1f} dtk; contoh: {prog[-1]}"


def _child(url: str, dest: Path) -> subprocess.Popen:
    code = (
        f"import sys; sys.path.insert(0, {str(ROOT)!r}); from studio_worker import unduh; "
        f"unduh.fetch({url!r}, {str(dest)!r}, connections=8, part_mb=0.25, label='TES', log=print, every=0.5)"
    )
    return subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=os.environ.copy())


def _meta_done(dest: Path) -> int:
    try:
        return len(json.loads(dest.with_name(dest.name + ".part.json").read_text())["done"])
    except (OSError, ValueError, KeyError):
        return -1


@test
def t_lanjut_setelah_dihentikan_dan_dibunuh():
    data = blob(12 * MiB, 2)
    SRV.files["b.bin"] = data
    SRV.reset()
    url = SRV.url("/f/b.bin?rate=300000")
    dest = TMP / "dl" / "b.bin"
    n_parts = 12 * 4
    # (1) Ctrl+C (SIGINT) di tengah → catatan bagian tersimpan
    p = _child(url, dest)
    time.sleep(2.5)
    if os.name == "nt":
        p.kill()
    else:
        p.send_signal(signal.SIGINT)
    out1 = p.communicate(timeout=20)[0]
    d1 = _meta_done(dest)
    assert 0 < d1 < n_parts, (d1, out1[-400:])
    assert dest.with_name("b.bin.part").exists() and not dest.exists()
    # (2) lanjut, lalu dibunuh paksa (kill -9: tidak sempat beres-beres) → bagian yang sudah fsync tetap tercatat
    p = _child(url, dest)
    time.sleep(3.0)
    p.kill()
    out2 = p.communicate(timeout=20)[0]
    d2 = _meta_done(dest)
    assert d2 > d1, (d1, d2, out2[-400:])
    assert "melanjutkan unduhan sebelumnya" in out2, out2[-400:]
    # (3) lanjut sampai selesai — byte yang dikirim server jauh lebih sedikit dari ukuran file
    sent0 = SRV.sent
    cap = Cap()
    unduh.fetch(url, dest, sha256=sha(data), connections=8, part_mb=0.25, label="TES", log=cap)
    third = SRV.sent - sent0
    assert sha(dest.read_bytes()) == sha(data)
    assert third < len(data) * 0.9, f"tidak melanjutkan: {third} byte dikirim ulang"
    assert any("melanjutkan" in x for x in cap.lines)
    return f"Ctrl+C → {d1}/{n_parts} bagian tersimpan; kill -9 → {d2}/{n_parts}; sisa diunduh {third / MiB:.1f} dari {len(data) / MiB:.0f} MB, sha256 sama"


@test
def t_sha_salah_gagal_lalu_sumber_lain():
    good, bad = blob(3 * MiB, 3), blob(3 * MiB, 4)
    SRV.files["good.bin"], SRV.files["bad.bin"] = good, bad
    dest = TMP / "dl" / "c.bin"
    cap = Cap()
    try:
        unduh.fetch(SRV.url("/f/bad.bin"), dest, sha256=sha(good), connections=4, part_mb=1, label="TES", log=cap)
        raise AssertionError("sha salah harusnya gagal")
    except unduh.DownloadError as e:
        msg = str(e)
    assert "sha256" in msg, msg
    assert not dest.exists() and not dest.with_name("c.bin.part").exists() and not dest.with_name("c.bin.part.json").exists()
    assert sum("diulang sekali" in x for x in cap.lines) == 1, cap.lines
    # mirror salah dulu → GitHub (benar) sebagai cadangan
    cap2 = Cap()
    unduh.fetch([SRV.url("/f/bad.bin"), SRV.url("/f/good.bin")], dest, sha256=sha(good), connections=4, part_mb=1, label="TES", log=cap2)
    assert sha(dest.read_bytes()) == sha(good)
    # cek isi: halaman HTML dari mirror → ditolak torch_ckpt_ok
    SRV.files["page.pt"] = b"<html>404 not found</html>" * 100
    try:
        unduh.fetch(SRV.url("/f/page.pt"), TMP / "dl" / "page.pt", check=unduh.torch_ckpt_ok, label="TES", log=Cap())
        raise AssertionError("halaman HTML harusnya ditolak")
    except unduh.ChecksumError:
        pass
    except unduh.DownloadError as e:
        assert "bukan checkpoint" in str(e), e
    return "sha salah → dihapus, diulang 1×, gagal; daftar [salah, benar] → sumber kedua dipakai; halaman HTML ditolak"


@test
def t_tanpa_range_dan_tanpa_ukuran():
    data = blob(2 * MiB + 7, 5)
    SRV.files["d.bin"] = data
    cap = Cap()
    d1 = TMP / "dl" / "d1.bin"
    unduh.fetch(SRV.url("/f/d.bin?norange=1"), d1, sha256=sha(data), connections=8, label="TES", log=cap)
    assert sha(d1.read_bytes()) == sha(data)
    assert any("satu koneksi" in x for x in cap.lines), cap.lines
    d2 = TMP / "dl" / "d2.bin"
    unduh.fetch(SRV.url("/f/d.bin?norange=1&nolen=1"), d2, sha256=sha(data), connections=8, label="TES", log=Cap())
    assert sha(d2.read_bytes()) == sha(data)
    # tanpa Range + putus → diulang dari awal sampai berhasil
    d3 = TMP / "dl" / "d3.bin"
    cap3 = Cap()
    SRV.rnd.seed(11)
    unduh.fetch(SRV.url("/f/d.bin?norange=1&drop=0.005"), d3, sha256=sha(data), retries=20, label="TES", log=cap3)
    assert sha(d3.read_bytes()) == sha(data)
    ulang = sum("diulang dari awal" in x for x in cap3.lines)
    return f"200 tanpa Range → 1 koneksi; tanpa Content-Length → ok; putus tanpa Range → diulang {ulang}× dari awal, sha256 sama"


@test
def t_redirect_kedaluwarsa_diminta_ulang():
    data = blob(6 * MiB, 6)
    SRV.files["e.bin"] = data
    SRV.reset()
    SRV.tok_max = 4  # tiap alamat bertanda tangan cuma berlaku 4 permintaan
    dest = TMP / "dl" / "e.bin"
    unduh.fetch(SRV.url("/r/e.bin"), dest, sha256=sha(data), connections=4, part_mb=0.5, label="TES", log=Cap())
    assert sha(dest.read_bytes()) == sha(data)
    assert SRV.resolves >= 3, SRV.resolves
    return f"12 bagian, alamat kedaluwarsa tiap 4 permintaan → diminta ulang {SRV.resolves}× dari URL asli, sha256 sama"


@test
def t_macet_disambung_ulang():
    data = blob(3 * MiB, 8)
    SRV.files["f.bin"] = data
    SRV.reset()
    dest = TMP / "dl" / "f.bin"
    t0 = time.monotonic()
    unduh.fetch(SRV.url("/f/f.bin?stall=6"), dest, sha256=sha(data), connections=2, part_mb=1, stall_sec=1.0, label="TES", log=Cap())
    dt = time.monotonic() - t0
    assert sha(dest.read_bytes()) == sha(data)
    assert dt < 5.5, f"menunggu server macet {dt:.1f} dtk (harusnya disambung ulang setelah 1 dtk)"
    return f"server diam 6 dtk di tengah → disambung ulang, selesai {dt:.1f} dtk"


@test
def t_ukuran_beda_dan_dihentikan():
    data = blob(MiB, 9)
    SRV.files["g.bin"] = data
    try:
        unduh.fetch(SRV.url("/f/g.bin"), TMP / "dl" / "g.bin", size=len(data) + 1, label="TES", log=Cap())
        raise AssertionError("ukuran beda harusnya gagal")
    except unduh.DownloadError as e:
        assert "ukuran" in str(e), e
    SRV.files["h.bin"] = blob(8 * MiB, 10)
    stop = threading.Event()
    threading.Timer(0.8, stop.set).start()
    dest = TMP / "dl" / "h.bin"
    t0 = time.monotonic()
    try:
        unduh.fetch(SRV.url("/f/h.bin?rate=200000"), dest, connections=4, part_mb=0.25, label="TES", log=Cap(), stop=stop)
        raise AssertionError("harusnya dihentikan")
    except unduh.DownloadCancelled:
        pass
    dt = time.monotonic() - t0
    assert dt < 5, dt
    assert _meta_done(dest) >= 0 and not dest.exists()
    return f"ukuran beda → ditolak; stop → berhenti {dt:.1f} dtk, catatan lanjut tersimpan ({_meta_done(dest)} bagian)"


@test
def t_kecepatan_1_vs_8_koneksi():
    data = blob(4 * MiB, 12)
    SRV.files["k.bin"] = data
    url = SRV.url("/f/k.bin?rate=204800")  # server membatasi 200 KB/s PER KONEKSI (seperti GitHub di laptop ±115 KB/s)
    out = {}
    for n in (1, 8):
        dest = TMP / "dl" / f"k{n}.bin"
        t0 = time.monotonic()
        unduh.fetch(url, dest, sha256=sha(data), connections=n, part_mb=0.5, label="TES", log=Cap())
        out[n] = time.monotonic() - t0
        assert sha(dest.read_bytes()) == sha(data)
    r1, r8 = len(data) / out[1] / MiB, len(data) / out[8] / MiB
    ratio = out[1] / out[8]
    line = (f"4 MB, batas server 200 KB/s per koneksi: 1 koneksi {out[1]:.1f} dtk ({r1:.2f} MB/s) · 8 koneksi {out[8]:.1f} dtk "
            f"({r8:.2f} MB/s) → {ratio:.1f}× lebih cepat")
    MEASURE.append(line)
    assert ratio >= 4, line
    return line


# ---------------------------------------------------------------- folder model palsu
def st_file(path: Path, keys: list[str]) -> None:
    import struct

    h = {k: {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]} for k in keys}
    hb = json.dumps(h).encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(struct.pack("<Q", len(hb)) + hb + b"\0\0\0\0")


def fake_hf(repo: str, files: dict[str, bytes | list[str]], cache: Path | None = None, commit: str = "a" * 40) -> Path:
    """cache HF palsu: models--org--name/{refs/main, snapshots/<commit>/…}"""
    st = (cache or models.hf_cache_dir()) / ("models--" + repo.replace("/", "--"))
    snap = st / "snapshots" / commit
    for name, content in files.items():
        p = snap / name
        if isinstance(content, list):
            st_file(p, content)
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(content)
    (st / "refs").mkdir(parents=True, exist_ok=True)
    (st / "refs" / "main").write_text(commit)
    return snap


def cfg_(sub: str, **kw) -> SimpleNamespace:
    d = TMP / "cfg" / sub
    for s in ("models", "logs", "tmp", "cache"):
        (d / s).mkdir(parents=True, exist_ok=True)
    base = dict(
        data=d, models=d / "models", logs=d / "logs", tmp=d / "tmp", cache=d / "cache", engine_order=["chatterbox", "pocket"],
        chatterbox_repo=f"tes/cb-{sub}", chatterbox_base_repo=f"tes/cbdasar-{sub}", chatterbox_dir="", hf_token="",
        whisper_model="small", whisper_device="cpu", cpu_threads=2, pocket_repo=f"tes/pocket-{sub}", pocket_config="",
        natural_mos=True, download_connections=8, utmos_urls=(),
    )
    base.update(kw)
    return SimpleNamespace(**base)


def fake_utmos(hub: Path, ckpt_url: str | None = None) -> None:
    repo_dir, _ = models.utmos_paths(hub)
    repo_dir.mkdir(parents=True, exist_ok=True)
    (repo_dir / "hubconf.py").write_text(f"URLS = {{'utmos22_strong': '{ckpt_url or models.UTMOS_GITHUB}'}}\n")
    _, ckpt = models.utmos_paths(hub)
    ckpt.parent.mkdir(parents=True, exist_ok=True)
    ckpt.write_bytes(torch_zip())


def torch_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("archive/data.pkl", b"\x80\x02}q\x00.")
        z.writestr("archive/data/0", os.urandom(4096))
    return buf.getvalue()


def fake_df(root: Path) -> Path:
    d = root / models.DF_NAME
    (d / "checkpoints").mkdir(parents=True, exist_ok=True)
    (d / "config.ini").write_text("[df]\nsr = 48000\n")
    (d / "checkpoints" / "model_120.ckpt.best").write_bytes(b"x" * 100)
    return d


@test
def t_status_folder_palsu():
    cfg = cfg_("st")
    assert models.missing(cfg) == ["chatterbox", "whisper", "deepfilter", "utmos", "pocket"], models.missing(cfg)
    # chatterbox hanya-t3 → belum siap sampai model dasar ada
    fake_hf(cfg.chatterbox_repo, {"t3_mtl23ls_v2.safetensors": ["text_emb.weight", "tfmr.layers.0.x"], "grapheme_mtl_merged_expanded_v1.json": b"{}"})
    f, why = models.chatterbox_files(cfg)
    assert f is None and "dasar" in why, why
    fake_hf(cfg.chatterbox_base_repo, {"ve.pt": b"v", "s3gen.pt": b"s", "conds.pt": b"c", "Cangjie5_TC.json": b"[]", "t3_mtl23ls_v2.safetensors": ["text_emb.weight"], "grapheme_mtl_merged_expanded_v1.json": b"{}"})
    f, why = models.chatterbox_files(cfg)
    assert f and f["mode"] == "hanya-t3" and f["mtl"] and f["ve"].name == "ve.pt" and f["base"] is not None, (f, why)
    # whisper di data/models/whisper (sama dengan WhisperModel(download_root=…))
    fake_hf("Systran/faster-whisper-small", {"model.bin": b"m" * 10, "config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a"}, cache=models.whisper_dir(cfg))
    assert models.whisper_ready(cfg)
    assert not models.whisper_ready(cfg_("st", whisper_model="medium"))
    fake_df(models.df_root())
    assert models.deepfilter_dir() == models.df_root() / models.DF_NAME
    assert models.missing(cfg) == ["utmos", "pocket"], models.missing(cfg)
    b = models.status_brief(cfg)
    assert b == {"chatterbox": "siap", "whisper": "siap", "deepfilter": "siap", "utmos": "belum diunduh", "pocket": "belum diunduh"}, b
    fake_utmos(cfg.models / "torch-hub")
    assert models.utmos_ready(cfg) and models.utmos_paths(cfg)[1].name == models.UTMOS_CKPT
    assert models.missing(cfg) == ["pocket"]
    # NATURAL_MOS=0 → utmos tidak dibutuhkan; ENGINE_ORDER=pocket saja → chatterbox tidak dibutuhkan, pocket wajib
    c2 = cfg_("st", natural_mos=False, engine_order=["pocket"])
    assert models.status_brief(c2)["utmos"] == "mati" and "chatterbox" not in models.status_brief(c2)
    assert models.required(c2) == ["pocket", "whisper"] and models.missing(c2) == ["pocket"]
    st = models.status(cfg)
    assert st["chatterbox"]["ready"] and st["chatterbox"]["bytes"] and st["pocket"]["need"] and not st["pocket"]["ready"]
    return f"urutan missing benar, hanya-t3 butuh model dasar, brief={b}"


# ---------------------------------------------------------------- runtime tidak menyentuh jaringan
@contextlib.contextmanager
def no_network():
    hits: list[str] = []
    old = (socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo)

    def deny(*a, **k):
        hits.append(repr(a[1:2] or a[:1])[:80])
        raise OSError("jaringan dilarang di tes ini")

    socket.socket.connect = lambda self, *a, **k: deny(self, *a)  # type: ignore[method-assign]
    socket.socket.connect_ex = lambda self, *a, **k: deny(self, *a)  # type: ignore[method-assign]
    socket.create_connection = deny  # type: ignore[assignment]
    socket.getaddrinfo = deny  # type: ignore[assignment]
    try:
        yield hits
    finally:
        socket.socket.connect, socket.socket.connect_ex, socket.create_connection, socket.getaddrinfo = old  # type: ignore[method-assign]


@contextlib.contextmanager
def fake_modules(**mods):
    old = {k: sys.modules.get(k) for k in mods}
    sys.modules.update(mods)
    try:
        yield
    finally:
        for k, v in old.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v


def fake_torch(load):
    calls = {"dl": []}

    def dl(*a, **k):
        calls["dl"].append(a)

    hub = SimpleNamespace(load=load, set_dir=lambda d: None, get_dir=lambda: "/asal", download_url_to_file=dl)
    m = types.ModuleType("torch")
    m.hub = hub  # type: ignore[attr-defined]
    m.cuda = SimpleNamespace(is_available=lambda: False)  # type: ignore[attr-defined]
    m.calls = calls  # type: ignore[attr-defined]
    return m


@test
def t_runtime_tanpa_jaringan():
    from studio_worker import asr as asr_mod
    from studio_worker import clean

    cfg = cfg_("rt")
    hub = cfg.models / "torch-hub"
    seen: list = []

    class Pred:
        def to(self, d):
            return self

        def eval(self):
            return self

    def load(repo, model, **kw):
        # saat dimuat, unduhan torch.hub harus diganti penjaga yang menolak
        try:
            sys.modules["torch"].hub.download_url_to_file("http://x", "y")
            seen.append(("BOCOR", repo))
        except RuntimeError:
            seen.append((repo, model, kw.get("source")))
        return Pred()

    ft = fake_torch(load)
    with no_network() as hits, fake_modules(torch=ft):
        # UTMOS belum diunduh → None, tidak menunggu, status jelas
        natural.reset()
        natural.configure(True, hub)
        t0 = time.monotonic()
        assert natural._predictor() is None and natural._predictor() is None
        assert time.monotonic() - t0 < 0.5
        assert "belum diunduh" in natural.mos_status(), natural.mos_status()
        # file muncul (unduhan latar selesai) → models.prepare menaikkan ready_gen → langsung dipakai tanpa menunggu 60 dtk
        fake_utmos(hub)
        assert natural._predictor() is None  # gen belum naik, masih dalam 60 dtk → belum dicek (murah)
        models._state["gen"] += 1
        assert natural._predictor() is not None, natural.mos_status()
        assert seen == [(str(models.utmos_paths(hub)[0]), "utmos22_strong", "local")], seen
        assert natural.mos_status() == "siap"
        # refresh() dari prepare juga menghidupkan lagi
        natural.reset()
        natural.configure(True, TMP / "kosong-hub")
        assert natural._predictor() is None
        natural.configure(True, hub)
        natural.refresh()
        assert natural._predictor() is not None

        # DeepFilterNet: belum ada → ffmpeg; ada → init_df(model_base_dir=folder lokal)
        clean._DF, clean._DF_ERR = None, None
        clean._DF_MISSING.update(on=False, at=0.0, gen=-1)
        import shutil

        shutil.rmtree(models.df_root() / models.DF_NAME, ignore_errors=True)
        assert clean.deepfilter() is None and "belum diunduh" in (clean._DF_ERR or "")
        got = {}

        def init_df(**kw):
            got.update(kw)
            return ("model", "state", "")

        dfe = types.ModuleType("df.enhance")
        dfe.init_df = init_df  # type: ignore[attr-defined]
        dfe.enhance = lambda *a, **k: None  # type: ignore[attr-defined]
        ta = types.ModuleType("torchaudio")
        tab = types.ModuleType("torchaudio.backend")
        tabc = types.ModuleType("torchaudio.backend.common")
        with fake_modules(df=types.ModuleType("df"), **{"df.enhance": dfe, "torchaudio": ta, "torchaudio.backend": tab, "torchaudio.backend.common": tabc}):
            d = fake_df(models.df_root())
            clean.refresh()
            r = clean.deepfilter()
        assert r is not None and got.get("model_base_dir") == str(d), got
        clean._DF, clean._DF_ERR = None, None

        # whisper: belum diunduh → error jelas; ada → WhisperModel(local_files_only=True, download_root=data/models/whisper)
        wk: dict = {}

        class WM:
            def __init__(self, name, **kw):
                wk.update(kw, name=name)

            def transcribe(self, *a, **k):
                return iter([]), None

        fw = types.ModuleType("faster_whisper")
        fw.WhisperModel = WM  # type: ignore[attr-defined]
        with fake_modules(faster_whisper=fw):
            a = asr_mod.Asr(cfg)
            assert not a.available and a.error == asr_mod.MISSING, a.error
            assert not wk
            fake_hf("Systran/faster-whisper-small", {"model.bin": b"m", "config.json": b"{}", "tokenizer.json": b"{}"}, cache=models.whisper_dir(cfg))
            assert not a.available  # masih dalam jeda cek ulang 60 dtk
            a.refresh()
            assert a.available, a.error
        assert wk["local_files_only"] is True and wk["download_root"] == str(models.whisper_dir(cfg)), wk

        # pocket: rujukan hf:// di config → path lokal (tanpa jaringan); belum ada → dilaporkan "belum diunduh"
        pocket_note = "pyyaml tidak ada → dilewati"
        try:
            import yaml  # noqa: F401

            from studio_worker.engines import pocket_engine as pe

            y = TMP / "pk.yaml"
            y.write_text("weights_path: hf://tes/pk/model.safetensors@" + "b" * 40 + "\nweights_path_without_voice_cloning: hf://tes/pk2/m.safetensors\n"
                         "flow_lm:\n  lookup_table:\n    tokenizer_path: hf://tes/pk/tokenizer.json@" + "b" * 40 + "\n")
            out, miss = pe.localize_yaml(y, TMP)
            assert len(miss) == 2, miss
            fake_hf("tes/pk", {"model.safetensors": b"w", "tokenizer.json": b"{}"}, commit="b" * 40)
            out, miss = pe.localize_yaml(y, TMP)
            d2 = yaml.safe_load(out.read_text())
            assert not miss and Path(d2["weights_path"]).is_file() and "weights_path_without_voice_cloning" not in d2, d2
            pocket_note = "config hf:// → path lokal"
        except ImportError:
            pass
        # status untuk detak jantung (tiap 20 dtk) juga murni cek file
        fake_hf(cfg.chatterbox_repo, {"ve.safetensors": b"v", "t3_cfg.safetensors": ["text_emb.weight"], "s3gen.safetensors": b"s", "tokenizer.json": b"{}"})
        brief = models.status_brief(cfg)
        assert brief["chatterbox"] == "siap" and brief["whisper"] == "siap" and brief["utmos"] == "siap", brief
        assert models.missing(cfg) == ["pocket"], models.missing(cfg)
    assert not hits, f"runtime menyentuh jaringan: {hits[:3]}"
    natural.reset()
    return f"0 koneksi jaringan; UTMOS lokal (source=local, unduh diblokir saat muat), DeepFilterNet model_base_dir lokal, whisper local_files_only; pocket: {pocket_note}"


HUBCONF_MIRIP = '''dependencies = ["torch"]
import torch

URLS = {"utmos22_strong": "https://github.com/tarepan/SpeechMOS/releases/download/v1.0.0/utmos22_strong_step7459_v1.pt"}


class M(torch.nn.Module):
    def __init__(self):
        super().__init__()
        self.w = torch.nn.Parameter(torch.zeros(1))

    def forward(self, x, sr):
        return self.w + 3.5


def utmos22_strong(progress: bool = True, pretrained: bool = True):
    # sama dengan hubconf SpeechMOS v1.2.0: bobot lewat torch.hub.load_state_dict_from_url (cache <hub>/checkpoints/)
    m = M()
    if pretrained:
        m.load_state_dict(torch.hub.load_state_dict_from_url(url=URLS["utmos22_strong"], map_location="cpu", progress=progress))
    return m.eval()
'''


@test
def t_library_asli_tanpa_jaringan():
    """torch.hub & faster-whisper ASLI (kalau terpasang): file lokal ditemukan tanpa satu pun koneksi"""
    notes = []
    try:
        import torch
    except ImportError:
        torch = None
    if torch is not None:
        import numpy as np

        cfg = cfg_("asli")
        hub = cfg.models / "torch-hub"
        repo_dir, ckpt = models.utmos_paths(hub)
        repo_dir.mkdir(parents=True, exist_ok=True)
        (repo_dir / "hubconf.py").write_text(HUBCONF_MIRIP)
        _, ckpt = models.utmos_paths(hub)
        ckpt.parent.mkdir(parents=True, exist_ok=True)
        torch.save({"w": torch.zeros(1)}, ckpt)
        before = torch.hub.get_dir()
        with no_network() as hits:
            natural.reset()
            natural.configure(True, hub)
            v = natural.mos(np.sin(np.linspace(0, 400, 16000)).astype(np.float32), 16000)
        assert not hits, hits
        assert v == 3.5 and natural.mos_status() == "siap", (v, natural.mos_status())
        assert torch.hub.get_dir() == before, "folder torch.hub harus dikembalikan"
        natural.reset()
        notes.append("torch.hub.load(source=local) + load_state_dict_from_url menemukan checkpoint di <hub>/checkpoints, MOS=3.5")
    try:
        import faster_whisper  # noqa: F401
    except ImportError:
        faster_whisper = None
    if faster_whisper is not None:
        from studio_worker import asr as asr_mod

        cfg = cfg_("asli-w")
        fake_hf("Systran/faster-whisper-small", {"model.bin": b"bukan model", "config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a"}, cache=models.whisper_dir(cfg))
        with no_network() as hits:
            a = asr_mod.Asr(cfg)
            ok = a.available
        assert not hits, hits
        assert not ok and a.error and "belum diunduh" not in a.error, a.error  # file ketemu lokal, gagal muat (model palsu), tanpa jaringan
        notes.append("faster-whisper asli (local_files_only): file ditemukan lokal, model palsu ditolak ctranslate2 tanpa jaringan")
    return " | ".join(notes) or "torch & faster-whisper tidak terpasang di venv ini → dilewati"


# ---------------------------------------------------------------- prepare dari server lokal
def speechmos_zip(ckpt_url: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("tarepan-SpeechMOS-1a2b3c/hubconf.py", f"dependencies = ['torch']\nURLS = {{'utmos22_strong': '{ckpt_url}'}}\n")
        z.writestr("tarepan-SpeechMOS-1a2b3c/speechmos/__init__.py", "")
    return buf.getvalue()


def df_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("DeepFilterNet3/config.ini", "[df]\nsr = 48000\n")
        z.writestr("DeepFilterNet3/checkpoints/model_120.ckpt.best", os.urandom(2048))
    return buf.getvalue()


@test
def t_prepare_utmos_dan_deepfilter_lokal():
    import shutil

    shutil.rmtree(models.df_root() / models.DF_NAME, ignore_errors=True)
    # mirror: 404 → ukuran salah (halaman HTML) → isi salah tapi ukuran sama → GitHub (redirect, benar)
    ck = torch_zip()  # zip kecil berformat checkpoint torch, dianggap "file resmi" lewat UTMOS_SIZE/UTMOS_SHA256 di bawah
    wrong = b"PK" + os.urandom(len(ck) - 2)
    cfg = cfg_("prep", utmos_urls=(SRV.url("/f/tidak-ada.pt"), SRV.url("/f/halaman.pt"), "hf://tes/utmos/salah.pt"))
    SRV.files["utmos22_strong_step7459_v1.pt"] = ck
    SRV.files["halaman.pt"] = b"<!doctype html><title>mirror rusak</title>"
    SRV.files["tes/utmos/resolve/main/salah.pt"] = wrong  # hf://tes/utmos/salah.pt → <HF_ENDPOINT>/tes/utmos/resolve/main/salah.pt
    SRV.files["SpeechMOS.zip"] = speechmos_zip(SRV.url("/r/utmos22_strong_step7459_v1.pt"))
    SRV.files["DeepFilterNet3.zip"] = df_zip()
    old = (models.UTMOS_REPO_URLS, models.DF_URLS, models.UTMOS_SIZE, models.UTMOS_SHA256, os.environ.get("HF_ENDPOINT"))
    models.UTMOS_REPO_URLS = [SRV.url("/f/SpeechMOS.zip?norange=1")]
    models.DF_URLS = [SRV.url("/r/DeepFilterNet3.zip")]
    models.UTMOS_SIZE, models.UTMOS_SHA256 = len(ck), sha(ck)
    os.environ["HF_ENDPOINT"] = SRV.url("/hf")
    cap = Cap()
    try:
        res = models.prepare(cfg, ["deepfilter", "utmos"], cap)
    finally:
        models.UTMOS_REPO_URLS, models.DF_URLS, models.UTMOS_SIZE, models.UTMOS_SHA256 = old[:4]
        if old[4] is None:
            os.environ.pop("HF_ENDPOINT", None)
        else:
            os.environ["HF_ENDPOINT"] = old[4]
    assert res == {"deepfilter": "siap", "utmos": "siap"}, (res, cap.lines[-8:])
    repo_dir, ckpt = models.utmos_paths(cfg)
    assert (repo_dir / "hubconf.py").is_file() and ckpt.read_bytes() == ck and repo_dir.name == "tarepan_SpeechMOS_v1.2.0"
    assert models.deepfilter_dir() is not None
    assert sum("coba sumber berikutnya" in x for x in cap.lines) == 3, cap.lines
    assert any("sha256 tidak cocok" in x for x in cap.lines), cap.lines
    left = [p.name for p in (cfg.models / "torch-hub").iterdir()]
    assert sorted(left) == ["checkpoints", "tarepan_SpeechMOS_v1.2.0"], left  # zip & folder sementara sudah dibersihkan
    g0 = models.ready_gen()
    res2 = models.prepare(cfg, ["deepfilter", "utmos"], Cap())  # sudah ada → tidak mengunduh lagi
    assert res2 == {"deepfilter": "siap", "utmos": "siap"} and models.ready_gen() == g0
    return "UTMOS: mirror 404 → mirror HTML ditolak → GitHub (redirect) berhasil, layout torch.hub benar; DeepFilterNet3 terpasang di folder appdirs"


@test
def t_prepare_hf_diulang_dan_max_workers():
    calls: list[dict] = []

    def snapshot_download(repo_id, allow_patterns=None, token=None, cache_dir=None, max_workers=8, local_files_only=False, **kw):
        if local_files_only:
            p = models._hf_local_manual(repo_id, allow_patterns, Path(cache_dir) if cache_dir else None)
            if p is None:
                raise FileNotFoundError("tidak ada di cache")
            return str(p)
        calls.append({"repo": repo_id, "workers": max_workers, "cache": cache_dir, "pat": allow_patterns})
        if len([c for c in calls if c["repo"] == repo_id]) < 3:
            raise OSError("koneksi putus")
        files = {"model.bin": b"m" * 2048, "config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a"}
        return str(fake_hf(repo_id, files, cache=Path(cache_dir) if cache_dir else None, commit="c" * 40))

    class Api:
        def model_info(self, *a, **k):
            raise OSError("tanpa internet")

    hh = types.ModuleType("huggingface_hub")
    hh.snapshot_download = snapshot_download  # type: ignore[attr-defined]
    hh.HfApi = Api  # type: ignore[attr-defined]
    hu = types.ModuleType("huggingface_hub.utils")
    hu.disable_progress_bars = lambda: None  # type: ignore[attr-defined]
    hu.filter_repo_objects = lambda items, **k: items  # type: ignore[attr-defined]
    hh.utils = hu  # type: ignore[attr-defined]
    cfg = cfg_("hf", download_connections=12)
    cap = Cap()
    old_wait = models.HF_WAIT
    models.HF_WAIT = 0.01
    try:
        with fake_modules(huggingface_hub=hh, **{"huggingface_hub.utils": hu}):
            res = models.prepare(cfg, ["whisper"], cap)
            ready = models.whisper_ready(cfg)
    finally:
        models.HF_WAIT = old_wait
    assert res == {"whisper": "siap"} and ready, (res, cap.lines)
    assert len(calls) == 3 and all(c["workers"] == 12 for c in calls), calls
    assert calls[0]["cache"] == str(models.whisper_dir(cfg)) and "model.bin" in calls[0]["pat"], calls[0]
    assert sum("dilanjutkan lagi" in x for x in cap.lines) == 2, cap.lines
    return "putus 2× → diulang otomatis → siap; max_workers=DOWNLOAD_CONNECTIONS (12); cache whisper = data/models/whisper"


@test
def t_siapkan_model_cli():
    env = os.environ.copy()
    d = TMP / "cli"
    env.update(DATA_DIR=str(d), HF_HOME=str(d / "hf"), XDG_CACHE_HOME=str(d / "xdg"), SUPABASE_URL="", SUPABASE_SERVICE_ROLE_KEY="", PYTHONUTF8="1")
    py = [sys.executable, str(ROOT / "siapkan_model.py")]
    r = subprocess.run(py + ["--cek"], env=env, capture_output=True, text=True, timeout=120)
    assert r.returncode == 1 and "BELUM ADA (wajib)" in r.stdout and "chatterbox" in r.stdout, (r.returncode, r.stdout[-600:], r.stderr[-600:])
    # model wajib (chatterbox + whisper) palsu tersedia → --cek lolos
    cache = d / "hf" / "hub"
    fake_hf("grandhigh/Chatterbox-TTS-Indonesian", {"ve.safetensors": b"v", "t3_cfg.safetensors": ["text_emb.weight"], "s3gen.safetensors": b"s", "tokenizer.json": b"{}"}, cache=cache)
    fake_hf("Systran/faster-whisper-small", {"model.bin": b"m", "config.json": b"{}", "tokenizer.json": b"{}"}, cache=d / "models" / "whisper")
    r2 = subprocess.run(py + ["--cek"], env=env, capture_output=True, text=True, timeout=120)
    assert r2.returncode == 0 and "Model wajib sudah siap" in r2.stdout, (r2.returncode, r2.stdout[-600:], r2.stderr[-600:])
    r3 = subprocess.run(py + ["--hanya", "apa"], env=env, capture_output=True, text=True, timeout=60)
    assert r3.returncode == 2
    # --wajib (NYALAKAN-MESIN-SUARA.bat): model wajib sudah ada → langsung selesai, model opsional TIDAK diunduh di depan
    r4 = subprocess.run(py + ["--cepat", "--wajib"], env=env, capture_output=True, text=True, timeout=120)
    assert r4.returncode == 0 and "Model wajib sudah siap" in r4.stdout and "Menyiapkan:" not in r4.stdout, (r4.returncode, r4.stdout[-600:], r4.stderr[-600:])
    # --latar (proses anak unduhan latar worker): tanpa tabel, baris akhir @@hasil {json}
    fake_df(d / "xdg" / "DeepFilterNet")
    r5 = subprocess.run(py + ["--latar", "--hanya", "deepfilter"], env=env, capture_output=True, text=True, timeout=120)
    last = [x for x in r5.stdout.splitlines() if x.strip()][-1:]
    assert r5.returncode == 0 and last == ['@@hasil {"deepfilter": "siap"}'] and "Model suara di laptop" not in r5.stdout, (r5.returncode, r5.stdout[-600:], r5.stderr[-600:])
    lines = [x for x in r2.stdout.splitlines() if x.startswith("  ")]
    return f"tanpa .env Supabase: --cek kode 1 → setelah model wajib ada kode 0; --cepat --wajib tidak mengunduh opsional; --latar → @@hasil; tabel: {lines[1].split()[0:3]}"


@test
def t_hf_need_model_lengkap_nol():
    """_hf_need: model yang sudah lengkap = 0 byte (dulu selalu ukuran penuh → 'mengunduh ±3 GB' + baris 0% palsu); setengah jadi = sisanya"""
    sha_ = "b" * 40
    sibs = [SimpleNamespace(rfilename=n, size=sz) for n, sz in (("model.bin", 2048), ("config.json", 2), ("tokenizer.json", 2), ("vocabulary.txt", 1), ("README.md", 900), (".gitattributes", 50))]
    calls: list[str] = []

    class Api:
        def model_info(self, repo, files_metadata=False, token=None):
            return SimpleNamespace(sha=sha_, siblings=list(sibs))

    def snapshot_download(repo_id, allow_patterns=None, token=None, cache_dir=None, max_workers=8, local_files_only=False, **kw):
        if local_files_only:
            p = models._hf_local_manual(repo_id, allow_patterns, Path(cache_dir) if cache_dir else None)
            if p is None:
                raise FileNotFoundError("tidak ada di cache")
            return str(p)
        calls.append(repo_id)
        return str(fake_hf(repo_id, {"model.bin": b"m" * 2048, "config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a"}, cache=Path(cache_dir) if cache_dir else None, commit=sha_))

    def filter_repo_objects(items, allow_patterns=None, key=None, **k):
        return [x for x in items if models._match(key(x) if key else x, allow_patterns)]

    hh = types.ModuleType("huggingface_hub")
    hh.HfApi = Api  # type: ignore[attr-defined]
    hh.snapshot_download = snapshot_download  # type: ignore[attr-defined]
    hu = types.ModuleType("huggingface_hub.utils")
    hu.filter_repo_objects = filter_repo_objects  # type: ignore[attr-defined]
    hu.disable_progress_bars = lambda: None  # type: ignore[attr-defined]
    hh.utils = hu  # type: ignore[attr-defined]
    cache = TMP / "need"
    repo = "tes/need-whisper"
    with fake_modules(huggingface_hub=hh, **{"huggingface_hub.utils": hu}):
        assert models._hf_need(repo, models.WHISPER_FILES, None, cache) == 2048 + 2 + 2 + 1  # belum ada sama sekali (README tidak dihitung)
        fake_hf(repo, {"model.bin": b"m" * 2048, "config.json": b"{}", "tokenizer.json": b"{}", "vocabulary.txt": b"a"}, cache=cache, commit=sha_)
        need_full = models._hf_need(repo, models.WHISPER_FILES, None, cache)
        cap = Cap()
        p = models._hf_get(repo, models.WHISPER_FILES, None, label="Whisper tes", say=cap, conns=8, cache_dir=cache)
        (cache / ("models--" + repo.replace("/", "--")) / "snapshots" / sha_ / "model.bin").unlink()
        need_half = models._hf_need(repo, models.WHISPER_FILES, None, cache)
        # snapshot lama (revisi lain) di cache → file revisi terbaru tetap dihitung perlu diunduh
        old_sha = sha_
        sha_ = "c" * 40
        need_new_rev = models._hf_need(repo, models.WHISPER_FILES, None, cache)
        sha_ = old_sha
    assert need_full == 0, need_full
    assert p is not None and p.name == sha_ and calls == [], (p, calls)  # lengkap → tidak ke jaringan sama sekali
    assert not any("mengunduh ±" in x for x in cap.lines), cap.lines
    assert need_half == 2048, need_half
    assert need_new_rev == 2048 + 2 + 2 + 1, need_new_rev
    return f"lengkap → 0 byte, tanpa snapshot_download & tanpa baris 'mengunduh ±'; model.bin hilang → {need_half} byte; revisi baru → penuh"


@test
def t_ctrl_c_saat_unduhan_hf_langsung_terasa():
    """_interruptible: Ctrl+C sampai di thread utama dalam ±0,2 dtk walau unduhan (di thread lain) masih jalan — dulu menunggu file selesai"""
    if threading.current_thread() is not threading.main_thread():
        return "dilewati (bukan thread utama)"
    blocker = threading.Event()
    got: dict = {}

    def slow():
        blocker.wait(10)  # unduhan HF yang macet / lama
        return "selesai"

    def ctrl_c():
        time.sleep(0.3)
        os.kill(os.getpid(), signal.SIGINT)

    threading.Thread(target=ctrl_c, daemon=True).start()
    t0 = time.monotonic()
    try:
        got["v"] = models._interruptible(slow)
    except KeyboardInterrupt:
        got["ki"] = time.monotonic() - t0
    finally:
        blocker.set()
    assert "ki" in got and got["ki"] < 1.5, got
    # hasil & error tetap diteruskan apa adanya
    assert models._interruptible(lambda a, b=0: a + b, 2, b=3) == 5

    def boom():
        raise OSError("koneksi putus")

    try:
        models._interruptible(boom)
        raise AssertionError("error harus diteruskan")
    except OSError as e:
        assert "putus" in str(e)
    return f"Ctrl+C terasa {got['ki']:.2f} dtk sesudah ditekan (unduhan masih jalan 10 dtk); hasil & error diteruskan"


@test
def t_note_result_proses_lain():
    """worker mengunduh lewat proses anak → note_result: ready_gen naik (komponen cek ulang), gagal tercatat di status_brief"""
    cfg = cfg_("note")
    g0 = models.ready_gen()
    models.note_result("utmos", "gagal: koneksi putus")
    assert models.status_brief(cfg)["utmos"].startswith("gagal unduh: koneksi putus"), models.status_brief(cfg)
    assert models.ready_gen() == g0
    models.note_result("utmos", "siap")
    assert models.ready_gen() == g0 + 1 and "utmos" not in models._state["fail"]
    assert models.status_brief(cfg)["utmos"] == "belum diunduh"  # file belum ada di folder tes ini → tetap jujur
    return "gagal → 'gagal unduh: …'; siap → ready_gen +1"


@test
def t_skrip_windows_crlf_ascii_dan_alur():
    """NYALAKAN-MESIN-SUARA.bat & install.ps1: CRLF + ASCII; NYALAKAN hanya unduh model wajib & memanggil install.ps1 -TanpaModel;
    langkah unduh model install.ps1 tidak bisa menggagalkan instal (Ctrl+C ditahan untuk PowerShell, kode keluar 0)"""
    bat = (ROOT.parent / "NYALAKAN-MESIN-SUARA.bat").read_bytes()
    ps1 = (ROOT / "install.ps1").read_bytes()
    sm = (ROOT / "SIAPKAN-MODEL.bat").read_bytes()
    for name, raw in (("NYALAKAN-MESIN-SUARA.bat", bat), ("install.ps1", ps1), ("SIAPKAN-MODEL.bat", sm)):
        raw.decode("ascii")  # UnicodeDecodeError = ada huruf non-ASCII (cmd.exe / PowerShell 5.1 tanpa BOM salah baca)
        assert b"\n" in raw and raw.count(b"\n") == raw.count(b"\r\n"), f"{name}: harus CRLF semua"
    b = bat.decode("ascii")
    assert "siapkan_model.py --cepat --wajib" in b, "NYALAKAN: hanya model wajib di depan"
    assert '-File ".\\install.ps1" -TanpaModel' in b, "NYALAKAN: install.ps1 tanpa langkah unduh model"
    p = ps1.decode("ascii").replace("\r\n", "\n")
    assert "[switch]$TanpaModel" in p and "CancelKeyPress" in p and "e.Cancel = true" in p
    lines = p.split("\n")
    opener = [i for i, x in enumerate(lines) if x.rstrip().endswith("@'")]
    closer = [i for i, x in enumerate(lines) if x.startswith("'@")]
    assert len(opener) == 1 and len(closer) == 1 and closer[0] > opener[0], (opener, closer)  # here-string: '@ wajib di kolom 0
    assert p.count("{") == p.count("}"), "kurung kurawal install.ps1 tidak seimbang"
    step9 = p[p.index('Langkah "9/9') : p.index('"Selesai dipasang."')]
    assert "& $py siapkan_model.py\n" in step9 and "$kodeModel = $LASTEXITCODE" in step9
    assert not re.search(r"\b(Gagal|Cek)\s", step9) and "exit" not in step9, "langkah 9 tidak boleh memanggil Gagal/Cek/exit (instal gagal)"
    assert p.rstrip().endswith("exit 0"), "install.ps1 harus diakhiri exit 0"
    return "CRLF + ASCII; NYALAKAN: --cepat --wajib & install.ps1 -TanpaModel; install.ps1 langkah 9 tidak pernah exit 1"


# ---------------------------------------------------------------- jalankan
def run_test(fn) -> None:
    name = fn.__name__.removeprefix("t_").replace("_", " ")
    t0 = time.time()
    try:
        info = fn() or ""
        results.append((name, True, f"{info} ({time.time() - t0:.1f} dtk)"))
        print(f"[OK]    {name}: {info} ({time.time() - t0:.1f} dtk)")
    except Exception as e:
        results.append((name, False, f"{type(e).__name__}: {e}"))
        print(f"[GAGAL] {name}: {type(e).__name__}: {e}")
        traceback.print_exc()


def main() -> int:
    only = [a.lower() for a in sys.argv[1:]]
    for fn in TESTS:
        if not only or any(o in fn.__name__.lower() for o in only):
            run_test(fn)
    ok = sum(1 for r in results if r[1])
    print(f"\n=== {ok}/{len(results)} tes lolos ===")
    for m in MEASURE:
        print(f"  ukur: {m}")
    for n, good, info in results:
        if not good:
            print(f"  GAGAL: {n} — {info}")
    SRV.shutdown()
    import shutil

    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if ok == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
