<!-- Dokumen konsolidasi. Untuk file terpisah, gunakan paket ZIP tiga lapisan. -->

<!-- BEGIN README.md -->

# PRD — Network Registry

| Metadata | Nilai |
|---|---|
| Product | Network Registry |
| Slug | `network-registry` |
| PRD ID | `PRD-{NNN}`; agent menetapkan nomor berdasarkan repository |
| Versi dokumen | 1.0 |
| Tanggal | 28 September 2026 |
| Status | Draft siap ditinjau dan diimplementasikan; bukan bukti kompatibilitas deployment |
| Backend | Bun + ElysiaJS, mengikuti versi dan pola project |
| Frontend | Angular, mengikuti versi dan design system project |
| Database | PostgreSQL |
| Implementasi provider pertama | UniFi |
| Provider berikutnya | Cisco Meraki, MikroTik, Fortinet; backlog, bukan implementasi V1 |

## Ringkasan

Network Registry adalah modul untuk mengelola koneksi ke provider jaringan, menghubungkan site provider ke kantor/cabang internal, mengumpulkan observasi alamat jaringan, menyimpan riwayat IP, dan memberikan konteks jaringan kepada aplikasi lain.

Arsitektur mendukung banyak provider sejak V1, tetapi hanya adapter UniFi yang wajib diimplementasikan. Pengumpulan utama melalui polling API resmi UniFi yang telah diverifikasi. Endpoint heartbeat generik dan reference collector lokal melengkapi observasi IP keluar yang benar-benar diterima backend; keduanya bukan fitur native UniFi yang diasumsikan tersedia.

Output `matched` berarti satu kandidat kantor di registry sesuai dengan bukti IP yang masih berlaku. Output ini TIDAK membuktikan identitas perangkat, identitas orang, kehadiran fisik di kantor, ataupun hak akses. IP bersama, VPN, CGNAT, proxy, IPv6, dan perbedaan jalur keluar harus diperlakukan secara eksplisit.

## Tiga lapisan PRD

1. `01-product-requirements.md` — WHAT: tujuan, cakupan, pengguna, kebutuhan, aturan, halaman, dan non-goals.
2. `02-project-integration.md` — Integrasi: adaptasi terhadap project, kontrak adapter, model data, API, keamanan, job, dan operasional.
3. `03-acceptance-criteria.md` — Verifikasi: acceptance criteria, pengujian, bukti, dan Definition of Done.

Dokumen pendukung: `implementation-plan.md`, `traceability.md`, `unifi-compatibility.md`, dan `references.md`.

## Instruksi penyimpanan untuk agent

Lokasi target: `docs/plan/prd/{NNN}-network-registry/`.

Periksa folder PRD yang sudah ada. Bila PRD Network Registry sudah ada, gunakan folder dan nomor tersebut; jangan membuat duplikat. Bila belum ada, pilih nomor tertinggi yang valid ditambah satu, dengan tiga digit; mulai `001` hanya bila belum ada PRD. Jangan memakai jumlah folder sebagai nomor berikutnya. Jika penomoran tiga digit sudah habis, laporkan konflik aturan penomoran.

`README.md` menjadi entry point. Perbarui PRD ID dan indeks PRD project. File yang diserahkan di sini belum disimpan ke repository pengguna dan belum mendapatkan nomor repository.

## Aturan kerja

PRD menentukan WHAT; project menentukan HOW. Baca `AGENTS.md`, aturan workspace, dokumentasi arsitektur, PRD terkait, dan implementasi relevan sebelum mengubah kode.

Urutan adaptasi: aturan project → arsitektur existing → implementasi existing → usulan implementasi di PRD ini → kode baru. Ini bukan izin mengabaikan kebutuhan produk atau keamanan. Konflik harus dicatat sebagai keputusan yang terlihat, bukan perubahan diam-diam.

Gunakan prinsip REUSE > EXTEND > CREATE. Jangan membuat auth, master cabang, job framework, logger, secret store, SDK generator, UI kit, atau message broker kedua jika kemampuan yang dibutuhkan sudah ada.

Gunakan ID requirement dan acceptance criteria secara stabil. Ketidakpastian ditulis sebagai OQ atau blocker. Jangan mengarang endpoint, field API, dukungan firmware, hasil tes, atau klaim kesiapan produksi.

## Batas verifikasi awal

Dokumentasi resmi mengonfirmasi adanya Site Manager API dan Local Application APIs. Dokumentasi lokal mengikuti versi aplikasi Network. Namun, schema field WAN/public egress dan kompatibilitas unit Dream Router pengguna belum diverifikasi terhadap perangkat nyata. Matriks pada `unifi-compatibility.md` wajib diselesaikan sebelum adapter dinyatakan siap produksi. [S01, S02]

<!-- END README.md -->

---

<!-- BEGIN 01-product-requirements.md -->

# Lapisan 1 — Product Requirements

## 1. Masalah dan tujuan

Alamat IP publik kantor dapat berubah. Backend membutuhkan registry yang menghubungkan observasi jaringan dengan kantor/cabang agar konteks jaringan dapat digunakan untuk audit login dan analisis keamanan. Implementasi tidak boleh terikat kepada satu vendor router.

Tujuan V1 adalah menjawab: kantor apa yang mungkin terkait dengan IP ini, kapan bukti terakhir diperoleh, dari sumber apa, apakah ada kandidat lain, dan bagaimana IP yang teramati berubah dari waktu ke waktu.

Network Registry bukan sistem pengenal hardware, sistem absensi, firewall, atau engine keputusan account sharing.

## 2. Pengguna dan use case

| Pengguna | Kebutuhan |
|---|---|
| Administrator platform/integrasi | Mengelola koneksi provider, kredensial, capability, dan konfigurasi pengumpulan. |
| Administrator jaringan | Memetakan site ke cabang, memeriksa WAN, IP, freshness, serta gangguan sinkronisasi. |
| Auditor/security analyst | Menelusuri riwayat IP dan alasan hasil pencocokan tanpa membaca secret. |
| Service aplikasi/auth yang berwenang | Meminta konteks jaringan berdasarkan IP yang diekstrak di trusted backend. |

Alur utama: tambah koneksi UniFi → uji kemampuan → discover site → petakan ke kantor internal → sinkronkan → lihat IP dan riwayat → gunakan resolver sebagai konteks tambahan.

Alur pelengkap: daftarkan observation source kantor → pasang reference collector pada host lokal yang dikelola → collector melakukan HTTPS heartbeat → backend mengautentikasi source dan mencatat source IP request.

## 3. Cakupan rilis

| Area | V1 | Setelah V1 |
|---|---|---|
| Arsitektur provider | Registry adapter, capabilities, multi-connection | Adapter vendor tambahan |
| UniFi | Site Manager sebagai jalur utama, inventory dan IP sesuai bukti capability | Fitur tambahan di luar kebutuhan registry |
| UniFi Local API | Opsional dan bersyarat, bila sudah diverifikasi dan jalur privat tersedia | Cakupan lokal lebih luas |
| Heartbeat | Endpoint generik, kredensial source, reference collector sederhana | Collector fleet management/attestation |
| IP | IPv4/IPv6 host address, history, freshness, ambiguous matching | Prefix delegation/CIDR dengan bukti eksplisit |
| UI | Dashboard, koneksi, mapping site, detail site, history, diagnostics, sync log | Reporting lanjutan |
| Security integration | Network context dan event perubahan | Risk scoring dan kebijakan account sharing terpisah |

Non-goals V1: mengubah konfigurasi router, reboot/provisioning, scraping login vendor, custom firmware, custom cron/SSH wajib pada UDR, fingerprint browser, inventaris detail semua client/MAC, geolocation, pemblokiran otomatis login, dan pembuatan adapter vendor yang belum diminta.

## 4. Kebutuhan fungsional

### REQ-NR-001 — Provider dan koneksi

Pisahkan provider type dari connection instance. `unifi` adalah adapter; `unifi-hq-account` adalah satu koneksi dengan konfigurasi, scope, dan secret sendiri. Satu scope dapat memiliki beberapa koneksi UniFi.

V1 hanya menampilkan UniFi sebagai provider yang dapat diaktifkan. Vendor lain boleh dicantumkan sebagai planned, bukan seolah sudah didukung. Cisco Meraki merupakan kandidat adapter spesifik; jangan menganggap seluruh produk Cisco memiliki satu API yang sama.

Koneksi memiliki nama, provider code, mode akses, scope perusahaan/tenant sesuai project, status enabled, secret reference, konfigurasi polling, status koneksi, capability report, waktu sync terakhir, dan ringkasan error tersanitasi.

Tersedia aksi create, edit, test connection, sync now, disable, dan rotate credential. Menonaktifkan koneksi menghentikan job baru dan penggunaan bukti koneksi itu untuk matching saat ini, tanpa menghapus audit/history. Pengaktifan ulang memerlukan pengambilan bukti baru sebelum current matching.

### REQ-NR-002 — Discovery dan mapping site

Discovery menampilkan site eksternal yang boleh dikelola koneksi. Site eksternal harus dipetakan secara eksplisit ke kantor/site internal yang sudah ada; kemiripan nama tidak cukup untuk automatic binding.

Satu external site hanya boleh mempunyai satu binding aktif dalam scope yang sama. Satu kantor internal boleh mempunyai beberapa external site binding yang sah, misalnya selama migrasi controller atau bila ada beberapa gateway.

