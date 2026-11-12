"""Mode uji akurasi (pemilik: hakim-uji). KONTRAK.md §6.
Sampel keputusan LAMA seimbang approve/reject, banyak campaign & reviewer, tersebar di banyak hari; pipeline per video;
bandingkan dengan keputusan reviewer + hasil banding; simpan metrik + laporan. Bisa dilanjutkan (lanjut_run) dan diulang dengan
rubrik baru pada sampel yang sama (ulang_run).

Penyimpanan run: Supabase (review_runs / review_results / review_rubrics) atau — CLI tanpa Supabase — lokal:
data/runs/<run_id>.json + data/hasil-lokal.jsonl (ditulis pipeline). Hasil yang gagal tersimpan ke Supabase (internet putus)
ikut dibaca dari hasil-lokal.jsonl, jadi metrik tetap lengkap."""
from __future__ import annotations

import json
import math
import random
import re
import time
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import log as rlog
from .jobctx import Berhenti, Cancelled, JobError
from .skema import KandidatSampel

log = rlog.get("uji")
WIB = timezone(timedelta(hours=7))
BATAS = {"campaign": 0.15, "reviewer": 0.25, "tanggal": 0.10}  # porsi maksimal dari ukuran sampel
LONGGAR = (1, 2, 4, None)  # batas dilonggarkan bertahap kalau kandidat kurang beragam (None = tanpa batas)
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
SIMPAN_TIAP = 5  # review_runs.done/cost diperbarui tiap N video (website: progres run)


# ================================================================== sampel berlapis
def _sebar_campaign(items: list[KandidatSampel], rng: random.Random) -> list[KandidatSampel]:
    """acak lalu selang-seling antar campaign (A1 B1 C1 A2 B2 …) supaya campaign tersebar"""
    grup: dict[str, list[KandidatSampel]] = defaultdict(list)
    for k in items:
        grup[k.campaign_id or "-"].append(k)
    kunci = sorted(grup)
    rng.shuffle(kunci)
    for k in kunci:
        rng.shuffle(grup[k])
    out: list[KandidatSampel] = []
    for i in range(max((len(v) for v in grup.values()), default=0)):
        out.extend(grup[k][i] for k in kunci if i < len(grup[k]))
    return out


def _kuota(jumlah_per: dict[str, int], total: int) -> dict[str, int]:
    """bagi `total` sebanding frekuensi (sisa terbesar / Hamilton), tidak melebihi isi tiap strata"""
    n = sum(jumlah_per.values())
    if n == 0 or total <= 0:
        return {k: 0 for k in jumlah_per}
    mentah = {k: total * v / n for k, v in jumlah_per.items()}
    q = {k: min(jumlah_per[k], int(math.floor(x))) for k, x in mentah.items()}
    sisa = total - sum(q.values())
    for k in sorted(jumlah_per, key=lambda k: (-(mentah[k] - math.floor(mentah[k])), k)):
        if sisa <= 0:
            break
        if q[k] < jumlah_per[k]:
            q[k] += 1
            sisa -= 1
    return q


