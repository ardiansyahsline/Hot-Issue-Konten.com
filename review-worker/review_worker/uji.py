"""Mode uji akurasi (pemilik: hakim-uji). KONTRAK.md §6.
Sampel keputusan LAMA seimbang approve/reject, banyak campaign & reviewer, tersebar di banyak hari; pipeline per video;
bandingkan dengan keputusan reviewer + hasil banding; simpan metrik + laporan. Bisa dilanjutkan (lanjut_run) dan diulang dengan
rubrik baru pada sampel yang sama (ulang_run)."""
from __future__ import annotations

from typing import Optional

from .skema import KandidatSampel


def pilih_sampel(kandidat: list[KandidatSampel], jumlah: int, seed: int) -> list[str]:
    """deterministik untuk seed sama. 50% approve / 50% reject (kurang → isi dari kelas lain, dicatat); maks 15% per campaign,
    maks 25% per reviewer, maks 10% per tanggal; reject tersebar per alasan sebanding frekuensinya."""
    raise NotImplementedError("stub: hakim-uji")


def jalankan_uji(rt, ctx=None, *, jumlah: Optional[int] = None, lanjut_run: Optional[str] = None,
                 ulang_run: Optional[str] = None, label: Optional[str] = None, seed: Optional[int] = None) -> str:
    """balikan run_id. Di antara video: ctx.check_cancel(), rt.selipkan(), progres "Video 37/500 · cocok 30 · cek manusia 5".
    AnggaranHabis → run status 'berhenti_biaya' + job gagal dengan pesan awam (bisa Lanjutkan besok)."""
    raise NotImplementedError("stub: hakim-uji")
