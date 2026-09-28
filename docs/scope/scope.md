# Scope: Network Registry

Network Registry mengelola koneksi ke provider jaringan (V1: UniFi), memetakan site provider ke kantor, mengumpulkan observasi IP lewat polling dan heartbeat, menyimpan history, dan memberi konteks jaringan ke aplikasi lain tanpa pernah mengklaim kehadiran fisik. Scope ini dipakai untuk memantau pembangunan sembilan spec di `docs/specs/`.

**Build approach:** Tracer Bullet (satu benang tipis lewat semua lapisan dulu, lalu ditebalkan per slice).
**Workflow:** GA (sesudah `/develop`: `/check verify`, `/test`, `/check review` dengan model segar, lalu `/document`). Tingkat ketelitian default project. `/architect` tetap langkah pertama untuk fitur yang masih punya keputusan terbuka.

_Ini rekomendasi agar build tetap teratur, bukan kewajiban. Lewati yang tidak cocok. Anda yang memutuskan kapan sebuah fitur `done`._

## At a glance

| # | Feature | Phase | Status |
|---|---------|-------|--------|
| 1 | Stack dan struktur (spec 0001) | Foundation | in-progress |
| 2 | Coding standards dan tooling | Foundation | planned |
| 3 | Database, schema, migration (spec 0002) | Foundation | in-progress |
| 4 | Kontrak API dan OpenAPI (spec 0007) | Foundation | in-progress |
| 5 | Identitas dan otorisasi (spec 0003) | Slice 1 | in-progress |
| 6 | Domain, ingestion, resolver (spec 0004) | Slice 1 | in-progress |
| 7 | Frontend Angular (spec 0008) | Slice 1 | in-progress |
| 8 | Provider UniFi dan sync (spec 0005) | Slice 1 | in-progress |
| 9 | Heartbeat dan collector (spec 0006) | Slice 3 | in-progress |
| 10 | Worker jadwal dan maintenance (spec 0009) | Slice 6 | in-progress |
| 11 | Hosting dan deployment | Operasi | planned |
| 12 | Verifikasi dan pilot | Slice 7 | planned |

## Peta slice tracer

Setiap milestone di bawah diberi label slice. Slice berikutnya sebaiknya dimulai setelah semua milestone slice sebelumnya selesai.

| Slice | Isi | Fitur yang terlibat |
|---|---|---|
| T0 Fondasi | Scaffold, PostgreSQL 18, runner migration, health | 1, 2, 3, 4 |
| T1 Benang tipis | Login, tabel inti, ingestion dan resolver dengan fake provider, OpenAPI dan SDK, shell dan tiga halaman, CLI `sync:once` | 3, 4, 5, 6, 7, 8 |
| T2 UniFi | Adapter Site Manager, capability, retry, discovery | 7, 8 |
| T3 Heartbeat | Ingress, credential source, endpoint, collector | 3, 7, 9 |
| T4 Lengkapi | Halaman dan endpoint sisanya, user, kantor, audit, history | 4, 5, 6, 7, 8 |
| T5 Consumer dan operasional | Resolver internal, snapshot sesi, metrik, settings | 3, 4, 5, 6, 7 |
| T6 Worker | Jadwal, lease, freshness sweep, retensi, partisi | 3, 10 |
| T7 Verifikasi | Benchmark, compatibility gate, review keamanan, rollback, pilot | 3, 4, 7, 8, 9, 10, 11, 12 |

## Foundations

### 1. Stack dan struktur (spec 0001) · in-progress
Bun 1.4.2, Elysia 1.4.30, Angular 22.2.0 dengan `@ojiepermana/angular`, PostgreSQL 18, struktur `apps/`, `packages/`, `database/`, dan satu `package.json` root.
**Done when:** scaffold semua app bisa dijalankan (`dev:backend`, `dev:frontend`), `typecheck` dan build lulus, dan struktur folder sesuai spec 0001.
- [x] Decide the stack (spec): `/architect stack dan struktur`
- [x] Scaffold from the decision: `/develop stack dan struktur`
- [x] Smoke check it runs: `/test stack dan struktur`
Spec [0001](../specs/0001-fondasi-stack-struktur/index.md) · code in `package.json`, `tsconfig.base.json`, `apps/backend/`, `apps/frontend/`, `packages/`