Unmapped site tidak boleh dipakai untuk menyimpulkan asal kantor. Perubahan mapping berlaku ke depan, memiliki audit, dan tidak menulis ulang observasi historis. Tidak boleh memindahkan binding lintas tenant untuk melewati pembatasan akses.

### REQ-NR-003 — Gateway dan WAN

Simpan metadata gateway dan WAN yang memang tersedia: external identifier, nama, model, status yang dilaporkan, label uplink, dan hubungan ke site. Jangan mengharuskan data serial/MAC/hostname bila API tidak menyediakan.

Model mendukung lebih dari satu gateway dan lebih dari satu WAN per kantor. Gateway/WAN boleh belum diketahui pada source heartbeat site-level. Tampilkan unknown, bukan membuat gateway atau WAN fiktif.

Pisahkan status perangkat menurut provider, kesehatan integrasi, dan freshness bukti IP. Kegagalan API tidak otomatis berarti kantor offline.

### REQ-NR-004 — Observasi alamat

Setiap observasi menyertakan source, scope, site/binding yang berlaku, alamat, address family, makna alamat, waktu observasi, waktu penerimaan, kualitas waktu, serta provenance.

Makna minimum: `wan_assigned`, `egress_public`, atau `unknown`. Alamat WAN terpasang tidak otomatis sama dengan IP keluar yang dilihat server. Nilai private/shared/reserved dapat disimpan untuk diagnostik dengan klasifikasi yang benar, tetapi tidak otomatis dimasukkan sebagai public egress kandidat.

Polling API memperoleh alamat dari field response yang semantiknya diverifikasi, bukan dari IP host API UniFi atau IP server tempat worker berjalan. Heartbeat memperoleh alamat dari request yang diterima trusted ingress.

IPv4 dan IPv6 harus diparsing dan dinormalisasi. Satu observasi IPv6 router tidak boleh digeneralisasi menjadi subnet kantor; V1 melakukan exact-address matching saja. Kekurangan cakupan IPv6 ditampilkan secara eksplisit.

### REQ-NR-005 — History dan freshness

Simpan observasi sebagai evidence dan tampilkan history agregat yang mudah dibaca. Observasi berulang dengan IP yang sama memperbarui last seen pada periode pengamatan yang sama; tidak menghasilkan event perubahan IP berulang.

Perubahan A → B → A harus tetap dapat ditelusuri sebagai tiga urutan pengamatan, bukan dilebur menjadi satu record A sepanjang waktu. Jangan menetapkan unique key hanya `(site_id, ip)` pada tabel history.

Bedakan `source_observed_at`, `received_at`, `last_successful_poll_at`, `first_seen_at`, `last_seen_at`, dan `expires_at`. Mengambil ulang sample upstream yang sama tidak membuat sample tersebut lebih baru.

History menyatakan waktu teramati, bukan lease ISP atau waktu pasti perubahan. Bila IP A terlihat pukul 10:00 dan B pada 10:05, tampilkan perubahan terdeteksi 10:05 dan jendela ketidakpastian; jangan menyatakan perubahan terjadi tepat 10:05.

Bukti kedaluwarsa tidak boleh menghasilkan current match. Source yang terlambat atau dihentikan memiliki status stale/disabled; history tetap ada sesuai retention.

### REQ-NR-006 — Network resolver

Resolver menerima scope dari konteks service yang terautentikasi dan alamat dari trusted backend. Hasil harus menyertakan status, kandidat yang boleh ditampilkan, alasan, evidence reference, sumber, waktu, freshness, dan `isPhysicalPresenceVerified: false`.

| Status | Makna |
|---|---|
| `matched` | Satu kandidat site internal berdasarkan bukti yang eligible dan masih berlaku di registry. |
| `ambiguous` | Lebih dari satu site merupakan kandidat; tidak ada pemilihan site sewenang-wenang. |
| `stale` | Tidak ada bukti current yang eligible, tetapi tersedia bukti historis/kedaluwarsa yang relevan. |
| `unknown` | Tidak ada bukti eligible atau cakupan sumber belum cukup. |
| `unavailable` | Resolusi tidak dapat dilakukan karena dependensi operasional gagal; tidak disamakan dengan unknown. |

Beberapa sumber/WAN pada site yang sama dihitung sebagai satu kandidat site, sambil mempertahankan semua evidence. Kesamaan IP lintas site harus menghasilkan ambiguous. Kandidat tunggal bukan jaminan bahwa pihak lain di luar registry tidak menggunakan IP yang sama. [S05]

Resolver current tidak boleh mengakses vendor API secara sinkron. Provider outage tidak menggagalkan lookup selama bukti lokal masih eligible. Setelah TTL lewat, hasil harus berubah sesuai freshness.

Lookup historis `at` bersifat diagnostik berizin khusus; jelaskan hasil sebagai bukti yang pernah diamati, bukan kepastian lokasi pada setiap detik di antara sample.

### REQ-NR-007 — Heartbeat generik

Sediakan endpoint HTTPS yang menerima heartbeat dari reference collector/router berkemampuan HTTP yang dikonfigurasi secara sah. Kredensial source menentukan scope, kantor, dan identitas collector. Jangan mempercayai `site_id`, `company_id`, atau `ip` dari body untuk menetapkan identitas maupun source address.

Body minimum memuat event ID untuk idempotency; metadata versi collector dan waktu lokal boleh diterima sebagai metadata tidak tepercaya. Waktu penerimaan server menjadi waktu observasi source IP pada ingress.

Collector harus berjalan di kantor melalui jalur keluar yang hendak diamati. Collector pusat yang mengirim heartbeat atas nama semua kantor hanya membuktikan IP keluar pusat, sehingga tidak memenuhi kebutuhan ini.

Reference collector V1 cukup berupa proses/container kecil dengan endpoint HTTPS tetap, secret injection, scheduling, timeout, retry, idempotency, dan health log tersanitasi. Tidak perlu installer lintas OS, auto-update fleet, atau vendor agent framework baru.

Heartbeat berjalan tanpa kredensial API UniFi. Secret berbeda per installation/source, dapat dirotasi dan dicabut. Revoke credential menolak request baru dengan key tersebut; rotasi rutin tidak menulis ulang history. Bila credential diduga bocor, administrator menonaktifkan source untuk menghentikan penggunaan bukti current sambil melakukan pemeriksaan. Secret membuktikan otorisasi collector, bukan attestation perangkat atau kehadiran fisik.

### REQ-NR-008 — Sinkronisasi

Dukung scheduled sync dan manual sync, dengan pagination, timeout, bounded retry, rate-limit handling, dan penguncian agar satu connection tidak diproses ganda secara bersamaan.

Job memakai status queued/running/succeeded/partial/failed/cancelled sesuai standar project. Simpan hitungan site, gateway, WAN, observasi, perubahan, dan error. Sukses test credential bukan berarti semua capability tersedia.

Kegagalan sebagian site tidak membatalkan hasil valid site lain. Response parsial, timeout pagination, atau field yang hilang tidak boleh menghapus data existing. Pemrosesan sample yang lebih lama tidak boleh memundurkan current state.

### REQ-NR-009 — Antarmuka Angular

Lokasi menu mengikuti project, misalnya Settings → Network Registry. Semua halaman wajib mempunyai loading, empty, error, forbidden, stale, dan unsupported states yang relevan; server-side pagination/filter/sort; akses keyboard; label form; serta waktu absolut dan relatif.

| ID halaman | Tujuan dan isi wajib | Aksi/validasi penting |
|---|---|---|
| PAGE-NR-001 Dashboard | Jumlah koneksi, mapped/unmapped site, fresh/stale source, conflict IP, sync gagal, perubahan terbaru | Filter scope; kartu mengarah ke daftar terkait; jangan menamai freshness sebagai uptime kantor. |
| PAGE-NR-002 Connections | Provider/mode, nama, status, capability, mapped count, last attempt/success, error | Tambah/edit/test/sync/disable/rotate; secret masked; disable/rotate dengan konfirmasi. |
| PAGE-NR-003 Site Mapping | External site dan host, connection, internal site/cabang, status mapping | Bind/unbind/remap; tampilkan konflik; pilihan site dibatasi scope; remap tidak mengubah history. |
| PAGE-NR-004 Site Detail | Ringkasan kantor, gateway, WAN, alamat dan address role, source, freshness, history, collector | Tab Overview/Gateways-WAN/IP History/Sources; unknown data jelas; last seen tidak disamakan dengan waktu IP berganti. |
| PAGE-NR-005 IP History | IP, family, site, WAN/source, first/last seen, periode, provenance, reason | Filter rentang waktu/IP/site/source; drill-down evidence; bukan tampilan event login user. |
| PAGE-NR-006 Resolve Diagnostics | Form IP dan optional historical time; status, kandidat, reason, freshness | Validasi alamat; permission resolve; tampilkan peringatan shared egress; tidak menampilkan secret atau site di luar izin. |
| PAGE-NR-007 Sync & Audit | Daftar run, progres, partial failure, request/trace ID, tindakan admin | Detail error sanitized; retry berizin; audit mengikuti modul audit existing. |

Form connection minimal: nama, scope, provider, access mode, secret input/reference, interval. Field host/port lokal hanya tampil untuk mode yang didukung; tidak menerima URL arbitrer tanpa kebijakan endpoint.