def pilih_sampel_rinci(kandidat: list[KandidatSampel], jumlah: int, seed: int) -> tuple[list[str], dict]:
    """pilih_sampel + catatan (disimpan di review_runs.sample_params). Urutan hasil dikelompokkan per campaign (cache brief)."""
    jumlah = max(0, int(jumlah))
    rng = random.Random(int(seed))
    uniq: dict[str, KandidatSampel] = {}
    for k in kandidat:
        if k.keputusan in ("approve", "reject"):
            uniq.setdefault(str(k.video_id), k)
    semua = sorted(uniq.values(), key=lambda k: k.video_id)  # urutan masukan DB acak → diurutkan dulu supaya deterministik
    kelas = {"approve": [k for k in semua if k.keputusan == "approve"], "reject": [k for k in semua if k.keputusan == "reject"]}
    catatan: list[str] = []
    jumlah_eff = min(jumlah, len(semua))
    if jumlah_eff < jumlah:
        catatan.append(f"Kandidat hanya {len(semua)} video — sampel {jumlah_eff}, bukan {jumlah}.")
    target = {"approve": jumlah_eff // 2, "reject": jumlah_eff - jumlah_eff // 2}
    for a, b in (("approve", "reject"), ("reject", "approve")):
        if len(kelas[a]) < target[a]:
            kurang = target[a] - len(kelas[a])
            target[a] = len(kelas[a])
            target[b] = min(len(kelas[b]), target[b] + kurang)
            catatan.append(f"Video {a} hanya {len(kelas[a])} — kekurangan diisi {b} (sampel tidak seimbang).")

    # strata reject per alasan (label resmi) sebanding frekuensinya; approve satu strata
    strata: dict[str, dict[str, list[KandidatSampel]]] = {"approve": {"semua": kelas["approve"]}, "reject": defaultdict(list)}
    for k in kelas["reject"]:
        strata["reject"][(k.alasan_label or "(tanpa alasan)").strip().lower()].append(k)
    urut = {c: {s: _sebar_campaign(v, rng) for s, v in sorted(strata[c].items())} for c in strata}
    kuota = {c: _kuota({s: len(v) for s, v in urut[c].items()}, target[c]) for c in urut}
    gabung = {c: _sebar_campaign(kelas[c], rng) for c in kelas}

    dipilih: list[KandidatSampel] = []
    ambil: set[str] = set()
    hitung = {"campaign": Counter(), "reviewer": Counter(), "tanggal": Counter()}
    per_kelas: Counter = Counter()
    per_strata: Counter = Counter()
    level_pakai = 1

    def boleh(k: KandidatSampel, kali: Optional[int]) -> bool:
        if kali is None:
            return True
        for dim, porsi in BATAS.items():
            nilai = {"campaign": k.campaign_id, "reviewer": k.reviewer, "tanggal": k.tanggal}[dim]
            if nilai is None:  # tanpa data (mis. reviewer kosong) tidak dibatasi
                continue
            if hitung[dim][nilai] >= max(1, math.ceil(porsi * max(jumlah_eff, 1))) * kali:
                return False
        return True

    def pilih(k: KandidatSampel, c: str, s: Optional[str]) -> None:
        dipilih.append(k)
        ambil.add(k.video_id)
        per_kelas[c] += 1
        if s is not None:
            per_strata[(c, s)] += 1
        hitung["campaign"][k.campaign_id] += 1
        hitung["reviewer"][k.reviewer] += 1
        hitung["tanggal"][k.tanggal] += 1

    for kali in LONGGAR:
        for c in ("reject", "approve"):
            for s, daftar in urut[c].items():  # isi kuota tiap strata dulu
                for k in daftar:
                    if per_strata[(c, s)] >= kuota[c][s] or per_kelas[c] >= target[c]:
                        break
                    if k.video_id not in ambil and boleh(k, kali):
                        pilih(k, c, s)
            for k in gabung[c]:  # strata kurang → sisa kuota kelas diisi dari strata lain
                if per_kelas[c] >= target[c]:
                    break
                if k.video_id not in ambil and boleh(k, kali):
                    pilih(k, c, None)
        if all(per_kelas[c] >= target[c] for c in target):
            level_pakai = kali
            break
    else:
        level_pakai = None
    if level_pakai != 1:
        catatan.append("Kandidat kurang beragam — batas per campaign/reviewer/tanggal dilonggarkan"
                       + (f" {level_pakai}×." if level_pakai else " (tanpa batas)."))

    # urutan proses: dikelompokkan per campaign (cache brief 1 jam terpakai), di dalamnya acak tetap
    grup: dict[str, list[KandidatSampel]] = defaultdict(list)
    for k in dipilih:
        grup[k.campaign_id or "-"].append(k)
    ids: list[str] = []
    for cid in sorted(grup):
        g = sorted(grup[cid], key=lambda k: k.video_id)
        rng.shuffle(g)
        ids.extend(k.video_id for k in g)
    info = {
        "seed": int(seed), "jumlah_diminta": jumlah, "jumlah": len(ids), "n_kandidat": len(semua),
        "n_kandidat_approve": len(kelas["approve"]), "n_kandidat_reject": len(kelas["reject"]),
        "n_approve": per_kelas["approve"], "n_reject": per_kelas["reject"], "seimbang": abs(per_kelas["approve"] - per_kelas["reject"]) <= 1,
        "batas": {d: max(1, math.ceil(p * max(jumlah_eff, 1))) for d, p in BATAS.items()}, "longgar": level_pakai,
        "n_campaign": len({k.campaign_id for k in dipilih}), "n_reviewer": len({k.reviewer for k in dipilih if k.reviewer}),
        "n_tanggal": len({k.tanggal for k in dipilih}),
        "tanggal_awal": min((k.tanggal for k in dipilih), default=None), "tanggal_akhir": max((k.tanggal for k in dipilih), default=None),
        "maks_per_campaign": max(hitung["campaign"].values(), default=0), "maks_per_reviewer": max(
            (v for r, v in hitung["reviewer"].items() if r), default=0), "maks_per_tanggal": max(hitung["tanggal"].values(), default=0),
        "reject_per_alasan": dict(sorted(Counter((k.alasan_label or "(tanpa alasan)").strip().lower()
                                                 for k in dipilih if k.keputusan == "reject").items(), key=lambda kv: (-kv[1], kv[0]))),
        "catatan": catatan,
    }
    return ids, info


def pilih_sampel(kandidat: list[KandidatSampel], jumlah: int, seed: int) -> list[str]:
    """deterministik untuk seed sama. 50% approve / 50% reject (kurang → isi dari kelas lain, dicatat); maks 15% per campaign,
    maks 25% per reviewer, maks 10% per tanggal; reject tersebar per alasan sebanding frekuensinya."""
    return pilih_sampel_rinci(kandidat, jumlah, seed)[0]


def seed_bawaan() -> int:
    """angka dari tanggal WIB hari ini (mis. 20261112) — uji di hari yang sama memilih sampel yang sama"""
    return int(datetime.now(WIB).strftime("%Y%m%d"))


# ================================================================== penyimpanan run (Supabase / lokal)
def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Simpanan:
    """akses review_runs / review_results / review_rubrics; rt.supa None → file lokal di data/"""

    def __init__(self, rt):
        self.rt = rt
        self.supa = getattr(rt, "supa", None)
        self.data = Path(rt.cfg.data)

    # -------------------------------------------------------------- lokal
    def _f_run(self, run_id: str) -> Path:
        return self.data / "runs" / f"{run_id}.json"

    def _tulis_lokal(self, row: dict) -> None:
        f = self._f_run(str(row["id"]))
        f.parent.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".part")
        tmp.write_text(json.dumps(row, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        tmp.replace(f)

    def _hasil_lokal(self, run_id: str) -> list[dict]:
        f = self.data / "hasil-lokal.jsonl"
        out: dict[str, dict] = {}
        if not f.is_file():
            return []
        try:
            with open(f, encoding="utf-8") as fh:
                for baris in fh:
                    try:
                        r = json.loads(baris)
                    except ValueError:
                        continue
                    if isinstance(r, dict) and r.get("scope") == f"run:{run_id}" and r.get("video_id") is not None:
                        r.pop("disimpan", None)
                        out[str(r["video_id"])] = r
        except OSError as e:
            log.warning("hasil-lokal.jsonl tidak terbaca: %s", e)
        return list(out.values())

    # -------------------------------------------------------------- umum
    def buat_run(self, row: dict) -> dict:
        row = {"status": "proses", "done": 0, "metrics": {}, "cost_usd": 0, "started_at": _now(), **row}
        if self.supa is None:
            row.setdefault("id", str(uuid.uuid4()))
            row.setdefault("created_at", _now())
            self._tulis_lokal(row)
            return row
        got = self.supa.insert("review_runs", row)
        return got[0] if got else row

    def ambil_run(self, run_id: str) -> Optional[dict]:
        if self.supa is None:
            f = self._f_run(run_id)
            try:
                return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None
            except (OSError, ValueError):
                return None
        rows = self.supa.select("review_runs", select="*", id=f"eq.{run_id}")
        return rows[0] if rows else None

    def ubah_run(self, run_id: str, patch: dict) -> None:
        patch = {**patch, "updated_at": _now()}
        if self.supa is None:
            row = self.ambil_run(run_id) or {"id": run_id}
            row.update(patch)
            self._tulis_lokal(row)
            return
        self.supa.update("review_runs", {"id": f"eq.{run_id}"}, patch)

    def hasil_run(self, run_id: str) -> list[dict]:
        """semua review_results run ini (Supabase dipecah per 500 + cadangan lokal untuk yang belum terkirim)"""
        lokal = self._hasil_lokal(run_id)
        if self.supa is None:
            return lokal
        out: dict[str, dict] = {str(r["video_id"]): r for r in lokal}
        offset = 0
        while True:
            rows = self.supa.select("review_results", select="*", run_id=f"eq.{run_id}", order="id.asc", limit=str(500),
                                    offset=str(offset))
            for r in rows:
                out[str(r["video_id"])] = r  # baris Supabase (punya id) menang atas cadangan lokal
            if len(rows) < 500:
                break
            offset += 500
        return list(out.values())

    def simpan_rubrik(self, rubrik) -> None:
        if rubrik is None:
            return
        row = {"version": rubrik.versi, "hash": rubrik.hash, "content": rubrik.teks, "notes": rubrik.catatan or None}
        if self.supa is None:
            return
        try:
            self.supa.insert("review_rubrics", row, on_conflict="version", merge=True)
        except Exception as e:  # tabel belum ada / putus: run tetap jalan, versi & hash tetap tercatat di run
            log.warning("Rubrik %s belum tersimpan di Supabase (%s).", rubrik.versi, str(e)[:120])


# ================================================================== jalannya uji
def _anggaran_habis():
    try:
        from .biaya import AnggaranHabis

        return AnggaranHabis
    except Exception:  # pragma: no cover
        class _Tak(Exception):
            pass

        return _Tak


def _pesan_biaya(cfg) -> str:
    return f"Batas biaya harian ${float(getattr(cfg, 'daily_budget_usd', 2)):g} tercapai — klik Lanjutkan besok."


def _rubrik_aktif(rt):
    """rubrik yang dipakai hakim (rt.siapkan_hakim membuat hakim + rubrik secara malas)"""
    if getattr(rt, "rubrik", None) is None or getattr(rt, "hakim", None) is None:
        rt.siapkan_hakim()
    return rt.rubrik or getattr(rt.hakim, "rubrik", None)


def _rentang(rt) -> tuple[str, str]:
    """rentang tanggal sampel untuk dicatat (sama dengan bawaan replika: 120 hari lalu … 2 hari lalu)"""
    cfg = rt.cfg
    dari, sampai = getattr(getattr(rt, "replika", None), "rentang", (None, None)) or (None, None)
    hari = datetime.now(WIB).date()
    return (dari or (hari - timedelta(days=int(getattr(cfg, "sample_hari", 120)))).isoformat(),
            sampai or (hari - timedelta(days=int(getattr(cfg, "sample_jeda_hari", 2)))).isoformat())


def _lapor(ctx, p: float, msg: str, **kw) -> None:
    if ctx is not None:
        ctx.progress(p, msg, **kw)
    else:
        log.info(msg)


def _pesan(i: int, total: int, st: Counter) -> str:
    return f"Video {i}/{total} · cocok {st['cocok']} · beda {st['beda']} · cek manusia {st['cek']}" + (
        f" · tidak bisa diakses {st['akses']}" if st["akses"] else "")


def _hitung(st: Counter, r: dict) -> None:
    if r.get("pipeline_status") == "tidak_bisa_diakses":
        st["akses"] += 1
    elif r.get("pipeline_status") != "ok":
        st["gagal"] += 1
    elif r.get("match") is True:
        st["cocok"] += 1
    elif r.get("match") is False:
        st["beda"] += 1
    else:
        st["cek"] += 1


def tutup_run(rt, simp: Simpanan, run: dict, status: str, laporan: bool = True) -> dict:
    """hitung metrik dari hasil tersimpan → review_runs (status, done, metrics, cost) → laporan HTML. Balikan metrik."""
    from . import metrik

    run_id = str(run["id"])
    baris = simp.hasil_run(run_id)
    m = metrik.hitung_metrik(baris, rt.cfg, n_sampel=len(run.get("sample") or []))
    patch: dict = {"status": status, "done": len(baris), "metrics": m, "cost_usd": m["biaya"]["total_usd"]}
    if status != "proses":
        patch["finished_at"] = _now()
    simp.ubah_run(run_id, patch)
    run.update(patch)
    if laporan:
        try:
            from .laporan import simpan_laporan

            simpan_laporan(rt, run_id, run=run, baris=baris, metrik_run=m)
        except (Cancelled, KeyboardInterrupt):
            raise
        except Exception as e:  # laporan gagal tidak menggagalkan run (bisa dibuat ulang: review laporan <run>)
            log.warning("Laporan run %s belum terbuat (%s: %s).", run_id[:8], type(e).__name__, str(e)[:150])
    return m


def jalankan_uji(rt, ctx=None, *, jumlah: Optional[int] = None, lanjut_run: Optional[str] = None,
                 ulang_run: Optional[str] = None, label: Optional[str] = None, seed: Optional[int] = None) -> str:
    """balikan run_id. Di antara video: ctx.check_cancel(), rt.selipkan(), progres "Video 37/500 · cocok 30 · cek manusia 5".
    AnggaranHabis → run status 'berhenti_biaya' + job gagal dengan pesan awam (bisa Lanjutkan besok)."""
    from . import pipeline
    from .kolom import KolomError
    from .replika import ReplikaError

    AnggaranHabis = _anggaran_habis()
    cfg = rt.cfg
    simp = Simpanan(rt)
    for v in (lanjut_run, ulang_run):
        if v is not None and not _UUID.match(str(v)):
            raise JobError("Nomor run uji tidak valid.")
    if not getattr(cfg, "anthropic_key_ada", True) and getattr(rt, "hakim", None) is None:
        raise JobError("Kunci ANTHROPIC_API_KEY belum diisi di review-worker\\.env — uji akurasi butuh AI. Isi dulu lalu coba lagi.")

    rubrik = _rubrik_aktif(rt)
    budget = getattr(rt, "budget", None)
    if budget is not None:  # batas harian sudah habis → jangan mulai (antrian menandai job gagal dengan pesan ini)
        try:
            budget.cek()
        except AnggaranHabis:
            pesan = (f"Batas biaya harian ${float(getattr(cfg, 'daily_budget_usd', 2)):g} sudah tercapai hari ini — "
                     "uji bisa dijalankan / dilanjutkan besok.")
            if ctx is not None and not getattr(ctx, "selesai", False):
                ctx.fail(pesan)
            raise AnggaranHabis(pesan) from None
        except NotImplementedError:
            pass

    worker = getattr(getattr(rt, "supa", None), "worker", None) or getattr(cfg, "worker_id", None)
    job_id = getattr(ctx, "id", None)
    pembuat = (getattr(ctx, "job", None) or {}).get("created_by") if ctx is not None else None

    # ---------------------------------------------------------------- run: baru / lanjut / ulang
    if lanjut_run:
        run = simp.ambil_run(str(lanjut_run))
        if run is None:
            raise JobError("Run uji yang mau dilanjutkan tidak ditemukan (mungkin sudah dihapus).")
        if rubrik is not None and run.get("rubric_hash") and run["rubric_hash"] != rubrik.hash:
            raise JobError(f"Rubrik sudah berubah sejak run ini dimulai ({run.get('rubric_version')} → {rubrik.versi}). "
                           "Pakai \"Ulangi dengan rubrik terbaru\" supaya hasil tidak tercampur.")
        if run.get("status") == "selesai":
            log.info("Run %s sudah selesai — metrik & laporan dihitung ulang saja.", str(run["id"])[:8])
        simp.ubah_run(str(run["id"]), {"status": "proses", "worker": worker, "finished_at": None,
                                       **({"job_id": job_id} if job_id else {})})
    else:
        if ulang_run:
            lama = simp.ambil_run(str(ulang_run))
            if lama is None:
                raise JobError("Run uji yang mau diulang tidak ditemukan (mungkin sudah dihapus).")
            sample = [str(x) for x in (lama.get("sample") or [])]
            if not sample:
                raise JobError("Run lama tidak punya daftar video — tidak bisa diulang.")
            params = {**(lama.get("sample_params") or {}), "ulang_dari": str(lama["id"])}
            label = label or f"ulang dari {str(lama['id'])[:8]}"
        else:
            if not jumlah or int(jumlah) < 1:
                raise JobError("Jumlah video uji tidak valid (pilih 50 atau 500).")
            seed = int(seed) if seed is not None else seed_bawaan()
            _lapor(ctx, 0.02, "Mengambil keputusan reviewer lama dari database Konten.com…")
            kandidat = pipeline.dengan_replika(rt, lambda: rt.replika.daftar_kandidat_sampel(),
                                               getattr(ctx, "cek_batal", None))
            sample, params = pilih_sampel_rinci(kandidat, int(jumlah), seed)
            dari, sampai = _rentang(rt)
            params.update({"dari": dari, "sampai": sampai})
            if not sample:
                raise JobError(f"Tidak ada keputusan reviewer (approve/reject) di rentang {dari} s/d {sampai}. "
                               "Cek kolom.toml (jalankan: review kenali-skema).")
            for c in params.get("catatan", []):
                log.info("Sampel: %s", c)
        run = simp.buat_run({
            "job_id": job_id, "label": (label or (f"uji {len(sample)} video" if not ulang_run else None))[:120],
            "rubric_version": getattr(rubrik, "versi", None), "rubric_hash": getattr(rubrik, "hash", None),
            "model": getattr(cfg, "model", None), "effort": getattr(cfg, "effort", None), "sample_size": len(sample),
            "sample_params": params, "sample": sample, "worker": worker, "created_by": pembuat,
        })
        simp.simpan_rubrik(rubrik)
    run_id = str(run["id"])
    if ctx is not None and getattr(rt, "supa", None) is not None and job_id:
        try:  # langsung (tidak menunggu pengirim progres) supaya website bisa menautkan job → run sejak awal
            rt.supa.update("review_jobs", {"id": f"eq.{job_id}"}, {"run_id": run_id})
        except Exception as e:
            log.debug("run_id job belum terkirim: %s", e)
    sample = [str(x) for x in (run.get("sample") or [])]
    total = len(sample)

    # ---------------------------------------------------------------- video yang belum punya hasil
    sudah = simp.hasil_run(run_id)
    selesai = {str(r["video_id"]) for r in sudah if r.get("pipeline_status") != "dilewati_biaya"}
    todo = [v for v in sample if v not in selesai]
    st: Counter = Counter()
    for r in sudah:
        if str(r["video_id"]) in selesai:
            _hitung(st, r)
    n_done = total - len(todo)
    _lapor(ctx, 0.03 + 0.95 * n_done / max(total, 1), (_pesan(n_done, total, st) if n_done else f"Mulai uji {total} video…"),
           done=n_done, total=total, run_id=run_id)
    log.info("Run %s: %d video (%d sudah, %d sisa) · rubrik %s · model %s · effort %s", run_id[:8], total, n_done, len(todo),
             run.get("rubric_version"), run.get("model"), run.get("effort"))

    durasi: list[float] = []
    biaya_run = sum(float(r.get("cost_usd") or 0) for r in sudah)
    stop = getattr(rt, "stop", None)
    try:
        for vid in todo:
            if ctx is not None:
                ctx.check_cancel()
            elif stop is not None and stop.is_set():
                raise Berhenti("laptop diminta berhenti")
            t0 = time.monotonic()
            hasil = pipeline.proses_video(rt, vid, scope=f"run:{run_id}", run_id=run_id,
                                          cek_batal=getattr(ctx, "cek_batal", None))
            durasi.append(time.monotonic() - t0)
            row = hasil.baris_supabase()
            _hitung(st, row)
            biaya_run += float(row.get("cost_usd") or 0)
            n_done += 1
            if ctx is not None:
                rata = sorted(durasi)[len(durasi) // 2]
                ctx.eta(rata * (total - n_done))
            _lapor(ctx, 0.03 + 0.95 * n_done / max(total, 1), _pesan(n_done, total, st), done=n_done, total=total)
            if n_done % SIMPAN_TIAP == 0 or n_done == total:
                try:
                    simp.ubah_run(run_id, {"done": n_done, "cost_usd": round(biaya_run, 6)})
                except Exception as e:  # progres run gagal terkirim: uji tetap jalan
                    log.warning("Progres run belum terkirim (%s).", str(e)[:120])
            selip = getattr(rt, "selipkan", None)  # hanya mode antrian (CLI tidak mengambil pekerjaan website)
            if ctx is not None and callable(selip) and n_done < total:
                selip()
    except AnggaranHabis as e:
        log.warning("Run %s berhenti: batas biaya harian (%s).", run_id[:8], e)
        _tutup_aman(rt, simp, run, "berhenti_biaya")
        if ctx is not None and not getattr(ctx, "selesai", False):
            ctx.fail(_pesan_biaya(cfg))
        raise
    except Cancelled:
        log.info("Run %s dibatalkan dari website.", run_id[:8])
        _tutup_aman(rt, simp, run, "batal")
        raise
    except KeyboardInterrupt:  # termasuk Berhenti: job dikembalikan ke antrian (lanjut_run) oleh antrian / CLI --lanjut
        _tutup_aman(rt, simp, run, "proses", laporan=False)
        raise
    except (KolomError, ReplikaError, JobError) as e:
        log.warning("Run %s gagal: %s", run_id[:8], e)
        _tutup_aman(rt, simp, run, "gagal")
        raise
    except Exception:
        log.exception("Run %s error tak terduga.", run_id[:8])
        _tutup_aman(rt, simp, run, "gagal")
        raise

    _lapor(ctx, 0.985, "Menghitung akurasi & membuat laporan…", done=n_done, total=total)
    m = tutup_run(rt, simp, run, "selesai")
    pesan = (f"Uji selesai: {m['n_diproses']} video · setuju dengan hasil akhir "
             f"{_fmt(m['setuju_akhir']['persen'])} · cek manusia {_fmt(m['persen_cek_manusia'])}. Buka Ringkasan.")
    if ctx is not None and not getattr(ctx, "selesai", False):
        ctx.done(pesan, done=n_done, total=total, run_id=run_id)
    else:
        log.info(pesan)
    return run_id


def _fmt(p: Optional[float]) -> str:
    return "-" if p is None else f"{p:.1f}%".replace(".", ",")


def _tutup_aman(rt, simp: Simpanan, run: dict, status: str, laporan: bool = True) -> None:
    """tutup run saat berhenti di tengah — error di sini tidak boleh menutupi error aslinya"""
    try:
        tutup_run(rt, simp, run, status, laporan=laporan)
    except Exception as e:
        log.warning("Status run %s belum tersimpan (%s).", str(run.get("id"))[:8], str(e)[:150])
        try:
            simp.ubah_run(str(run["id"]), {"status": status} if status == "proses" else {"status": status, "finished_at": _now()})
        except Exception:
            pass