### 2. Coding standards dan tooling
Catat konvensi dan tooling dari project yang sudah di scaffold, lalu pasang lint, format, dan CI.
**Done when:** root `AGENTS.md` mencerminkan stack nyata (termasuk skill `elysiajs` dan `angular-developer`, dan penolakan skill PostgreSQL, Bun, Playwright, k6), dan `lint`, `format:check`, `typecheck` berjalan bersih di CI.
- [ ] Capture conventions and tooling choices: `/audit`
- [ ] Install the tooling: `/develop tooling`
- [ ] Check it runs clean: `/test tooling`

### 3. Database, schema, migration (spec 0002) · in-progress
Empat schema, semua tabel dan index, role per aplikasi, runner migration dengan checksum dan lock, partisi evidence bulanan.
**Done when:** `db:migrate` dan `db:seed` idempotent dan aman paralel, role runtime tidak bisa DDL atau lintas domain, dan query kandidat resolver memakai index pada satu juta observasi.
- [x] Design it (spec): `/architect database schema migration`
- [ ] Build it: `/develop database schema migration`
   - [ ] T0: Compose PostgreSQL 18, provisioning role, runner migration, migration 0001 dan 0002 (AC-DB-01 sampai AC-DB-05)
   - [ ] T1: Migration 0003 sampai 0007, fungsi partisi, seed sistem, `packages/db`, test constraint dan role (AC-DB-05 sampai AC-DB-09, AC-DB-12, AC-DB-13)
   - [ ] T3 dan T5: Migration 0008 (heartbeat credentials) dan 0009 (service tokens) (AC-DB-05)
   - [ ] T6: `db:maintain` untuk partisi dan retensi (AC-DB-09, AC-DB-10)
   - [ ] T7: Fixture satu juta observasi dan bukti `EXPLAIN ANALYZE` (AC-DB-11)
- [ ] Verify it: `/check verify database schema migration`
- [ ] Test it: `/test database schema migration`
- [ ] Review it (fresh model): `/check review database schema migration`
- [ ] Document it: `/document database schema migration`
Spec [0002](../specs/0002-database-schema-migration/index.md)

### 4. Kontrak API dan OpenAPI (spec 0007) · in-progress
Semua endpoint di bawah `/api`, problem+json, cursor, rate limit, correlation id, health, metrik, OpenAPI sebagai kontrak, dan SDK Angular hasil generate.
**Done when:** `api:check` menolak route tanpa `operationId` atau permission, `openapi.json` dan SDK selalu sama dengan kode, dan viewer ditolak di semua mutasi lewat API langsung.
- [x] Design it (spec): `/architect kontrak api openapi`
- [ ] Build it: `/develop kontrak api openapi`
   - [ ] T0: `app.ts`, plugin request context, error handler, batas body, health (AC-API-01, AC-API-06, AC-API-07, AC-API-10)
   - [ ] T1: Pipeline OpenAPI dan SDK, cursor HMAC, rate limit, route benang tipis (AC-API-02 sampai AC-API-05, AC-API-09, AC-NR-035, AC-NR-042)
   - [ ] T4: Route sisanya dan contract test matriks permission (AC-NR-035, AC-API-02)
   - [ ] T5 dan T7: Resolver internal, settings, `/metrics`, gate CI SDK dan secret di bundle (AC-API-08, AC-API-09, AC-NR-042)
- [ ] Verify it: `/check verify kontrak api openapi`
- [ ] Test it: `/test kontrak api openapi`
- [ ] Review it (fresh model): `/check review kontrak api openapi`
- [ ] Document it: `/document kontrak api openapi`
Spec [0007](../specs/0007-api-openapi-kontrak/index.md)

## Slice 1: Benang tipis lintas lapisan

### 5. Identitas dan otorisasi (spec 0003) · in-progress
Login email dan password, sesi di PostgreSQL, CSRF, lockout, role dari seed, batas kantor per user, service token, dan snapshot konteks jaringan saat login.
**Done when:** admin pertama dibuat lewat CLI, login dan sesi mengikuti batas idle 30 menit dan absolut 12 jam, setiap endpoint memeriksa permission di backend, dan batas kantor tidak bisa ditembus.
- [x] Design it (spec): `/architect identitas otorisasi`
- [ ] Build it: `/develop identitas otorisasi`
   - [ ] T1: Plugin auth dan CSRF, login, logout, me, lockout, rate limit login, CLI `iam:create-admin`, audit login (AC-IAM-01 sampai AC-IAM-06, AC-IAM-10, AC-IAM-13, AC-IAM-14)
   - [ ] T4: Kelola user dan role, batas kantor di semua service, reset password, test keamanan (AC-IAM-07 sampai AC-IAM-09, AC-IAM-13, AC-IAM-15)
   - [ ] T5: Service token dan snapshot `network_context` saat login (AC-IAM-11, AC-IAM-12)