Halaman source/collector dapat berupa tab di Site Detail, dengan create source, copy secret sekali, rotate/revoke, last heartbeat, route label, dan panduan deployment. API key UniFi tidak boleh dipajang kembali setelah disimpan.

### REQ-NR-010 — Hak akses dan keamanan

Reuse auth, authorization, company/branch scope, dan secret storage project. Pisahkan hak view, manage connections, manage mapping, execute sync, manage collector credentials, resolve diagnostics, dan read audit.

Enforcement berada di backend, bukan hanya menyembunyikan tombol Angular. Background jobs, cache, token source, observation, resolver, dan event harus mempertahankan scope yang sama.

Integrasi provider V1 hanya melakukan operasi read-only. Gunakan izin vendor paling minimum yang benar-benar tersedia; jangan mengarang dukungan key read-only pada versi yang belum diverifikasi.

### REQ-NR-011 — Audit dan observability

Audit pembuatan/perubahan/disable connection, mapping, rotasi/revokasi secret, perubahan settings, dan manual sync. Catat actor/service, waktu, scope, target, hasil, correlation ID, dan before/after yang sudah disanitasi.

Sediakan metrik keberhasilan sync, durasi, 429, auth failure, stale source, observation count, resolver latency, conflict count, dan outbox backlog. Jangan menaruh IP, secret, atau user identifier sebagai label metrik ber-cardinality tinggi.

### REQ-NR-012 — Event domain

Sediakan event perubahan yang vendor-neutral: `network_registry.ip_observed.v1`, `ip_changed.v1`, `source_stale.v1`, `source_recovered.v1`, `ip_conflict_detected.v1`, dan `sync_failed.v1` dalam namespace yang konsisten.

`ip_changed` hanya untuk stream yang semantik pergantiannya diketahui; observasi IP berbeda pada jalur tidak teridentifikasi tidak boleh secara otomatis disebut failover atau replacement WAN.

Gunakan mekanisme event/outbox project. NATS digunakan jika sudah menjadi messaging project; jangan menjadikannya prasyarat baru untuk fungsi registry inti.

### REQ-NR-013 — Integrasi konteks session

Expose application service atau internal API untuk auth/session service. Snapshot konteks dapat menyimpan resolver status, kandidat site, observed IP, evidence IDs, resolvedAt, dan resolver policy version.

Perubahan registry di masa depan tidak menulis ulang konteks audit login masa lalu. Tidak ada penambahan auto-block, bypass MFA, atau allowlist berbasis IP dari PRD ini.

### REQ-NR-014 — Konfigurasi dan retention

Default berikut adalah usulan produk, bukan batas vendor atau hasil benchmark: polling/heartbeat 300 detik; jitter ±30 detik; freshness expiry 3 kali interval sumber; request timeout 10 detik; maksimal 2 retry tambahan untuk kegagalan retryable; observasi mentah 30 hari; IP history 365 hari; sync log 90 hari. Audit mengikuti kebijakan existing project.

Semua default divalidasi terhadap batas API nyata dan deployment. Jangan mengubah retention audit existing secara diam-diam. Cleanup tidak boleh menghapus current state yang masih dibutuhkan atau merusak referensi bukti; bukti terhapus diberi metadata retention/tombstone seperlunya.

### REQ-NR-015 — UniFi compatibility gate

Implementasi wajib mencatat model perangkat yang tepat, versi UniFi OS dan Network, mode API, sumber dokumentasi, endpoint/field yang dipakai, pagination, auth, izin, freshness semantics, serta hasil tes fixture dan live.

Status compatibility: `unverified`, `supported`, `partial`, `unsupported`. Field tidak tersedia harus menghasilkan reason yang terlihat, bukan response sukses kosong.

Tanpa akses live UDR, agent tetap dapat menyelesaikan kode dan fixture tests, tetapi live compatibility tetap blocked/unverified dan tidak boleh diklaim production-ready.

## 5. Aturan bisnis lintas kebutuhan

| ID | Aturan |
|---|---|
| BR-NR-001 | IP adalah konteks egress, bukan identity perangkat/pengguna atau bukti lokasi fisik. |
| BR-NR-002 | Public IP tidak unique secara global ataupun per provider; multi-site candidate harus dipertahankan. |
| BR-NR-003 | Provider type, provider connection, observation source, dan internal site adalah konsep terpisah. |
| BR-NR-004 | Vendor-neutral business logic tidak mengimpor tipe response UniFi. |
| BR-NR-005 | Secret/token tidak boleh muncul di response, log, telemetry, fixture, atau export. |
| BR-NR-006 | Freshness sample tidak diperbarui hanya karena poll response diterima kembali. |
| BR-NR-007 | Missing/partial response bukan instruksi delete atau bukti site offline. |
| BR-NR-008 | Data lebih lama tidak menggantikan current projection yang lebih baru. |
| BR-NR-009 | Mapping/credential changes tidak menulis ulang sejarah atau mengganti scope bukti lama. |
| BR-NR-010 | Router heartbeat melalui WAN/VPN tertentu tidak mewakili seluruh jalur egress pengguna. |
| BR-NR-011 | Bukti dari beberapa sumber disimpan terpisah; disagreement tidak diselesaikan dengan last-write-wins. |
| BR-NR-012 | Prefix kantor tidak boleh diturunkan otomatis dari satu alamat IPv6 atau kemiripan alamat. |
| BR-NR-013 | Disable source/connection mengecualikan current evidence; re-enable memerlukan bukti baru. Revoke credential langsung menolak heartbeat baru dengan key itu, sedangkan rotasi rutin tidak membatalkan evidence sah. Dugaan kompromi ditangani dengan disable/quarantine source secara eksplisit. |
| BR-NR-014 | Current resolver menggunakan repository/cache internal, bukan panggilan vendor sinkron. |
| BR-NR-015 | Hasil `matched` tidak boleh menjadi keputusan authorization dari modul ini. |

## 6. Validasi

VAL-NR-001: provider code terdaftar, mode didukung, nama tidak kosong, interval positif dan tidak melanggar kebijakan operasional.

VAL-NR-002: host/port lokal harus disetujui; hanya HTTPS untuk komunikasi internet; validasi TLS aktif.

VAL-NR-003: foreign keys/binding/source harus satu scope; conflict binding ditolak atomik.

VAL-NR-004: alamat IP diparsing dengan parser yang tepercaya; port, CIDR, zone ID, dan format ambigu tidak diterima oleh endpoint host-IP V1.

VAL-NR-005: waktu harus valid; historical lookup dibatasi retention; future/skew sample diberi error atau quarantine sesuai policy.

VAL-NR-006: event ID heartbeat valid dan unik dalam source; duplicate payload/event diproses idempotent.

VAL-NR-007: secret yang hilang/tidak valid tidak boleh diganti dummy value atau ditampilkan kembali.

VAL-NR-008: filter, sorting, pagination, payload size, dan rate limit endpoint dibatasi di backend.

## 7. Target non-fungsional dan pengukuran

Baseline uji awal: 100 site dan 200 WAN/observation stream aktif, dengan satu juta observasi sintetis untuk pengujian query. Ini target pengujian, bukan janji kapasitas vendor.

Target internal resolver: p95 ≤100 ms pada 50 request/detik dalam environment benchmark yang CPU/RAM/topologinya dicatat. Ukur cache hit dan cache miss terpisah. Tidak ada vendor API dalam critical path.

Target ingestion healthy path: observasi yang diterima selesai dipersistensikan dan current projection tersedia ≤30 detik. Deteksi perubahan melalui polling tetap dipengaruhi interval, jitter, antrean, dan delay upstream; tidak ada janji real-time.

API stateless harus dapat direplikasi. Worker tidak membuat schedule duplicate lintas replica. Restart tidak kehilangan schedule terdaftar atau menghasilkan history/event duplikat.

Waktu disimpan sebagai UTC dan ditampilkan mengikuti timezone project/user; default tampilan untuk deployment ini Asia/Jakarta bila project belum mengatur.

<!-- END 01-product-requirements.md -->

---

<!-- BEGIN 02-project-integration.md -->

# Lapisan 2 — Project Integration Requirements

## INT-NR-001 — Audit project sebelum implementasi

Periksa aturan agent, workspace Bun, versi lockfile, routing Elysia, struktur Angular, auth/RBAC, master company/branch/site, schema PostgreSQL, migration/repository conventions, job scheduler, secrets, logger/OTEL, NATS/outbox, testing, OpenAPI, dan SDK generation.

Tuliskan hasil audit: kemampuan existing yang digunakan, perubahan yang diperlukan, file/modul target, risiko, migration plan, serta test command. Jangan melakukan major upgrade atau mengganti framework karena PRD ini.

Pertahankan business logic terpisah dari HTTP. Gunakan API gateway existing untuk jalur eksternal bila itu standar project. Login dan UI tidak berkomunikasi langsung dengan UniFi.

## INT-NR-002 — Batas modul

Alur utama:

    Angular administration
        → Elysia routes + auth/scope validation
        → Network Registry application services
        → domain policies + repositories
        → PostgreSQL

    Scheduler/worker
        → provider adapter factory
        → UniFi API
        → normalized observations
        → shared ingestion service

    On-site reference collector
        → trusted HTTPS ingress
        → heartbeat authentication
        → shared ingestion service

    Auth/audit consumer
        → internal network resolver
        → network context; bukan keputusan login

