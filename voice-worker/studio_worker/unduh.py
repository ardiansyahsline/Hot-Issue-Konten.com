"""
Pengunduh file model yang tangguh (httpx + thread, tanpa paket baru) — dipakai SIAPKAN-MODEL.bat / models.prepare, TIDAK PERNAH
di tengah job.

Kenapa tidak pakai torch.hub / requests biasa: satu koneksi, tanpa lanjut-kalau-putus. GitHub Releases di laptop cuma ±115 KB/s
PER KONEKSI → file UTMOS 392 MB butuh ±1 jam. Di sini file dibagi beberapa bagian (bawaan 8 MB) yang diunduh paralel (bawaan 8
koneksi, header Range), jadi kecepatannya ±8× lipat selama internet masih longgar.

  - lanjut setelah putus / dimatikan: catatan bagian yang sudah selesai ada di <file>.part.json (disimpan tiap bagian selesai,
    sesudah fsync), data di <file>.part. Jalankan lagi → hanya bagian yang belum ada yang diunduh.
  - retry per bagian dengan jeda bertahap; bagian yang masih maju (ada byte masuk) tidak dihitung gagal.
  - macet 30 dtk tanpa byte → koneksi diputus & disambung ulang (timeout baca httpx).
  - redirect: URL bertanda tangan (GitHub release-assets / CDN HF) bisa kedaluwarsa → saat 401/403/404/410 alamat diminta ulang
    dari URL asli.
  - server tanpa dukungan Range / tanpa ukuran → cadangan satu koneksi (tidak bisa dilanjutkan, diulang dari awal kalau putus).
  - beberapa URL dicoba berurutan (mirror dulu, GitHub cadangan); ukuran, sha256 & cek isi (mis. CRC zip) diperiksa sebelum file
    dipindah ATOMIK ke nama akhir — file akhir hanya ada kalau sudah lengkap & benar.
  - baris progres ±2 dtk: "UTMOS  37% · 145/392 MB · 5,2 MB/s · sisa ±48 dtk".
Aman di Windows: tiap thread punya pegangan file sendiri (seek + write), tanpa os.pwrite.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import queue
import random
import re
import threading
import time
import zipfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlsplit

MiB = 1024 * 1024
CHUNK = 256 * 1024
UA = "voice-worker-unduh/1.0 (+Studio Pro)"
_log = logging.getLogger("vw.unduh")


class DownloadError(Exception):
    """unduhan gagal dari semua sumber (pesan bahasa awam)"""


class DownloadCancelled(DownloadError):
    """dihentikan (Ctrl+C / worker berhenti) — bagian yang sudah selesai disimpan untuk dilanjutkan"""


class ChecksumError(DownloadError):
    """ukuran / sha256 / isi file tidak cocok"""


class _NoRange(Exception):
    pass


class _Expired(Exception):
    pass


class _Transient(Exception):
    pass


class _Fatal(Exception):
    pass


# ---------------------------------------------------------------- format angka (koma desimal, gaya Indonesia)
def _num(x: float, nd: int = 1) -> str:
    return f"{x:.{nd}f}".replace(".", ",")


def fmt_size(done: float, total: float | None = None) -> str:
    """'145/392 MB' atau '1,1/3,0 GB' / '40/96 KB' (satuan ikut total)"""
    ref = total if total else done
    if ref < MiB:
        return f"{done / 1024:.0f}/{total / 1024:.0f} KB" if total else f"{done / 1024:.0f} KB"
    if ref >= 2 * 1024 * MiB:
        g = 1024 * MiB
        return f"{_num(done / g)}/{_num(total / g)} GB" if total else f"{_num(done / g)} GB"
    return f"{done / MiB:.0f}/{total / MiB:.0f} MB" if total else f"{done / MiB:.0f} MB"


def fmt_rate(bps: float) -> str:
    return f"{_num(max(0.0, bps) / MiB)} MB/s"


def fmt_eta(sec: float) -> str:
    """'48 dtk' / '7 mnt' / '1 jam 5 mnt' (detik persis — ini progres unduhan, bukan pesan job)"""
    s = max(0, int(round(sec)))
    if s < 90:
        return f"{s} dtk"
    if s < 3600:
        return f"{int(round(s / 60))} mnt"
    return f"{s // 3600} jam {int(round((s % 3600) / 60))} mnt"


def fmt_progress(label: str, done: float, total: float | None, bps: float) -> str:
    """baris progres: 'UTMOS  37% · 145/392 MB · 5,2 MB/s · sisa ±48 dtk'"""
    if total:
        pct = 100 if done >= total else max(0, min(99, int(round(done * 100 / total))))
        tail = f"sisa ±{fmt_eta((total - done) / bps)}" if bps > 1024 else "menyambung…"
        return f"{label}  {pct}% · {fmt_size(done, total)} · {fmt_rate(bps)} · {tail}"
    return f"{label}  {fmt_size(done)} · {fmt_rate(bps)}"


class Meter:
    """laju unduh rata-rata ±6 dtk terakhir + pengatur baris progres tiap `every` detik (dipakai juga untuk unduhan HuggingFace)"""

    def __init__(self, label: str, total: float | None, log: Callable[[str], None] | None, every: float = 2.0, start: float = 0.0):
        self.label, self.total, self.log, self.every = label, total, log, every
        self.t0 = time.monotonic()
        self.base = start
        self.hist: deque = deque([(self.t0, start)], maxlen=64)
        self.last = self.t0

    def rate(self, done: float) -> float:
        now = time.monotonic()
        self.hist.append((now, done))
        while len(self.hist) > 2 and now - self.hist[0][0] > 6.0:
            self.hist.popleft()
        t, b = self.hist[0]
        return (done - b) / (now - t) if now - t > 0.05 else 0.0

    def tick(self, done: float, force: bool = False) -> None:
        now = time.monotonic()
        bps = self.rate(done)
        if force and now - self.t0 < 1.0:
            return  # file kecil / cepat: cukup baris "selesai"
        if self.log and (force or now - self.last >= self.every):
            self.last = now
            self.log(fmt_progress(self.label, done, self.total, bps))

    def finish(self, done: float, note: str = "selesai") -> None:
        if not self.log:
            return
        dt = max(0.001, time.monotonic() - self.t0)
        got = max(0.0, done - self.base)
        self.log(f"{self.label}  {note} · {fmt_size(done)} dalam {fmt_eta(dt)} ({fmt_rate(got / dt)})")


# ---------------------------------------------------------------- cek isi
def sha256_file(path: Path, bufsize: int = 4 * MiB) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(bufsize)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def zip_ok(path: Path) -> str | None:
    """None kalau file zip utuh (CRC semua isi cocok); selain itu alasan"""
    try:
        with zipfile.ZipFile(path) as z:
            bad = z.testzip()
        return None if bad is None else f"isi zip rusak ({bad})"
    except zipfile.BadZipFile as e:
        return f"bukan file zip ({e})"
    except OSError as e:
        return f"tidak bisa dibaca ({e})"


def torch_ckpt_ok(path: Path) -> str | None:
    """checkpoint PyTorch: format zip (torch ≥ 1.6, CRC dicek) atau pickle lama. Halaman HTML/teks dari mirror yang salah → ditolak."""
    try:
        with open(path, "rb") as f:
            head = f.read(4)
    except OSError as e:
        return f"tidak bisa dibaca ({e})"
    if head.startswith(b"PK"):
        return zip_ok(path)
    if head[:1] == b"\x80":  # pickle protocol 2+ (format torch.save lama)
        return None
    return "bukan checkpoint PyTorch (mungkin halaman error dari server)"


# ---------------------------------------------------------------- inti
@dataclass
class _Probe:
    url: str  # alamat akhir setelah redirect (bisa bertanda tangan & kedaluwarsa)
    total: int | None
    ranges: bool
    etag: str | None
    modified: str | None


def _host(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


def _backoff(n: int) -> float:
    return min(30.0, 0.6 * (2 ** min(n, 6))) * (0.75 + 0.5 * random.random())


class _Job:
    def __init__(self, url: str, dest: Path, *, size, sha256, connections, part_mb, timeout, retries, label, log, headers, check, stall_sec, stop, every):
        self.orig = url
        self.dest = dest
        self.part = dest.with_name(dest.name + ".part")
        self.meta = dest.with_name(dest.name + ".part.json")
        self.size = size
        self.sha = (sha256 or "").lower() or None
        self.conns = max(1, int(connections))
        self.part_size = max(256 * 1024, int(float(part_mb) * MiB))
        self.timeout = float(timeout)
        self.retries = max(0, int(retries))
        self.label = label or dest.name
        self.log = log
        self.headers = dict(headers or {})
        self.check = check
        self.stall = float(stall_sec)
        self.stop = stop
        self.every = every
        self.halt = threading.Event()
        self.lock = threading.Lock()
        self.rlock = threading.Lock()
        self.cur_url = url
        self.gen = 0
        self.got = 0
        self.done: set[int] = set()
        self.err: BaseException | None = None
        self.norange = False
        self.clients: list = []
        self.probe: _Probe | None = None
        self.resolves = 0
        self.meter: Meter | None = None

    # -------------------------------------------------------------- http
    def client(self):
        import httpx

        c = httpx.Client(
            follow_redirects=True,
            timeout=httpx.Timeout(self.timeout, read=self.stall, write=60.0, pool=60.0),
            headers={"User-Agent": UA, "Accept-Encoding": "identity"},
        )
        with self.lock:
            self.clients.append(c)
        return c

    def hdr(self, url: str, extra: dict | None = None) -> dict:
        # header rahasia (mis. token HF) hanya ke host asal, tidak ke CDN hasil redirect
        h = dict(self.headers) if _host(url) == _host(self.orig) else {k: v for k, v in self.headers.items() if k.lower() != "authorization"}
        if extra:
            h.update(extra)
        return h

    def do_probe(self, client) -> _Probe:
        """GET Range 0-0 ke URL asli (redirect diikuti): ukuran, dukungan Range, alamat akhir"""
        import httpx

        fails = 0
        while True:
            self._check_stop()
            try:
                with client.stream("GET", self.orig, headers=self.hdr(self.orig, {"Range": "bytes=0-0"})) as r:
                    code = r.status_code
                    etag, mod = r.headers.get("etag"), r.headers.get("last-modified")
                    final = str(r.url)
                    if code == 206:
                        m = re.match(r"\s*bytes\s+0-0/(\d+)", r.headers.get("content-range", ""))
                        total = int(m.group(1)) if m else None
                        self.resolves += 1
                        return _Probe(final, total, total is not None, etag, mod)
                    if code == 200:
                        cl = r.headers.get("content-length", "")
                        enc = r.headers.get("content-encoding", "identity").lower()
                        total = int(cl) if cl.isdigit() and enc in ("", "identity") else None
                        self.resolves += 1
                        return _Probe(final, total, False, etag, mod)
                    if code == 416:  # file kosong
                        m = re.match(r"\s*bytes\s+\*/(\d+)", r.headers.get("content-range", ""))
                        self.resolves += 1
                        return _Probe(final, int(m.group(1)) if m else 0, False, etag, mod)
                    if code in (401, 403, 404, 410):
                        raise _Fatal(f"HTTP {code} dari {_host(final)}")
                    raise _Transient(f"HTTP {code}")
            except (_Transient, httpx.TransportError, httpx.TimeoutException) as e:
                fails += 1
                if fails > self.retries:
                    raise _Fatal(f"tidak bisa tersambung ({type(e).__name__}: {str(e)[:120]})") from e
                self._sleep(_backoff(fails))

    def _sleep(self, sec: float) -> None:
        if self.halt.wait(sec):
            self._check_stop()

    def _check_stop(self) -> None:
        if self.stop is not None and self.stop.is_set():
            self.halt.set()
            raise DownloadCancelled("unduhan dihentikan")

    def reresolve(self, gen: int) -> None:
        """minta alamat bertanda tangan baru dari URL asli (sekali untuk semua thread)"""
        with self.rlock:
            if self.gen != gen:
                return
            c = self.client()
            try:
                p = self.do_probe(c)
            except _Fatal:
                p = None
            finally:
                c.close()
            if p is not None:
                if self.probe and p.total is not None and self.probe.total is not None and p.total != self.probe.total:
                    raise _Fatal("file di server berubah ukuran saat diunduh")
                self.cur_url = p.url
            else:
                self.cur_url = self.orig  # ikuti redirect tiap permintaan
            self.gen += 1

    # -------------------------------------------------------------- catatan lanjut
    def load_meta(self, p: _Probe) -> int | None:
        """bagian yang sudah selesai dari unduhan sebelumnya (kalau cocok). Balikan ukuran bagian yang dipakai, None = mulai baru."""
        try:
            m = json.loads(self.meta.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        try:
            ok = (
                m.get("v") == 1
                and m.get("url") == self.orig
                and int(m.get("total", -1)) == p.total
                and (not m.get("etag") or not p.etag or m.get("etag") == p.etag)
                and self.part.exists()
                and self.part.stat().st_size == p.total
            )
            ps = int(m.get("part", 0))
        except (TypeError, ValueError, OSError):
            return None
        if not ok or ps < 64 * 1024:
            return None
        n = math.ceil(p.total / ps) if p.total else 0
        self.done = {int(i) for i in m.get("done", []) if 0 <= int(i) < n}
        return ps

    def save_meta(self) -> None:
        p = self.probe
        if not p:
            return
        d = {"v": 1, "url": self.orig, "total": p.total, "part": self.part_size, "etag": p.etag, "modified": p.modified, "done": sorted(self.done)}
        tmp = self.meta.with_name(self.meta.name + ".tmp")
        try:
            tmp.write_text(json.dumps(d), encoding="utf-8")
            os.replace(tmp, self.meta)
        except OSError:
            pass  # gagal mencatat = paling buruk mengulang bagian itu nanti

    def drop_partial(self) -> None:
        for f in (self.part, self.meta, self.meta.with_name(self.meta.name + ".tmp")):
            try:
                f.unlink()
            except OSError:
                pass

    # -------------------------------------------------------------- paralel
    def add(self, n: int) -> None:
        with self.lock:
            self.got += n

    def worker(self, q: "queue.Queue[int]") -> None:
        fh = None
        try:
            client = self.client()
            fh = open(self.part, "r+b")
            while not self.halt.is_set():
                try:
                    idx = q.get_nowait()
                except queue.Empty:
                    return
                self.one_part(client, fh, idx)
        except _NoRange:
            self.norange = True
            self.halt.set()
        except BaseException as e:  # noqa: BLE001 — dicatat lalu dilaporkan thread utama
            with self.lock:
                if self.err is None:
                    self.err = e
            self.halt.set()
        finally:
            if fh is not None:
                try:
                    fh.close()
                except OSError:
                    pass

    def one_part(self, client, fh, idx: int) -> None:
        import httpx

        total = self.probe.total  # type: ignore[union-attr]
        a = idx * self.part_size
        n = min(total, a + self.part_size) - a
        got, fails = 0, 0
        while True:
            if self.halt.is_set():
                return
            url, gen = self.cur_url, self.gen
            before = got
            try:
                with client.stream("GET", url, headers=self.hdr(url, {"Range": f"bytes={a + got}-{a + n - 1}"})) as r:
                    code = r.status_code
                    if code == 200:
                        raise _NoRange()
                    if code in (401, 403, 404, 410):
                        raise _Expired(f"HTTP {code}")
                    if code == 429:
                        ra = r.headers.get("retry-after", "")
                        self._sleep(min(60.0, float(ra)) if ra.isdigit() else _backoff(fails + 1))
                        raise _Transient("HTTP 429 (dibatasi server)")
                    if code != 206:
                        raise _Transient(f"HTTP {code}")
                    m = re.match(r"\s*bytes\s+(\d+)-", r.headers.get("content-range", ""))
                    if not m or int(m.group(1)) != a + got:
                        raise _Transient("server mengirim bagian yang salah")
                    for chunk in r.iter_bytes(CHUNK):
                        if self.halt.is_set():
                            return
                        if not chunk:
                            continue
                        chunk = chunk[: n - got]
                        fh.seek(a + got)
                        fh.write(chunk)
                        got += len(chunk)
                        self.add(len(chunk))
                        if got >= n:
                            break
                if got >= n:
                    fh.flush()
                    os.fsync(fh.fileno())
                    with self.lock:
                        self.done.add(idx)
                        self.save_meta()
                    return
                raise _Transient("koneksi putus di tengah bagian")
            except _NoRange:
                raise
            except _Expired as e:
                fails += 1
                if fails > self.retries:
                    raise _Fatal(f"bagian {idx + 1}: {e}") from e
                self.reresolve(gen)
            except (_Transient, httpx.TransportError, httpx.TimeoutException, httpx.StreamError) as e:
                fails = 0 if got > before else fails + 1  # masih maju = bukan gagal
                if fails > self.retries:
                    raise _Fatal(f"bagian {idx + 1} gagal {fails}× ({type(e).__name__}: {str(e)[:120]})") from e
                if fails >= 2:
                    self.reresolve(gen)  # alamat bertanda tangan mungkin sudah basi
            if fails:
                if self.halt.wait(_backoff(fails)):
                    return

    def parallel(self) -> bool:
        """True = selesai; False = server ternyata menolak Range (pakai cadangan satu koneksi)"""
        p = self.probe
        assert p is not None and p.total is not None
        ps = self.load_meta(p)
        if ps is None:
            self.done = set()
            with open(self.part, "wb") as f:
                f.truncate(p.total)
            self.save_meta()
        else:
            self.part_size = ps
            if self.done and self.log:
                self.log(f"{self.label}  melanjutkan unduhan sebelumnya ({len(self.done)} bagian sudah ada)")
        n_parts = math.ceil(p.total / self.part_size) if p.total else 0
        pending = [i for i in range(n_parts) if i not in self.done]
        self.got = sum(min(p.total, (i + 1) * self.part_size) - i * self.part_size for i in self.done)
        meter = self.meter = Meter(self.label, p.total, self.log, self.every, start=self.got)
        q: queue.Queue[int] = queue.Queue()
        for i in pending:
            q.put(i)
        threads = [threading.Thread(target=self.worker, args=(q,), daemon=True, name=f"unduh-{k}") for k in range(min(self.conns, len(pending)))]
        for t in threads:
            t.start()
        try:
            while True:
                alive = [t for t in threads if t.is_alive()]
                if not alive:
                    break
                alive[0].join(0.2)
                self._check_stop()
                meter.tick(self.got)
        except BaseException:
            self.halt.set()
            self._close_clients()
            for t in threads:
                t.join(3.0)
            with self.lock:
                self.save_meta()
            raise
        self._close_clients()
        if self.norange and not self.done:
            return False
        if self.err is not None:
            e = self.err
            if isinstance(e, DownloadCancelled):
                raise e
            raise DownloadError(str(e)) from e
        if self.norange:  # sebagian bagian sudah masuk lalu server berhenti mendukung Range → mulai ulang satu koneksi
            self.drop_partial()
            return False
        if len(self.done) < n_parts:
            raise DownloadError("unduhan berhenti sebelum selesai")
        meter.tick(self.got, force=True)
        return True

    def _close_clients(self) -> None:
        with self.lock:
            cs, self.clients = self.clients, []
        for c in cs:
            try:
                c.close()
            except Exception:
                pass

    # -------------------------------------------------------------- satu koneksi
    def single(self) -> None:
        import httpx

        fails = 0
        client = self.client()
        try:
            while True:
                self._check_stop()
                got = 0
                total = self.probe.total if self.probe else None
                meter = self.meter = Meter(self.label, total, self.log, self.every)
                try:
                    with open(self.part, "wb") as fh, client.stream("GET", self.orig, headers=self.hdr(self.orig)) as r:
                        if r.status_code in (401, 403, 404, 410):
                            raise _Fatal(f"HTTP {r.status_code}")
                        if r.status_code != 200:
                            raise _Transient(f"HTTP {r.status_code}")
                        cl = r.headers.get("content-length", "")
                        if cl.isdigit() and r.headers.get("content-encoding", "identity").lower() in ("", "identity"):
                            total = int(cl)
                            meter.total = total
                        for chunk in r.iter_bytes(CHUNK):
                            self._check_stop()
                            fh.write(chunk)
                            got += len(chunk)
                            meter.tick(got)
                        fh.flush()
                        os.fsync(fh.fileno())
                    if total is not None and got != total:
                        raise _Transient(f"hanya {got} dari {total} byte")
                    self.got = got
                    if self.probe:
                        self.probe.total = total if total is not None else got
                    meter.tick(got, force=True)
                    return
                except (_Transient, httpx.TransportError, httpx.TimeoutException, httpx.StreamError) as e:
                    fails += 1
                    if fails > self.retries:
                        raise DownloadError(f"gagal {fails}× ({type(e).__name__}: {str(e)[:120]})") from e
                    if self.log:
                        self.log(f"{self.label}  sambungan putus ({type(e).__name__}) — diulang dari awal (server tidak mendukung lanjut)")
                    self._sleep(_backoff(fails))
                except _Fatal as e:
                    raise DownloadError(str(e)) from e
        finally:
            client.close()

    # -------------------------------------------------------------- selesai
    def finalize(self) -> Path:
        real = self.part.stat().st_size
        want = self.size if self.size is not None else (self.probe.total if self.probe else None)
        if want is not None and real != want:
            self.drop_partial()
            raise ChecksumError(f"ukuran file {real} byte, seharusnya {want}")
        if self.sha:
            got = sha256_file(self.part)
            if got != self.sha:
                self.drop_partial()
                raise ChecksumError(f"sha256 tidak cocok ({got[:12]}… ≠ {self.sha[:12]}…)")
        if self.check is not None:
            why = self.check(self.part)
            if why:
                self.drop_partial()
                raise ChecksumError(why)
        os.replace(self.part, self.dest)
        for f in (self.meta, self.meta.with_name(self.meta.name + ".tmp")):
            try:
                f.unlink()
            except OSError:
                pass
        return self.dest

    def run(self) -> Path:
        c = self.client()
        try:
            try:
                self.probe = self.do_probe(c)
            except _Fatal as e:
                raise DownloadError(str(e)) from e
        finally:
            c.close()
        p = self.probe
        if self.size is not None and p.total is not None and p.total != self.size:
            raise DownloadError(f"ukuran di server {p.total} byte, seharusnya {self.size} (file lain?)")
        self.cur_url = p.url
        if p.ranges and p.total:
            if self.parallel():
                return self._done()
        if self.log and p.total != 0:
            self.log(f"{self.label}  server tidak mendukung unduh per bagian → satu koneksi (kalau putus diulang dari awal)")
        self.drop_partial()
        self.single()
        return self._done()

    def _done(self) -> Path:
        out = self.finalize()
        if self.meter is not None:
            self.meter.finish(out.stat().st_size)
        return out


def fetch(
    urls: str | Iterable[str],
    dest: str | Path,
    *,
    size: int | None = None,
    sha256: str | None = None,
    connections: int = 8,
    part_mb: float = 8,
    timeout: float = 30.0,
    retries: int = 6,
    label: str | None = None,
    log: Callable[[str], None] | None = None,
    headers: dict | None = None,
    check: Callable[[Path], str | None] | None = None,
    stall_sec: float = 30.0,
    stop: threading.Event | None = None,
    every: float = 2.0,
) -> Path:
    """
    Unduh ke `dest` (Path). URL dicoba berurutan (mirror dulu); tiap URL: paralel per bagian kalau server mendukung Range, lanjut
    dari .part.json kalau pernah terputus, cadangan satu koneksi. sha256 / ukuran / `check(path) -> alasan|None` salah → file
    dihapus & dicoba sekali lagi, lalu URL berikutnya. Sudah ada (dan lolos cek ukuran/sha) → langsung dikembalikan.
    Gagal semua → DownloadError (bagian yang sudah selesai tetap disimpan untuk dilanjutkan). Ctrl+C → KeyboardInterrupt
    (catatan bagian disimpan dulu); `stop` diset → DownloadCancelled.
    """
    lst = [urls] if isinstance(urls, str) else list(urls)
    seen: list[str] = []
    for u in lst:
        u = (u or "").strip()
        if u and u not in seen:
            seen.append(u)
    if not seen:
        raise DownloadError("tidak ada alamat unduhan")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    say = log if log is not None else _log.info
    if dest.exists():
        ok = size is None or dest.stat().st_size == size
        if ok and sha256:
            ok = sha256_file(dest) == sha256.lower()
        if ok:
            return dest
        say(f"{label or dest.name}  file lama tidak cocok → diunduh ulang")
        dest.unlink()
    errors: list[str] = []
    for i, url in enumerate(seen):
        for attempt in range(2):
            job = _Job(
                url, dest, size=size, sha256=sha256, connections=connections, part_mb=part_mb, timeout=timeout, retries=retries,
                label=label, log=say, headers=headers, check=check, stall_sec=stall_sec, stop=stop, every=every,
            )
            try:
                return job.run()
            except DownloadCancelled:
                raise
            except ChecksumError as e:
                errors.append(f"{_host(url)}: {e}")
                say(f"{job.label}  hasil unduhan tidak cocok ({e}) — {'diulang sekali' if attempt == 0 else 'coba sumber lain'}")
                continue
            except DownloadError as e:
                errors.append(f"{_host(url)}: {e}")
                if i + 1 < len(seen):
                    say(f"{job.label}  sumber {_host(url)} gagal ({str(e)[:160]}) → coba sumber berikutnya")
                break
    raise DownloadError("; ".join(errors)[:600])