- [ ] Verify it: `/check verify identitas otorisasi`
- [ ] Test it: `/test identitas otorisasi`
- [ ] Review it (fresh model): `/check review identitas otorisasi`
- [ ] Document it: `/document identitas otorisasi`
Spec [0003](../specs/0003-iam-auth-otorisasi/index.md)

### 6. Domain, ingestion, resolver (spec 0004) · in-progress
Model kanonik vendor netral, parser IP, satu jalur ingestion untuk polling dan heartbeat, periode history, dan resolver yang jujur tanpa panggilan vendor.
**Done when:** A ke B ke A menghasilkan tiga periode, sample lama tidak memundurkan projection, IP yang sama di dua kantor menjadi `ambiguous`, TTL lewat tidak lagi `matched`, dan fake provider bekerja tanpa mengubah domain.
- [x] Design it (spec): `/architect domain ingestion resolver`
- [ ] Build it: `/develop domain ingestion resolver`
   - [ ] T1: `packages/platform`, parser IP, tipe kanonik, `ProviderRegistry`, fake provider (AC-NR-003, AC-NR-014 sampai AC-NR-016, AC-DOM-02)
   - [ ] T1: Transisi periode dan `IngestionService` dengan lock, dedup, outbox (AC-NR-009 sampai AC-NR-013, AC-NR-017, AC-NR-018, AC-DOM-03)
   - [ ] T1: `ResolverService`, audit, outbox, test arsitektur (AC-NR-019, AC-NR-020, AC-NR-022 sampai AC-NR-024, AC-NR-026, AC-DOM-01, AC-DOM-04)
   - [ ] T4 dan T5: Aksi eligibility (disable, epoch, quarantine, remap), resolve historis, settings (AC-NR-022, AC-NR-027, AC-DOM-04)
- [ ] Verify it: `/check verify domain ingestion resolver`
- [ ] Test it: `/test domain ingestion resolver`
- [ ] Review it (fresh model): `/check review domain ingestion resolver`
- [ ] Document it: `/document domain ingestion resolver`
Spec [0004](../specs/0004-domain-ingestion-resolver/index.md)

### 7. Frontend Angular (spec 0008) · in-progress
Aplikasi admin dengan `LayoutWrapperDefault` sidebar vertical, i18n `id` dan `en`, tujuh halaman PRD plus login, kantor, user, dan settings.
**Done when:** semua halaman punya state loading, empty, error, forbidden, stale, unsupported; menu mengikuti permission; secret tidak pernah tampil ulang; dan `matched` tidak pernah terbaca sebagai bukti lokasi.
- [x] Design it (spec): `/architect frontend angular`
- [ ] Build it: `/develop frontend angular`
   - [ ] T1: Scaffold, core, shell `LayoutWrapperDefault`, komponen shared, halaman login, Connections, Diagnostics (AC-FE-01 sampai AC-FE-05, AC-FE-08 sampai AC-FE-10, AC-FE-12, AC-NR-021)
   - [ ] T2 dan T3: Connections lengkap dengan polling sync, tab Sources dengan credential sekali tampil (AC-FE-05 sampai AC-FE-07, AC-FE-10)
   - [ ] T4: Dashboard, Site Mapping, Sites, Site Detail, IP History, Sync & Audit, Kantor, Users, test Vitest dan Playwright (AC-NR-041, AC-FE-02, AC-FE-08, AC-FE-10, AC-FE-11)
   - [ ] T5 dan T7: Settings, pilihan bahasa, terjemahan `en` lengkap, audit aksesibilitas (AC-FE-03, AC-FE-11, AC-FE-12)
- [ ] Verify it: `/check verify frontend angular`
- [ ] Test it: `/test frontend angular`
- [ ] Review it (fresh model): `/check review frontend angular`
- [ ] Document it: `/document frontend angular`
Spec [0008](../specs/0008-frontend-angular/index.md)