Domain/repository tidak mengetahui JSON spesifik UniFi. Adapter tidak menulis database atau melakukan keputusan kantor secara langsung. Ingestion dan matching memakai model kanonik yang sama untuk polling dan heartbeat.

Contoh pengelompokan, bukan struktur folder wajib:

    modules/network-registry/
      routes/ schemas/ application/ domain/ repositories/
      providers/registry.ts
      providers/unifi/
      jobs/ events/ tests/

    frontend/features/network-registry/
      pages/ components/ data-access/ models/ tests/

Bila project sudah memisahkan aplikasi service dan packages, tempatkan sesuai boundaries itu. Jangan menyalin semua struktur menjadi framework baru.

## INT-NR-003 — Kontrak provider dan capabilities

Kontrak konseptual wajib menyediakan provider descriptor/factory, probe connection, discover external sites, serta collect site snapshot. Inventory gateway, WAN addresses, public egress, IPv6, dan metadata health adalah capabilities terpisah.

Setiap capability mengandung status `supported | unsupported | unverified`, alasan, API mode, dan versi/bukti verifikasi. Capability dapat berbeda per connection/site/firmware, tidak cukup satu boolean global untuk seluruh vendor.

Operasi tidak didukung mengembalikan domain error `CAPABILITY_UNSUPPORTED`, bukan `[]` seolah data memang kosong. Nilai unknown dibedakan dari valid-empty dan dari failed.

Snapshot kanonik minimum:

    providerCode, connectionId, externalHostId?, externalSiteId,
    sourceSnapshotId?, sourceObservedAt?, fetchedAt,
    timestampQuality, completeness, capabilityReport,
    gatewayRecords[], wanRecords[], addressObservations[], issues[]

`completeness` harus dapat menyatakan cakupan per site/WAN/field, sehingga partial inventory tidak dianggap complete address snapshot. Model alamat menyimpan address role, family, evidence source, route/stream key, dan provenance. Request menggunakan timeout/cancellation dan context scope yang eksplisit.

Provider registry memilih adapter melalui provider code. Provider connection menyimpan reference konfigurasi/secret; satu adapter tidak boleh membawa mutable credentials global yang digunakan lintas tenant.

Untuk membuktikan ekstensi, buat test-only fake adapter dengan format upstream berbeda. Menambah fake adapter cukup lewat registry/config dan mapper, tanpa mengubah domain matching/history atau route bisnis. Jangan membuat implementasi kosong vendor masa depan sebagai fitur production.

## INT-NR-004 — Jalur UniFi V1

Mode utama yang ditargetkan: Site Manager API resmi untuk discovery dan informasi lintas site. Local Network API hanya digunakan sebagai capability tambahan bila benar-benar diperlukan, versi cocok, dan backend/collector memiliki akses privat yang sah. Dokumentasi lokal tersedia melalui UniFi Network → Integrations dan bergantung versi. [S01]

Agent wajib memverifikasi endpoint resmi, base URL, header auth, pagination, rate limit, timestamp, field IP, dan arti field terhadap dokumentasi serta response nyata. `GET /v1/sites` ditemukan pada dokumentasi resmi, tetapi keberadaan endpoint itu bukan bukti bahwa semua field public egress/dual-WAN tersedia pada UDR tertentu. [S02]

Gunakan API key/credential mechanism resmi yang didukung. Jangan fallback diam-diam ke session cookie scraping atau menyimpan password login UI. Cloud API credential dan local API credential tidak diasumsikan sama.

Prioritas pengumpulan: API resmi yang terverifikasi → local API terverifikasi melalui jalur privat bila tersedia → heartbeat dari source lokal untuk observasi egress. Jika kebutuhan data tidak tercakup, status partial harus terlihat; jangan mengisi public IP dengan nilai WAN private agar tampak lengkap.

Custom cron/SSH pada Dream Router bukan syarat V1. Dokumentasi SSH mendeskripsikan akses troubleshooting dan memperingatkan risiko perubahan; itu bukan dokumentasi fitur native scheduled HTTPS heartbeat. [S03]

## INT-NR-005 — Model data PostgreSQL

Schema baru yang disarankan `network_registry`; reuse schema/modul existing bila sudah ada. Tabel berikut adalah model logis yang boleh dipetakan ke struktur project tanpa menduplikasi master data.

| Entitas | Kolom dan tanggung jawab minimum |
|---|---|
| `provider_connections` | id, scope, provider_code, name, access_mode, config_non_secret, credential_ref, enabled, interval, capability_report, last_attempt_at, last_success_at, status |
| `site_profiles` bila perlu | id, scope, reference kantor/cabang existing, enabled, settings; bukan master cabang kedua |
| `external_site_bindings` | id, scope, connection_id, external_host_id, external_site_id, external_name, internal_site_id nullable, effective_from/to, mapping status |
| `gateways` | id, scope, binding_id, external_device_id, name/model nullable, reported_status, last_observed_at |
| `wan_interfaces` | id, scope, gateway_id, external_wan_key, name, reported_status, route metadata non-secret |
| `observation_sources` | id, scope, site/binding, source_type `provider_api`/`heartbeat`, connection nullable, gateway/WAN nullable, stable stream key, expected interval, freshness policy, enabled, routing assertion |
| `heartbeat_credentials` atau existing machine credentials | id, source_id, non-secret key id, token_hash, created/expiry/revoked timestamps; secret tidak disimpan plaintext |
| `ip_observations` | id, scope, source_id, immutable site/mapping reference saat ingestion, IP, family, role/classification, source_sample_id, event_id, source_observed_at, received_at, timestamp_quality, source/schema version, fingerprint, credential_id nullable untuk provenance heartbeat, sync_run_id |
| `site_ip_history` | id, scope, site_id, source/stream, IP, first/last_seen_at, expires_at, detection window, period/reason, evidence references, eligibility/status |
| `sync_runs` | id, scope, connection, trigger/actor, status, start/finish, counts, pagination/progress, sanitized error summary, correlation id |
| `outbox` dan `audit_logs` | Reuse infrastructure existing; jaminan atomik, event_id, schema_version, scope, waktu, payload sanitized |

Provider catalogue dapat berasal dari adapter registry; tidak perlu tabel mutable provider yang menyimpan kode implementasi. Secret provider menggunakan secret store existing atau ciphertext dengan key management terpisah, karena worker harus dapat menggunakannya. Hash saja tidak cukup untuk API key upstream; hash cocok untuk memverifikasi inbound heartbeat secret.

Gunakan `inet` untuk host IP dan `timestamptz` untuk waktu. Jangan pakai string IPv4-only. `cidr`/prefix adalah perluasan setelah V1, bukan prefix yang ditebak dari alamat host.

Constraint minimum: foreign key satu scope; external binding aktif unik menurut scope + connection + external host/site; external device unik pada connection/site yang benar; event/sample dedup per source. Nullable key harus ditangani secara eksplisit sesuai versi PostgreSQL project.

Index minimum: scope + normalized IP + expiry untuk current candidates; site/source + observed time untuk history; connection + run start untuk jobs. Ukur query plan terhadap fixture besar.

Jangan menetapkan unique IP global. History tidak dihapus cascade saat connection dinonaktifkan. Raw provider payload penuh tidak disimpan default; simpan subset yang diperlukan, source pointers, schema version, dan checksum. Sanitized fixtures tidak boleh memuat secret atau data pelanggan nyata.

## INT-NR-006 — Ingestion, waktu, dan perubahan IP

Urutan ingestion: autentikasi/otorisasi → validasi source scope dan payload → parsing/klasifikasi IP → tentukan evidence timestamp → dedup → insert evidence → update projection/history dengan concurrency protection → tulis domain event/outbox dalam transaksi yang sama bila memakai broker. Periksa ulang status enabled, binding version, dan credential validity saat commit agar disable/remap/revoke yang bersamaan dengan request atau job tidak terlewati.

Simpan timestamp upstream dan receipt terpisah. Bila timestamp upstream tidak ada, compatibility report harus menjelaskan apakah response merupakan current read atau cache yang tidak diketahui. Tandai `receipt_based`/`unknown`; hanya evidence dengan kebijakan freshness yang terverifikasi yang eligible untuk current matching. Jangan mengubah upstream cached data menjadi fresh hanya dengan mengganti waktu menjadi now.

Sample lama dapat disimpan untuk audit tetapi tidak boleh menimpa projection yang lebih baru. Gunakan row lock/versioning/compare-and-set sesuai repository project. Clock skew, future timestamp, dan perubahan source version mempunyai handling eksplisit dan test.

Pergantian IP hanya dapat menutup membership sebelumnya secara pasti jika source memberi authoritative complete snapshot untuk stream/alamat yang sama. Pengamatan satu IP baru melalui heartbeat tidak membuktikan IP lama tidak aktif pada jalur lain, NAT pool, atau WAN lain.

Pada stream single-egress yang telah dinyatakan dan diverifikasi operator, urutan A→B→A membentuk periode pengamatan terpisah. Pada jalur yang tidak teridentifikasi, simpan evidence setiap alamat dan kedaluwarsakan kandidat menurut TTL; tampilkan `egress_path_uncertain`, jangan menghapus kandidat lama secara sewenang-wenang.

