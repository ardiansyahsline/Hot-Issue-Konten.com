// SPDX-License-Identifier: AGPL-3.0-or-later
// Pembantu kecil review-worker untuk Panako (AGPL-3.0, github.com/JorenSix/Panako) — ikut AGPL karena memanggil Panako.
// Kenapa ada: CLI Panako butuh database LMDB untuk query (peta 1 TB → tidak jalan di Windows). Pembantu ini menyimpan lagu
// referensi ke storage MEMORI dalam SATU proses (sidik jari dibaca dari cache .tdb per campaign → cepat), lalu langsung query.
// Panako sendiri TIDAK diubah. Dipakai internal di laptop, tidak didistribusikan / tidak dilayankan ke pihak luar.
// Argumen: KUNCI=NILAI (konfigurasi Panako), ref=<file audio>, query=<file audio>. Keluaran per baris (dipisah TAB):
//   SIAP\t<strategi>          SIMPAN\t<path>\t<durasi detik>          KOSONG\t<query>
//   HASIL\t<query>\t<q_mulai>\t<q_selesai>\t<ref_path>\t<ref_mulai>\t<ref_selesai>\t<skor>\t<faktor_tempo>\t<faktor_nada>\t<persen_detik>
//   GAGAL\t<pesan>
import be.panako.strategy.QueryResult;
import be.panako.strategy.QueryResultHandler;
import be.panako.strategy.Strategy;
import be.panako.util.Config;
import be.panako.util.Key;

import java.io.File;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

public class PanakoSekali {
    private static String bersih(String s) {
        return s == null ? "" : s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
    }

    public static void main(String[] args) {
        List<String> refs = new ArrayList<>();
        List<String> queries = new ArrayList<>();
        try {
            for (String a : args) {
                int i = a.indexOf('=');
                if (i <= 0) continue;
                String k = a.substring(0, i), v = a.substring(i + 1);
                if (k.equals("ref")) refs.add(new File(v).getAbsolutePath());
                else if (k.equals("query")) queries.add(new File(v).getAbsolutePath());
                else Config.set(Key.valueOf(k), v);  // kunci tak dikenal → IllegalArgumentException → GAGAL
            }
            // storage memori: tanpa LMDB (aman di Windows); cache .tdb tetap dipakai supaya sidik jari tidak dihitung ulang
            Config.set(Key.PANAKO_STORAGE, "MEM");
            Config.set(Key.OLAF_STORAGE, "MEM");
            Config.set(Key.PANAKO_CACHE_TO_FILE, "TRUE");
            Config.set(Key.OLAF_CACHE_TO_FILE, "TRUE");
            Config.set(Key.PANAKO_USE_CACHED_PRINTS, "TRUE");
            Config.set(Key.OLAF_USE_CACHED_PRINTS, "TRUE");
            Strategy s = Strategy.getInstance();
            if (s == null) throw new IllegalStateException("strategi tidak dikenal: " + Config.get(Key.STRATEGY));
            System.out.println("SIAP\t" + Config.get(Key.STRATEGY));
            for (String r : refs) {
                double d = s.store(r, new File(r).getName());
                System.out.println("SIMPAN\t" + bersih(r) + "\t" + d);
            }
            int n = Config.getInt(Key.NUMBER_OF_QUERY_RESULTS);
            for (String q : queries) {
                final String qq = q;
                s.query(q, n, new HashSet<Integer>(), new QueryResultHandler() {
                    public void handleQueryResult(QueryResult r) {
                        System.out.println(String.join("\t", "HASIL", bersih(qq), "" + r.queryStart, "" + r.queryStop,
                                bersih(r.refPath), "" + r.refStart, "" + r.refStop, "" + r.score, "" + r.timeFactor,
                                "" + r.frequencyFactor, "" + r.percentOfSecondsWithMatches));
                    }

                    public void handleEmptyResult(QueryResult r) {
                        System.out.println("KOSONG\t" + bersih(qq));
                    }
                });
            }
            System.out.flush();
            System.exit(0);
        } catch (Throwable e) {
            System.out.println("GAGAL\t" + bersih(e.toString()));
            System.out.flush();
            System.exit(3);
        }
    }
}