### 8. Provider UniFi dan sync (spec 0005) · in-progress
Adapter UniFi Site Manager yang hanya membaca, capability mulai `unverified`, sync run dengan lease, dan CLI `sync:once` sebelum worker ada.
**Done when:** sync parsial menyimpan data valid tanpa menghapus apa pun, retry hanya untuk error yang retryable, dua connection tidak tercampur, dan tidak ada run ganda per connection.
- [x] Design it (spec): `/architect provider unifi sync`
- [ ] Build it: `/develop provider unifi sync`
   - [ ] T1: `SyncRunner` dengan lease, CLI `sync:once`, route create connection dan sync now (AC-NR-037, AC-NR-040, AC-UNI-04, AC-UNI-05)
   - [ ] T2: Klien egress dengan allowlist, klien Site Manager, schema, mapper, capability awal (AC-UNI-02, AC-UNI-03, AC-NR-004, AC-NR-038)
   - [ ] T2: Discovery, snapshot per site, test connection, rotate, disable, contract test fixture (AC-NR-002, AC-NR-005, AC-NR-039, AC-UNI-01, AC-UNI-06, AC-UNI-07)
   - [ ] T4: Retry dan cancel run (AC-NR-037)
   - [ ] T7: Compatibility capture di Dream Router nyata, isi `docs/compatibility/unifi.md` (AC-NR-008)
- [ ] Verify it: `/check verify provider unifi sync`
- [ ] Test it: `/test provider unifi sync`
- [ ] Review it (fresh model): `/check review provider unifi sync`
- [ ] Document it: `/document provider unifi sync`
Spec [0005](../specs/0005-provider-unifi-sync/index.md)

## Slice 3: Heartbeat

### 9. Heartbeat dan collector (spec 0006) · in-progress
Endpoint heartbeat dengan credential per source, IP sumber dari trusted ingress yang dikonfigurasi eksplisit, dan reference collector di `apps/collector`.
**Done when:** kantor dan IP selalu berasal dari credential dan socket atau proxy tepercaya (bukan body atau header palsu), retry `eventId` sama idempotent, credential yang dicabut langsung ditolak, dan token tidak pernah tercatat.
- [x] Design it (spec): `/architect heartbeat collector`
- [ ] Build it: `/develop heartbeat collector`
   - [ ] T3: Modul ingress dan endpoint source serta credential (AC-NR-030, AC-NR-033, AC-HB-05)
   - [ ] T3: Endpoint heartbeat dan test race revoke saat commit (AC-NR-029, AC-NR-031, AC-NR-032, AC-HB-01, AC-HB-02)
   - [ ] T3: Collector binary dan Docker, panduan deployment (AC-HB-03, AC-HB-04, AC-NR-036)
   - [ ] T7: Uji live collector dari jaringan kantor pilot (AC-NR-036)
- [ ] Verify it: `/check verify heartbeat collector`
- [ ] Test it: `/test heartbeat collector`
- [ ] Review it (fresh model): `/check review heartbeat collector`
- [ ] Document it: `/document heartbeat collector`
Spec [0006](../specs/0006-heartbeat-collector/index.md)

## Slice 6: Worker

### 10. Worker jadwal dan maintenance (spec 0009) · in-progress
Worker di `apps/worker` yang menggantikan pekerjaan manual: jadwal sync, eksekusi antrean, freshness sweep dengan event stale dan recovered, partisi, dan retensi.
**Done when:** beberapa replica tidak membuat run ganda, worker yang mati di tengah run aman diulang, event stale dan recovered ditulis tepat sekali per perubahan, dan retensi tidak merusak periode terbuka atau audit.
- [x] Design it (spec): `/architect worker jadwal maintenance`
- [ ] Build it: `/develop worker jadwal maintenance`
   - [ ] T6: Scaffold worker, executor, lease reaper, scheduler, shutdown (AC-NR-037, AC-NR-040, AC-WK-01, AC-WK-06, AC-WK-07)
   - [ ] T6: Freshness sweep, maintenance, `evidenceRetained` di API history, metrik (AC-WK-02 sampai AC-WK-05, AC-WK-08)
   - [ ] T6 dan T7: Test multi replica, kill, retensi 14 bulan, uji rollback dan restore (AC-NR-037, AC-NR-040, AC-NR-045, AC-WK-01, AC-WK-04)