Snapshot multi-WAN/set-address dinormalisasi per WAN/route/family. Partial snapshot tidak mencabut alamat yang tidak muncul. Perubahan timestamp saja memperpanjang pengamatan yang sah, bukan menghasilkan `ip_changed` baru.

Idempotency heartbeat menggunakan source + event_id. Retry event yang sama tidak menambah history/event. Reuse event ID dengan payload/source address berbeda ditolak sebagai conflict; collector membuat event ID baru untuk observasi baru. Retry tidak membuat receivedAt lama berubah menjadi sample baru.

## INT-NR-007 — Algoritme resolver

Normalisasikan input → ambil scope dari auth/service context → pilih evidence yang role/freshness/source/mapping-nya eligible → kelompokkan per site → hasilkan status dan reason → proyeksikan detail menurut hak akses.

Analisis ambiguity harus dilakukan pada domain matching yang diizinkan untuk service, sebelum menyembunyikan rincian cabang. Jangan mengubah hasil ambiguous menjadi matched hanya karena pengguna hanya boleh melihat satu dari beberapa kandidat. Kandidat lain dapat disamarkan tanpa membocorkan nama/ID/scope.

Tenant lain tidak boleh dilihat atau ikut diekspos pada hasil. Keterbatasan bahwa shared IP di luar scope/registry tidak terdeteksi tetap harus dinyatakan; hasil bukan global uniqueness check.

Jangan membuat confidence 0–1 atau angka persentase seolah hasil terkalibrasi. Gunakan alasan deterministik dan provenance. Konflik API vs heartbeat dipertahankan sebagai bukti terpisah; prioritas sumber tidak boleh menutupi fakta multi-egress.

Cache bersifat opsional dan menggunakan scope + IP + policy version. Cache expiry tidak melewati evidence expiry. Disable source/connection, quarantine bukti, remap, perubahan policy, dan observation baru harus menginvalisasi hasil yang terkait. Revoke credential segera memblokir ingestion baru memakai key tersebut; rotasi rutin tidak membatalkan semua bukti sah dari source. Saat current time melewati expiresAt, jangan mengembalikan matched dari cache lama.

Contoh kontrak respons, bukan klaim pengamatan nyata:

    {
      "status": "matched",
      "siteId": "site-jkt-001",
      "candidates": [{"siteId": "site-jkt-001", "evidenceIds": ["obs-123"]}],
      "basis": "registry_ip_observation",
      "reasons": ["ONE_RECENT_CANDIDATE"],
      "isPhysicalPresenceVerified": false,
      "resolvedAt": "2026-09-28T03:00:00Z",
      "policyVersion": "1"
    }

Untuk ambiguous/stale/unknown/unavailable, `siteId` tunggal harus null. Jangan menampilkan string kosong atau candidate pertama sebagai resolved office.

## INT-NR-008 — API Elysia dan OpenAPI

Gunakan prefix/versioning/error envelope existing. Contoh resource semantik:

| Method dan path relatif | Tanggung jawab |
|---|---|
| `GET /network-registry/providers` | Catalogue dan capability description, tanpa secret |
| `GET/POST /network-registry/connections` | Daftar/buat koneksi |
| `GET/PATCH /network-registry/connections/:id` | Detail/update termasuk enabled flag |
| `POST /network-registry/connections/:id/test` | Uji akses dan capabilities |
| `POST /network-registry/connections/:id/rotate-credential` | Penggantian secret secara write-only |
| `POST /network-registry/connections/:id/sync` | Enqueue job, response 202 + run ID |
| `GET /network-registry/external-sites` | Discovery hasil tersimpan, pagination |
| `PUT /network-registry/external-sites/:id/binding` | Bind/remap/unbind dengan version check |
| `GET /network-registry/sites` | Profil registry kantor internal |
| `GET /network-registry/sites/:id` | Detail gateway/WAN/current observations |
| `GET /network-registry/ip-history` | Query history terbatasi scope |
| `GET/POST /network-registry/sources` | Daftar/buat observation source |
| `PATCH /network-registry/sources/:id` | Enable/disable dan settings non-secret |
| `POST /network-registry/sources/:id/credentials` | Buat/rotate credential, secret tampil sekali |
| `DELETE /network-registry/sources/:id/credentials/:credentialId` | Revoke credential |
| `POST /network-registry/heartbeats` | Machine-auth; tidak memakai session browser |
| `POST /internal/network-registry/resolve` | Trusted service resolver; bukan endpoint bebas internet |
| `POST /network-registry/diagnostics/resolve` | Admin berizin; menerima IP input eksplisit |
| `GET /network-registry/sync-runs` dan `/:id` | Daftar/detail job |

Apabila route existing lebih cocok, gunakan route existing dengan semantik setara dan catat mapping endpoint dalam dokumentasi. UI audit memanfaatkan audit API existing.

Tentukan input/output schemas, nullability, pagination, validation, auth, permissions, operationId, dan error codes. Minimum error cases: validation, unauthenticated, forbidden, scope mismatch, mapping conflict, unsupported capability, unverified compatibility, provider auth error, rate limited, timeout, partial sync, idempotency conflict, dan dependency unavailable.

OpenAPI YAML/JSON menjadi kontrak. Angular data-access memakai SDK generator existing; jangan membuat generator kedua. Jangan membagikan kredensial vendor melalui DTO atau SDK.

## INT-NR-009 — Trusted source IP dan keamanan endpoint

Tetapkan trust boundary ingress: koneksi langsung menggunakan socket peer; deployment proxy menggunakan middleware trusted proxy yang benar. Validasi alamat immediate peer dan ikuti chain hanya melalui proxy yang dipercaya. Jangan sekadar mengambil elemen pertama `X-Forwarded-For`. Blokir akses langsung ke origin bila header tepercaya bergantung pada Cloudflare/load balancer. [S04]

Header dan IP body dari caller yang tidak dipercaya tidak boleh menetapkan alamat kantor. Inbound heartbeat credentials terikat scope/source; request tidak dapat mengganti binding melalui body. Jika client IP yang benar tidak dapat dipastikan, tandai unresolved ingress dan jangan menjadikannya egress kantor.

Secret heartbeat minimal 256-bit random, token identifier non-secret, hash untuk verification, per-source revoke, rotation, rate limit, dan constant-time comparison sesuai library project. Token dicabut tidak menghapus history. Kompromi token tetap memungkinkan pihak lain mengirim observasi palsu; beri prosedur revoke dan audit, jangan mengklaim hardware attestation.

Provider base host cloud di-allowlist; endpoint lokal ditetapkan admin berizin melalui host/port dan jalur privat yang disetujui. Jangan menerima arbitrary URL/path/protocol, redirect ke tujuan tidak disetujui, metadata service, loopback, ataupun DNS rebinding sebagai jalan keluar kebijakan. Private IP lokal yang memang diperlukan hanya diizinkan melalui explicit allowlist. TLS verification wajib; gunakan trusted private CA bila perlu, bukan global insecure TLS. [S06]

Jangan membuka management port UniFi ke internet hanya untuk memenuhi integrasi. Tidak ada shell command dari input API. Secret tidak dimasukkan ke query URL atau disimpan dalam browser storage. Credential rotation tidak merusak bukti historis.

## INT-NR-010 — Jobs, event, deployment

Reuse worker/scheduler project. Bila belum ada, pilih implementasi paling sederhana yang durable dengan PostgreSQL job state/lease atau mekanisme project yang disetujui; jangan menambah Redis/NATS hanya untuk cron.

Satu effective lease per connection/job key; manual sync bersaing melalui mekanisme yang sama dengan scheduled sync. Terapkan timeout, bounded exponential backoff+jitter, Retry-After bila tersedia, budget per connection, dan circuit/backoff state untuk outage. Rate limit vendor tidak boleh ditentukan dari tebakan.

Poll job tidak berjalan di request lifecycle atau sekali per replica HTTP. Schedule, checkpoint, cancellation, dan recovery setelah restart harus jelas. Pagination gagal menghasilkan partial run, bukan full-success lalu delete data yang belum terambil.

Event publishing menggunakan outbox atomik ketika broker dipakai. Event ID stabil, event schema versioned, delivery at-least-once dengan consumer idempotent; jangan menjanjikan exactly-once transport. Duplicate/replay tidak menggandakan notifikasi perubahan.

Pisahkan health API, readiness database, worker health, provider health, dan source freshness. Secret injection, backup/restore, retention cleanup, graceful shutdown, feature flag, dan rollback harus mengikuti deployment project.

## INT-NR-011 — Halaman dan state Angular

Reuse layout, navigation, route guard, shared tables/forms/dialogs, notification/toast, i18n, date formatting, dan accessibility patterns project. Provider API hanya dipanggil backend.

Pisahkan smart page/data-access dari presentational components. Tes state loading, empty, error, unsupported, partial, stale, dan forbidden pada halaman terkait. Jangan gunakan label hijau "kantor terverifikasi" pada hasil IP match.

Sensitive actions mempunyai konfirmasi dengan dampak yang jelas. Form secret tidak memuat kembali nilai asli saat edit. Action permission diperiksa ulang backend meskipun UI sudah membatasi. Gunakan request/run IDs untuk feedback sync asinkron; tidak perlu WebSocket baru bila polling status existing sudah cukup.

## INT-NR-012 — Open questions dan keputusan

| ID | Hal yang belum diketahui | Default/penanganan |
|---|---|---|
| OQ-NR-001 | Model Dream Router dan versi OS/Network nyata | Wajib compatibility capture sebelum live sign-off; bukan blocker menulis core/tests. |
| OQ-NR-002 | Field public egress, sampling, dual-WAN, IPv6 di API aktual | Capability probe; partial/unsupported; heartbeat bila perlu. |
| OQ-NR-003 | Master site/company/branch dan schema existing | Audit repository; reuse; jangan membuat master baru dulu. |
| OQ-NR-004 | Ingress/proxy dan jalur IP sebenarnya | Verifikasi deployment; jangan aktifkan observed-IP matching jika trust chain belum benar. |
| OQ-NR-005 | Secret store, worker, event bus yang sudah digunakan | Reuse; dokumentasikan opsi sederhana bila belum tersedia. |
| OQ-NR-006 | Ketersediaan host collector per kantor dan egress route | Deployment collector opsional per site; jangan klaim API-only mengamati source HTTP langsung. |
| OQ-NR-007 | Multi-WAN, VPN, NAT pool, CGNAT, IPv6 pengguna | Catat routing coverage; ambiguous/unknown lebih baik daripada kepastian palsu. |
| OQ-NR-008 | Retention dan batas performa yang disetujui | Gunakan default usulan untuk development; butuh keputusan sebelum produksi. |

Jika dependency belum tersedia, buat blocker dengan owner dan bukti yang dibutuhkan. Jangan meminta kredensial produksi untuk ditempelkan di chat/PRD. Jangan mengganti unknown dengan asumsi tersembunyi.

<!-- END 02-project-integration.md -->

---

<!-- BEGIN 03-acceptance-criteria.md -->

# Lapisan 3 — Acceptance Criteria dan Verifikasi

Setiap AC harus diberi status `PASS`, `FAIL`, `NOT_RUN`, atau `BLOCKED`, beserta test command, hasil, dan bukti yang dapat diperiksa. Tabel ini adalah target pengujian; semua hasil awal NOT_RUN.

## 1. Provider, mapping, dan kompatibilitas

| ID | Given / When / Then | Trace | Level |
|---|---|---|---|
| AC-NR-001 | Given aturan dan modul existing, when agent memulai, then ada audit reuse/gap, file target, dan nomor PRD yang benar tanpa folder duplikat. | INT-001 | Review |
| AC-NR-002 | Given dua koneksi UniFi berbeda, when sync berjalan, then credentials, state, scope, dan errors tidak tercampur. | REQ-001 | Integration |
| AC-NR-003 | Given fake provider dengan format upstream berbeda, when didaftarkan, then ingestion/history/resolver bekerja tanpa perubahan domain atau business routes. | REQ-001, BR-004, INT-003 | Contract |
| AC-NR-004 | Given capability WAN/public egress tidak tersedia, when collection dipanggil, then status unsupported/unverified dan reason terlihat; bukan success dengan IP dummy/array kosong menyesatkan. | REQ-015 | Contract/UI |
| AC-NR-005 | Given paginated discovery, when semua halaman diproses, then site terdiscovery tepat sekali; unbound site tidak dapat menghasilkan office match. | REQ-002, REQ-008 | Integration |
| AC-NR-006 | Given external site sudah mempunyai binding aktif, when binding konflik atau lintas scope dibuat, then transaksi ditolak; tidak ada data setengah jadi. | REQ-002, VAL-003 | Integration/security |
| AC-NR-007 | Given site diremap ke kantor lain, when observasi baru masuk, then observasi lama tetap terkait binding lama dan perubahan tercatat di audit. | REQ-002, BR-009 | Integration |
| AC-NR-008 | Given target UDR nyata, when live smoke test dijalankan, then model/versi/API/schema/timestamp/privilege tercatat dan fixture tersanitasi tersedia. Tanpa perangkat/credential, status BLOCKED, bukan PASS. | REQ-015 | Live |

## 2. IP, history, dan sumber observasi

| ID | Given / When / Then | Trace | Level |
|---|---|---|---|
| AC-NR-009 | Given sample IP A yang benar-benar baru, when IP sama diamati lagi, then last seen sah bertambah tetapi event ip_changed tidak bertambah. | REQ-004, REQ-005 | Unit/integration |
| AC-NR-010 | Given stream single-egress terverifikasi, when urutan A→B→A diterima, then tiga periode pengamatan dapat ditelusuri, evidence utuh, dan jendela perubahan tidak diklaim sebagai waktu perubahan pasti. | REQ-005, INT-006 | Integration |
| AC-NR-011 | Given receipt baru untuk sample upstream lama yang sama, when polling berulang, then freshness sample tidak diperpanjang tanpa bukti baru. | BR-006 | Unit/integration |
| AC-NR-012 | Given sample baru sudah diproyeksikan, when sample lama/clock-skew tiba kemudian, then current state tidak mundur dan sample bermasalah ditangani sesuai policy. | BR-008, VAL-005 | Unit/integration |
| AC-NR-013 | Given kantor mempunyai dua WAN aktif, when WAN1 berubah atau WAN2 tidak tersedia di partial response, then data WAN lain tidak tertimpa atau dihapus. | REQ-003, BR-007 | Contract/integration |
| AC-NR-014 | Given WAN assigned adalah private/shared address, when disimpan, then address role/classification benar dan tidak menjadi public egress match tanpa bukti egress terpisah. | REQ-004 | Unit/integration |
| AC-NR-015 | Given IPv4-mapped IPv6 dan representasi IP valid lainnya, when diparsing, then normalisasi konsisten; invalid/CIDR/zone/port ditolak sesuai kontrak. | REQ-004, VAL-004 | Unit |
| AC-NR-016 | Given hanya IPv6 router yang diketahui, when IP IPv6 client lain di subnet serupa dicari, then tidak dibuat prefix match otomatis; coverage limitation terlihat. | BR-012 | Unit/UI |
| AC-NR-017 | Given heartbeat berasal dari jalur tak teridentifikasi/NAT pool, when IP berbeda diterima, then evidence tetap tersimpan dan tidak menghapus WAN lain atau menyatakan failover pasti. | BR-010, INT-006 | Integration |
| AC-NR-018 | Given API dan heartbeat melaporkan IP berbeda, when ingested, then provenance terpisah, route uncertainty terlihat, dan tidak ada last-write-wins yang menyembunyikan bukti. | BR-011 | Integration/UI |

## 3. Resolver dan expiry

| ID | Given / When / Then | Trace | Level |
|---|---|---|---|
| AC-NR-019 | Given satu site mempunyai beberapa evidence eligible untuk IP sama, when resolve, then matched satu site dengan evidence references dan isPhysicalPresenceVerified=false. | REQ-006, BR-001 | Unit/API |
| AC-NR-020 | Given dua site mempunyai IP sama dalam scope matching, when resolve, then ambiguous, siteId null, dan tidak memilih kandidat pertama. | REQ-006, BR-002 | Unit/API |
| AC-NR-021 | Given satu registered candidate dan kemungkinan shared IP di luar registry, when UI menampilkan matched, then label tetap menyatakan kandidat berbasis IP, bukan lokasi/perangkat terverifikasi. | REQ-006 | UI/review |
| AC-NR-022 | Given TTL berakhir, when resolve memakai DB ataupun cache, then stale/unknown sesuai evidence dan tidak lagi matched. | REQ-005, INT-007 | Unit/integration |
| AC-NR-023 | Given database/resolver gagal, when consumer memanggil, then unavailable dibedakan dari unknown; integrasi tidak menciptakan aturan auto-deny/allow baru. | REQ-006, REQ-013 | Integration |
| AC-NR-024 | Given kandidat lain disamarkan oleh branch permissions, when diagnostic response dibentuk, then ambiguity tidak berubah menjadi matched dan rincian terlarang tidak bocor. | REQ-010, INT-007 | Security |
| AC-NR-025 | Given dua tenant dan IP sama, when tenant A melakukan lookup, then data/identitas tenant B tidak terekspos; cache dan query tetap terisolasi. | REQ-010 | Security |
| AC-NR-026 | Given provider API outage, when current resolver dipanggil, then tidak ada vendor HTTP call pada request path; fresh local evidence boleh digunakan hanya sampai expiry. | BR-014 | Integration |
| AC-NR-027 | Given source/connection disabled, bukti di-quarantine, atau site remapped, when resolve/cache diakses, then eligibility segera sesuai perubahan; history lama tetap ada dan re-enable butuh bukti baru. | BR-009, BR-013 | Integration |
| AC-NR-028 | Given login snapshot sudah dicatat, when registry berubah, then konteks audit login lama tidak ditulis ulang. | REQ-013 | Integration |

## 4. Heartbeat dan keamanan