- [ ] Verify it: `/check verify worker jadwal maintenance`
- [ ] Test it: `/test worker jadwal maintenance`
- [ ] Review it (fresh model): `/check review worker jadwal maintenance`
- [ ] Document it: `/document worker jadwal maintenance`
Spec [0009](../specs/0009-worker-jadwal-maintenance/index.md)

## Operasi dan rilis

### 11. Hosting dan deployment · needs a decision
Pilih platform produksi, topologi ingress, cara menyajikan dua locale frontend, serta backup dan restore. Ini dibutuhkan sebelum heartbeat bisa dipercaya di produksi.
**Done when:** platform dan topologi ingress tercatat di spec, `NR_TRUSTED_PROXIES` dan `NR_CLIENT_IP_HEADER` terisi dan diuji terhadap deployment nyata, akses langsung ke origin ditutup bila memakai proxy, dan jalur backup serta restore terbukti.
- [ ] Design it (spec): `/architect hosting dan deployment`

### 12. Verifikasi dan pilot
Buktikan kesiapan GA sesuai Definition of Done PRD, lalu rollout bertahap ke kantor pilot.
**Done when:** benchmark resolver dilaporkan jujur (p95, throughput, cache hit dan miss, query plan), review keamanan independen selesai, compatibility report UniFi dan ingress terisi atau `BLOCKED` tercatat, traceability REQ ke AC ke test lengkap, dan pilot berjalan di kantor yang disetujui dengan rollback teruji.
- [ ] Build it: `/develop verifikasi dan pilot`

## Deferred
Di luar cakupan build saat ini, dicatat supaya rencana tetap jujur.
- **MFA TOTP untuk admin**: dari spec 0003, disarankan sebelum atau segera setelah GA · needs a decision · GA
- **UniFi Local API**: untuk kantor tanpa akun cloud, dari spec 0005 · needs a decision
- **Relay outbox**: target webhook, NATS, atau polling saat ada consumer nyata, dari spec 0009 · needs a decision
- **Login OIDC**: jika nanti ada IdP perusahaan, dari spec 0003 · needs a decision
- **Rate limit terdistribusi**: jika backend lebih dari satu replica, dari spec 0003 dan 0007 · needs a decision
- **Adapter vendor lain**: Cisco Meraki, MikroTik, Fortinet (backlog PRD) · needs a decision
- **Prefix atau CIDR IPv6 dengan bukti eksplisit**: perluasan setelah V1 (PRD REQ-NR-004) · needs a decision

## Legend

**The decision box.** Setiap fitur punya tepat satu, yaitu sub task yang labelnya diakhiri `(spec)`. Kata katanya bisa berbeda (`Design it (spec)` biasanya, `Decide the stack (spec)` di fitur stack), jadi skill mencarinya lewat akhiran `(spec)`. Box lain adalah box eksekusi.

**Feature lifecycle**:

| State | Set by | Yang terlihat di fitur |
|---|---|---|
| `planned` · needs a decision | `/scope` | satu box: `Design it (spec): /architect <feature>` |
| `in-progress` (designed) | `/architect` saat spec dibuat | `Design it` dicentang, spec ditautkan, `Build it` dengan 2 sampai 5 milestone, box penutup sesuai tier |
| `in-progress` (building) | `/develop` | milestone dicentang satu per satu, pointer kode diisi |
| `in-progress` (verified) | `/check verify` | `Build it` dan milestone dicentang, `Verify it` dicentang |
| `done` | Anda, saat Anda memutuskan; `/sync` merekonsiliasi | box yang dijalankan dicentang; untuk GA titik yang disarankan adalah setelah `/test`, lalu review dan dokumentasi |

- **Next step** = box pertama yang belum dicentang.
- **needs a decision** = jalankan `/architect` dulu.
- **Label T0 sampai T7** di milestone menunjuk slice di Peta slice tracer; tugas atomik ada di `## Build plan` setiap spec, bukan di sini.
- **Status** `planned` → `in-progress` → `done`, plus `existing` (sebelum workflow) dan `dropped` (dikeluarkan dari cakupan, tetap disimpan).
- **Workflow tier tag** di samping heading (misalnya `· GA`) mengubah tier satu fitur; tanpa tag berarti mengikuti default GA.
- **Pointer line** (`Spec <n> · code in <path>`): spec ditautkan oleh `/architect`, path kode oleh `/develop`.