| ID | Given / When / Then | Trace | Level |
|---|---|---|---|
| AC-NR-029 | Given collector kantor dan credential sah, when heartbeat diterima, then server-derived source IP dan site dari credential disimpan; bukan IP/site dari body. | REQ-007 | Integration |
| AC-NR-030 | Given forged X-Forwarded-For/Forwarded atau request langsung ke origin yang tidak tepercaya, when heartbeat/resolve-current diproses, then header palsu tidak menetapkan IP kantor. Uji direct dan trusted-proxy chain. | INT-009 | Security |
| AC-NR-031 | Given event_id sama di source sama, when retry terjadi, then satu ingestion/event logis; reuse event_id dengan isi atau source address berbeda menghasilkan conflict. | VAL-006, INT-006 | Integration |
| AC-NR-032 | Given credential dicabut/expired atau tenant/source berbeda, when heartbeat masuk termasuk race saat commit, then ditolak dan tidak menambah evidence eligible; key baru hasil rotasi tetap dapat dipakai dan history sah tidak berubah. | REQ-007, REQ-010 | Security |
| AC-NR-033 | Given secret rotation/create dan error upstream, when response/log/telemetry/fixture diperiksa, then secret upstream tidak terekspos; secret baru heartbeat tampil sekali; storage mengikuti hash/encryption yang sesuai. | BR-005, INT-005 | Security |
| AC-NR-034 | Given attacker-controlled host/redirect/metadata IP/DNS rebinding, when connection test dilakukan, then akses di luar allowlist ditolak; private endpoint sah hanya melalui konfigurasi yang disetujui dan TLS tervalidasi. | VAL-002, INT-009 | Security |
| AC-NR-035 | Given user read-only, when mencoba manage/sync/rotate/remap lewat API langsung, then forbidden meskipun UI dimanipulasi. | REQ-010 | Security/E2E |
| AC-NR-036 | Given collector dijalankan dari pusat bukan kantor, when smoke test dilakukan, then yang tercatat adalah egress pusat dan deployment tidak dinyatakan memenuhi office-source verification. | REQ-007, BR-010 | Live/deployment |

## 5. Jobs, UI, dan operasional

| ID | Given / When / Then | Trace | Level |
|---|---|---|---|
| AC-NR-037 | Given scheduled+manual sync atau beberapa worker bersamaan, when job diproses, then lease/idempotency mencegah run efektif ganda dan history/event duplikat. | REQ-008, INT-010 | Integration |
| AC-NR-038 | Given 429/Retry-After/timeout/5xx/invalid key, when adapter merespons, then retry hanya untuk error retryable, bounded backoff berjalan, dan auth error tidak di-retry tanpa batas. | REQ-008 | Contract/integration |
| AC-NR-039 | Given pagination/partial site gagal, when run selesai, then partial failure terlihat, data valid tetap diproses, dan data yang belum terbaca tidak dihapus. | BR-007 | Contract/integration |
| AC-NR-040 | Given API/worker restart dan event redelivery, when proses pulih, then job dapat dilanjutkan/diulang aman; outbox dan consumer tidak menggandakan side effect. | REQ-012, INT-010 | Integration |
| AC-NR-041 | Given semua halaman PAGE-NR-001…007, when diuji, then fungsi, scope filter, pagination, keyboard, serta loading/empty/error/unsupported/stale/forbidden states terpenuhi dan label network tidak menyesatkan. | REQ-009 | E2E/UI |
| AC-NR-042 | Given schema API berubah, when OpenAPI dan Angular SDK digenerate, then typecheck/build dan contract tests lulus; tidak ada SDK/provider secret di frontend bundle. | INT-008, INT-011 | CI |
| AC-NR-043 | Given tindakan admin dan job, when audit/telemetry diperiksa, then actor/scope/result/correlation tercatat, errors sanitized, dan metrik wajib tersedia tanpa high-cardinality secret/IP labels. | REQ-011 | Integration/review |
| AC-NR-044 | Given dataset dan workload benchmark di PRD, when pengujian dilakukan, then p95, throughput, error rate, environment, cache hit/miss, dan query plan dilaporkan jujur; target yang gagal tetap FAIL. | REQ-014, NFR | Performance |
| AC-NR-045 | Given retention cleanup/migration/rollback, when dijalankan di staging fixture, then current evidence tidak rusak, history tetap sesuai kebijakan, reference yang kedaluwarsa jelas, dan restore path diuji. | REQ-014, INT-005 | Integration/ops |
| AC-NR-046 | Given seluruh rilis V1, when implementation review dilakukan, then tidak ada router mutation, auto-block login, client fingerprinting, adapter vendor palsu, atau dependency baru tanpa keputusan. | Scope, REQ-001, REQ-013 | Review |

Singkatan Trace seperti REQ-005 berarti REQ-NR-005, dan INT-001 berarti INT-NR-001.

## 6. Fixture minimum

Fixture tersanitasi harus mencakup single site, multiple sites, pagination, missing gateway, missing public egress, unknown capability, private WAN, dual-WAN, shared IP lintas site, IPv4/IPv6, absent/old/future timestamp, API-key failure, rate limit, partial response, upstream schema change, heartbeat duplicate, dan conflicting source.

Data contoh seperti TEST-NET/documentation IP hanya digunakan dalam test environment dengan fixture policy khusus; jangan membuat validator production menerima alamat dokumentasi sebagai public egress hanya agar tes lulus.

## 7. Strategi test

Unit: normalization, classification, timestamp/freshness policy, candidate grouping, history transitions, deterministic reason codes, permission policy.

Contract: adapter fixtures, actual verified response schema, capability mapping, pagination, error normalization, fake second adapter.

Integration: PostgreSQL constraints/transactions, scopes, history, dedup, leases, cache invalidation, outbox, heartbeat trust boundary.

E2E: alur create connection → test → discover → map → sync → history → resolve, termasuk peran read-only dan error states.

Live: UDR/model dan versi nyata, source IP melalui ingress produksi-like, collector dari jaringan kantor, route coverage. Live tests tidak wajib berjalan di CI tanpa secret; tetap menjadi production gate.

## 8. Definition of Done

Kode V1 memiliki migration, rollback/roll-forward strategy, OpenAPI, generated SDK, UI, adapter UniFi, scheduler integration, heartbeat endpoint dan reference collector, docs deployment, serta test yang sesuai scope.

Setiap requirement punya trace ke kode/API/page/test dan AC. Semua mandatory AC lulus atau dinyatakan blocked secara eksplisit; blocked mandatory live/security AC berarti belum production-ready.

Code review memastikan tidak ada secret, cross-scope leak, fabricated API support, ataupun business logic vendor-specific. Seluruh typecheck/lint/unit/integration/build yang tersedia dijalankan dan hasil dicatat.

Rollout dilakukan bertahap pada site pilot yang disetujui. Onboarding API-only dan API+heartbeat diuji sesuai capability nyata. Rollback mematikan pengumpulan baru tanpa menghapus history.

Agent menyerahkan daftar file berubah, migration, test commands dan hasil aktual, capability matrix, open questions, residual risks, serta panduan menambah provider berikutnya. Jangan menyatakan tes lulus bila belum dijalankan.

<!-- END 03-acceptance-criteria.md -->

---

<!-- BEGIN implementation-plan.md -->

# Rencana Implementasi untuk Agent

## Tahap 0 — Audit dan compatibility spike

Temukan nomor/folder PRD, aturan project, dan modul yang dapat digunakan kembali. Lengkapi keputusan schema/auth/jobs/secrets/SDK. Periksa dokumentasi API UniFi versi target dan buat capability matrix. Tanpa perangkat live, tandai live status BLOCKED; jangan berhenti mengimplementasikan core yang tidak bergantung pada kredensial.

Output: repository audit, daftar reuse/gap, PRD ID, rencana file, capability report awal, dan blocker.

## Tahap 1 — Domain dan persistence

Implementasikan canonical models, provider registry, scopes, repositories, migrations, IP normalization/classification, observation ingestion, timestamp policy, history, dedup, dan current resolver. Gunakan fake adapter untuk membuktikan domain vendor-neutral.

Output: backend core yang teruji tanpa jaringan vendor.

## Tahap 2 — Adapter UniFi dan worker

Implementasikan operasi resmi yang telah diverifikasi, schema validation, credential access, discovery/mapping, inventory/WAN sesuai capability, pagination, sync runs, scheduling/lease, timeout/rate-limit/backoff, dan sanitized diagnostics.

Output: polling integration dan contract tests. Fitur unsupported harus terlihat di API.

## Tahap 3 — Heartbeat dan ingress

Implementasikan machine credential lifecycle, trusted-source-IP extraction, idempotency, source configuration, reference collector, dan deployment example. Collector berjalan pada host lokal yang dikelola, bukan mengharuskan modifikasi OS UDR.

Output: jalur observasi source IP yang diuji di direct/proxy deployments, dengan batas route coverage terdokumentasi.

## Tahap 4 — API dan Angular

Expose routes sesuai standard project, generate OpenAPI/SDK, bangun halaman yang ditentukan, wiring permissions/state, serta diagnostics. Reuse audit UI/endpoint existing.

Output: alur administrasi end-to-end dan UI tests.

## Tahap 5 — Consumer, events, dan operasional

Sediakan internal resolver consumer/session context tanpa aturan login baru. Integrasikan event/outbox bila sudah digunakan project, metrik, feature flags, cleanup retention, dan runbook.

Output: integrasi aplikasi yang terpisah dari vendor API dan tidak menghalangi login karena provider outage.

## Tahap 6 — Verifikasi dan pilot

Jalankan seluruh test yang tersedia, load test, scope/security review, rollback/recovery, lalu live UDR/office collector test bila akses tersedia. Lengkapi traceability dan compatibility report.

Output akhir wajib membedakan completed, deferred, failed, dan blocked. Jangan memperluas scope ke adapter Cisco/MikroTik/Fortinet atau engine account sharing pada tahap ini.

## Prompt penyerahan

Baca README dan tiga lapisan PRD Network Registry ini. Audit repository sebelum coding, simpan PRD pada folder bernomor berikutnya sesuai aturan, dan gunakan REUSE > EXTEND > CREATE. Implementasikan V1 secara bertahap sesuai aturan project. UniFi adalah provider produksi pertama; buktikan extensibility menggunakan test-only fake adapter, bukan implementasi vendor lain. Verifikasi endpoint/field/firmware terhadap dokumentasi dan perangkat nyata; jangan mengarang API, source IP, atau hasil test. Bila credential/perangkat belum tersedia, selesaikan core, fixtures, dan automated tests, lalu tandai live verification BLOCKED. Update traceability dan berikan file changes, migration, test results, residual risks, serta deployment instructions. Jangan berhenti hanya pada rencana bila implementasi dapat dikerjakan.

<!-- END implementation-plan.md -->

---

<!-- BEGIN traceability.md -->

# Traceability Awal

Tabel awal ini harus diperbarui agent dengan path kode, API, migration, halaman, dan test file nyata. Tidak ada implementasi atau test yang diklaim sudah selesai.

| Requirement | Komponen integrasi | AC utama | Status awal |
|---|---|---|---|
| REQ-NR-001 | Provider registry, connections, fake adapter | 002,003,046 | NOT_RUN |
| REQ-NR-002 | Discovery, binding, mapping UI | 005,006,007 | NOT_RUN |
| REQ-NR-003 | Gateway/WAN model dan detail UI | 004,013 | NOT_RUN |
| REQ-NR-004 | Observation model, normalization, provenance | 009,014,015,016,018 | NOT_RUN |
| REQ-NR-005 | History, freshness, concurrency | 009,010,011,012,017,022 | NOT_RUN |
| REQ-NR-006 | Resolver, cache, diagnostics | 019,020,021,022,023,024,025,026 | NOT_RUN |
| REQ-NR-007 | Heartbeat, credential, collector | 029,030,031,032,036 | NOT_RUN |
| REQ-NR-008 | Scheduler, sync runs, provider errors | 005,037,038,039,040 | NOT_RUN |
| REQ-NR-009 | PAGE-NR-001…007 | 041,042 | NOT_RUN |
| REQ-NR-010 | RBAC, scope, secret boundary | 024,025,027,030,032,033,034,035 | NOT_RUN |
| REQ-NR-011 | Audit dan metrik | 033,043 | NOT_RUN |
| REQ-NR-012 | Domain event/outbox | 009,010,037,040 | NOT_RUN |
| REQ-NR-013 | Session context consumer | 023,026,028,046 | NOT_RUN |
| REQ-NR-014 | Settings, retention, benchmark | 022,044,045 | NOT_RUN |
| REQ-NR-015 | UniFi compatibility gate | 004,008,038,039 | NOT_RUN |

Nomor AC pada tabel memakai prefix AC-NR-. AC-NR-001 memverifikasi audit dan konsistensi PRD secara keseluruhan.

## Template bukti implementasi

Requirement ID:
AC ID:
File implementasi:
Migration/API/page:
Test file:
Command:
Environment:
Result: PASS / FAIL / NOT_RUN / BLOCKED
Evidence:
Risiko/blocker:

<!-- END traceability.md -->

---

<!-- BEGIN unifi-compatibility.md -->

# UniFi Compatibility Report — Wajib Diisi Agent

Status awal: UNVERIFIED. Dokumen ini tidak menyatakan Dream Router tertentu sudah diuji.

## Deployment target

Model persis dan hardware identifier non-sensitive:
UniFi OS version:
UniFi Network version:
Mode: Site Manager / Local API / Hybrid:
Tanggal pengujian:
Operator:
Scope/site pilot:
Credential reference, bukan secret:
Jalur privat lokal bila dipakai:
Ingress/proxy chain heartbeat:

## Capability matrix

| Capability | Status awal | Endpoint/field/schema nyata | Timestamp/freshness | Bukti test |
|---|---|---|---|---|
| Authenticate API | Unverified | TBD | N/A | NOT_RUN |
| Discover site + pagination | Unverified | Kandidat dokumentasi GET /v1/sites; detail wajib dicek | TBD | NOT_RUN |
| Resolve host/site identity | Unverified | TBD | TBD | NOT_RUN |
| Gateway inventory | Unverified | TBD | TBD | NOT_RUN |
| WAN identification | Unverified | TBD | TBD | NOT_RUN |
| WAN assigned address | Unverified | TBD | TBD | NOT_RUN |
| Public egress address | Unverified | TBD; jangan diasumsikan sama dengan assigned WAN IP | TBD | NOT_RUN |
| Multi-WAN address coverage | Unverified | TBD | TBD | NOT_RUN |
| IPv6 host address | Unverified | TBD | TBD | NOT_RUN |
| Source sample timestamp | Unverified | TBD | Wajib bedakan cached/read-time | NOT_RUN |
| Credential privileges | Unverified | TBD, izin minimum yang memang tersedia | N/A | NOT_RUN |
| API rate limit/error behavior | Unverified | TBD | N/A | NOT_RUN |
| Direct observed egress heartbeat | Unverified | Generic local collector → ingress; bukan klaim fitur native UDR | Server receipt time | NOT_RUN |

## Evidence yang wajib dilampirkan

Sumber dokumentasi resmi dan tanggal akses; versi API yang benar-benar dipakai; response sample tersanitasi; mapper test; hasil field/type/nullability validation; contoh missing capability; metode auth yang diverifikasi; batas rate limit bila didokumentasikan; penjelasan jalur WAN/VPN dan cakupan IPv4/IPv6.

Jangan menyimpan API key, token, password, client list sensitif, atau alamat kantor lengkap dalam fixture/PRD. Gunakan synthetic replacement pada data sample yang tidak diperlukan untuk reproduksi.

## Keputusan go/no-go

CODE/TEST READINESS:
LIVE COMPATIBILITY:
SECURITY/INGRESS READINESS:
SUPPORTED CAPABILITIES:
KNOWN LIMITATIONS:
BLOCKERS:
SIGN-OFF:

Tanpa live compatibility dan ingress/security verification, status produksi tetap belum disetujui meskipun fixture tests lulus.

<!-- END unifi-compatibility.md -->

---

<!-- BEGIN references.md -->

# Sumber dan Batas Verifikasi

Tanggal peninjauan: 28 September 2026. Dokumen PRD berisi keputusan desain yang diusulkan; keputusan tersebut bukan klaim fitur bawaan vendor. Semua URL berikut adalah sumber primer/resmi yang harus ditinjau lagi oleh agent sesuai versi deployment.

| ID | Sumber | Relevansi dan batas |
|---|---|---|
| S01 | Ubiquiti — Getting Started with the Official UniFi API | Menegaskan perbedaan Site Manager API dan Local Application APIs; dokumentasi Network lokal spesifik versi melalui Integrations. Tidak membuktikan semua field IP tersedia pada unit UDR pengguna. |
| S02 | Ubiquiti Developer Portal — List Sites | Halaman resmi mendeskripsikan GET /v1/sites. Detail schema/field WAN/public egress tidak berhasil diekstrak penuh dalam peninjauan ini; wajib diverifikasi agent. |
| S03 | Ubiquiti — Connecting to UniFi with Debug Tools & SSH | SSH tersedia sebagai akses lanjutan/troubleshooting dan disertai peringatan. Bukan dokumentasi dukungan native persistent heartbeat scheduler. |
| S04 | MDN — X-Forwarded-For | Header dapat dipalsukan di luar trusted proxy boundary; penentuan IP harus mempertimbangkan peer dan chain tepercaya. |
| S05 | IETF RFC 6269 — Issues with IP Address Sharing | Menjelaskan konsekuensi shared public IP dan keterbatasan identifikasi berbasis alamat. |
| S06 | OWASP — SSRF Prevention Cheat Sheet | Dasar hardening allowlist host/IP, redirect, DNS, dan koneksi backend ke endpoint yang dikonfigurasi. |

## URL sumber

S01: `https://help.ui.com/hc/en-us/articles/30076656117655-Getting-Started-with-the-Official-UniFi-API`

S02: `https://developer.ui.com/site-manager/v1.0.0/listsites`

S03: `https://help.ui.com/hc/en-us/articles/204909374-Connecting-to-UniFi-with-Debug-Tools-SSH`

S04: `https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Forwarded-For`

S05: `https://www.rfc-editor.org/rfc/rfc6269`

S06: `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`

## Yang belum dilakukan

Tidak ada akses ke repository project, perangkat Dream Router, akun UniFi, kredensial API, atau jaringan kantor pengguna. Tidak ada endpoint authenticated yang dipanggil, pengujian live, perubahan konfigurasi router, ataupun implementasi aplikasi yang dilakukan dalam penyusunan PRD ini.

Dokumen ini tidak menetapkan versi UniFi yang pasti kompatibel, tidak menegaskan ada endpoint WAN tertentu yang belum diverifikasi, dan tidak menjanjikan cross-browser hardware identification.

<!-- END references.md -->

---
