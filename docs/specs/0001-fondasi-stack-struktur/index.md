# 0001. Fondasi stack dan struktur repository Network Registry

**Date**: 2026-09-28
**Status**: Accepted

## Summary

Spec ini menetapkan stack dan struktur repository untuk Network Registry: Bun 1.4.2 sebagai runtime, Elysia 1.4.30 untuk backend, Angular 22.2.0 dengan `@ojiepermana/angular` untuk frontend, dan PostgreSQL 18 sebagai satu satunya database. Semua aplikasi ada di `apps/` (`frontend`, `backend`, `collector`, lalu `worker` di fase terakhir), kode bersama di `packages/`, dan migration di `database/`. Satu `package.json` di root mengelola semua dependency. Spec ini juga memuat peta delapan spec lapisan berikutnya dan urutan build Tracer Bullet (benang tipis lintas lapisan dulu, lalu ditebalkan).

## Decision

**Chosen option**: Option 1: Monolith berlapis di atas Bun, satu manifest root, SQL langsung, tanpa layanan infrastruktur tambahan.

Network Registry dibangun sebagai satu backend Elysia (monolith berlapis: route, application service, domain, repository), satu frontend Angular, satu worker Bun, dan satu reference collector, dengan PostgreSQL 18 sebagai penyimpanan, antrean job, outbox, dan secret store terenkripsi sekaligus.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) · `angular-developer` (`~/.claude/skills/angular-developer/`) · `angular-new-app` (`~/.claude/skills/angular-new-app/`)

## Proposed stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime dan package manager | Bun 1.4.2 (`packageManager: bun@1.4.2`) | Rilis stabil terbaru; Elysia, worker, collector, dan test backend berjalan di runtime yang sama. |
| Tooling Angular | Node.js 24 LTS (khusus Angular CLI dan build frontend) | Angular CLI berjalan di Node; Bun tetap mengelola dependency dan script. |
| Bahasa | TypeScript, versi mengikuti rentang peer Angular 22.2.0 (foundation Anda memakai 6.0.3 dengan kombinasi yang sama) | Satu bahasa di semua app; versi dikunci saat scaffold setelah cek peer. |
| Backend | Elysia 1.4.30, `@elysia/openapi` 1.4.16, validasi `t` (TypeBox bawaan Elysia) | Stabil terbaru; 2.0 masih beta. `t` memberi tipe end to end dan schema OpenAPI tanpa adapter. |
| Frontend | Angular 22.2.0 (`core`, `cli`, `build`, `cdk`, `material`, `localize`), `@ojiepermana/angular` 22.1.14, Tailwind CSS 4 sesuai kebutuhan styling library | 22.1.14 adalah rilis npm terbaru dengan peer `@angular/* >=22.1.0 <23`, jadi cocok dengan 22.2.0. |
| Layout | Default layout wrapper `LayoutWrapperDefault` dari `@ojiepermana/angular/theme/layout/wrapper` (ada di 22.1.14), `layout-type="vertical"`, `nav-type="sidebar"` (lihat spec 0008) | Keputusan Anda; header, sidebar, drawer mobile, dan skip link tidak dibuat ulang. |
| i18n | `@angular/localize`, source locale `id`, target `en` | Keputusan Anda: antarmuka dua bahasa sejak awal. |
| Database | PostgreSQL 18 (minor terbaru 18.6), client `Bun.SQL`, SQL langsung tanpa ORM | Domain butuh `inet`, partisi, partial unique index, `SKIP LOCKED`, advisory lock; SQL langsung memakai semuanya tanpa lapisan tambahan. |
| Migration | File SQL berurutan di `database/migrations/` plus runner Bun sendiri (spec 0002) | Tanpa binary tambahan; checksum dan advisory lock. |
| Auth | Session auth sendiri (spec 0003) | Keputusan Anda: argon2id lewat `Bun.password`, cookie httpOnly. |
| Background jobs | Tabel job PostgreSQL sendiri (`sync_runs` dengan lease), dieksekusi CLI `sync:once` lalu worker (spec 0005, 0009) | Durable tanpa Redis atau broker, sesuai INT-NR-010. |
| Event | Tabel `core.outbox_events`, ditulis atomik; relay ditunda | Tidak menambah broker sebelum ada consumer nyata (REQ-NR-012). |
| Secret upstream | AES-256-GCM di aplikasi (`node:crypto` di Bun), kunci dari env `NR_SECRET_KEYS` | Worker harus bisa membaca API key; tidak ada layanan vault untuk dioperasikan. |
| Parser IP | `ipaddr.js` 2.5.0 | Parser tepercaya untuk VAL-NR-004 dan klasifikasi range. |
| Observability | Logger JSON sendiri di `packages/platform`, endpoint `/metrics` format teks Prometheus | Tanpa dependency; redaksi secret dan label dengan cardinality rendah dikontrol penuh. |
| Test | `bun:test` (unit, contract, integration dengan PostgreSQL 18 nyata), Vitest lewat Angular CLI, Playwright (E2E), k6 (benchmark resolver) | Keputusan Anda; setiap level test PRD punya runner. |
| Format dan lint | Prettier; ESLint dengan `typescript-eslint` dan `angular-eslint` | Standar ekosistem Angular dan TypeScript; dicek di CI. |
| Container | Dockerfile per app (`apps/*/Dockerfile`, `database/Dockerfile`), build context root | Setiap app dideploy dan diskalakan sendiri. |
| Database development | Docker Compose root dengan image resmi `postgres:18.6`, dipin lewat digest | Aturan sendiri (bukan image foundation); image resmi paling mudah direproduksi di CI. |
| Hosting produksi | Belum diputuskan (lihat Follow-up) | Topologi ingress masih OQ-NR-004; container siap untuk platform apa pun. |

## Struktur repository

```text
network-registry/
├── package.json              # satu manifest, semua dependency dan script
├── bun.lock
├── tsconfig.base.json        # path alias @nr/* ke packages/*
├── docker-compose.yml        # PostgreSQL 18 untuk development saja
├── openapi.json              # kontrak hasil ekspor backend (spec 0007)
├── apps/
│   ├── backend/              # Elysia: route, plugin, komposisi app
│   ├── frontend/             # Angular 22.2; sdk/ hasil generate di luar src/
│   ├── collector/            # reference collector heartbeat (spec 0006)
│   └── worker/               # jadwal, lease, maintenance (spec 0009, terakhir)
├── packages/
│   ├── platform/             # config, logger, metrics, errors, clock, ids, secret box, ingress IP
│   ├── db/                   # factory Bun.SQL, helper transaksi, tipe baris
│   ├── registry-core/        # domain, application service, repository, provider registry, adapter UniFi
│   └── contracts/            # schema bersama backend dan collector (heartbeat)
├── database/
│   ├── migrate.ts            # runner migration (spec 0002)
│   ├── seed.ts
│   ├── migrations/
│   └── seeds/
├── scripts/                  # export-openapi, sync-once, iam CLI, db maintenance
├── tests/
│   ├── integration/          # bun:test lintas modul dengan PostgreSQL 18
│   ├── e2e/                  # Playwright
│   └── perf/                 # k6
└── docs/
    ├── specs/
    ├── compatibility/unifi.md
    └── deployment/
```

Aturan batas:

- `packages/*` tidak mengimpor dari `apps/*`. Backend, worker, dan skrip CLI memakai `packages/registry-core`; worker tidak mengimpor kode backend.
- Frontend hanya memakai SDK hasil generate dan tidak mengimpor `packages/*` (kecuali tipe murni tanpa runtime Bun, jika nanti diperlukan).
- Collector hanya mengimpor `packages/contracts` dan `packages/platform` bagian yang tidak butuh database.
- Tidak ada `package.json` per app. Import antar folder lewat path alias `@nr/platform`, `@nr/db`, `@nr/registry-core`, `@nr/contracts`.
- Kode vendor spesifik hanya di `packages/registry-core/src/providers/<vendor>/` (BR-NR-004).

## Konvensi lintas lapisan

| Hal | Konvensi |
|---|---|
| Waktu | Disimpan `timestamptz` UTC; tampilan default Asia/Jakarta atau timezone kantor (REQ non fungsional). |
| ID | `uuid` dari `uuidv7()` PostgreSQL 18; di aplikasi dibuat oleh database, bukan klien. |
| Enum | Kolom `text` plus `CHECK`, bukan tipe enum PostgreSQL, agar migration menambah nilai tanpa `ALTER TYPE`. |
| Error | RFC 9457 `application/problem+json` dengan `code` stabil (spec 0007). |
| Pagination | Cursor di semua daftar (spec 0007). |
| Correlation | Header `X-Request-Id` diterima atau dibuat, ikut di log, audit, sync run, dan problem body. |
| Port development | Backend `127.0.0.1:3000`, frontend `4200` dengan proxy `/api` ke backend. |
| Env | Divalidasi saat startup oleh `packages/platform/config`; app gagal start jika env wajib hilang. |

## Peta spec dan urutan build

| Spec | Lapisan |
|---|---|
| [0002](../0002-database-schema-migration/index.md) | Database: schema, tabel, role, runner migration, partisi |
| [0003](../0003-iam-auth-otorisasi/index.md) | Identitas: login, sesi, role, batas kantor, service token |
| [0004](../0004-domain-ingestion-resolver/index.md) | Domain: model kanonik, parser IP, ingestion, history, resolver |
| [0005](../0005-provider-unifi-sync/index.md) | Provider: adapter UniFi Site Manager, sync run, CLI `sync:once` |
| [0006](../0006-heartbeat-collector/index.md) | Heartbeat: endpoint, trusted ingress, credential source, collector |
| [0007](../0007-api-openapi-kontrak/index.md) | API: semua endpoint, error, pagination, OpenAPI, SDK |
| [0008](../0008-frontend-angular/index.md) | Frontend: layout, i18n, semua halaman |
| [0009](../0009-worker-jadwal-maintenance/index.md) | Worker: jadwal, freshness sweep, retensi, partisi (terakhir) |

Urutan build Tracer Bullet lintas spec. Setiap spec menandai tugas build dengan slice di bawah.

1. **T0 Fondasi**: scaffold sesuai spec ini, Compose PostgreSQL 18, runner migration, schema `core` dan `org`, endpoint health.
2. **T1 Benang tipis**: login admin dan satu permission (0003), tabel inti `network_registry` (0002), ingestion dan resolver dengan fake adapter dev (0004), endpoint connection, binding, dan diagnostics resolve dengan OpenAPI dan SDK (0007), layout plus halaman login, connections, dan diagnostics (0008), CLI `sync:once` dengan fake adapter (0005). Hasil: satu alur nyata dari UI sampai PostgreSQL.
3. **T2 UniFi**: adapter Site Manager, capability report, status run lengkap, retry dan rate limit (0005).
4. **T3 Heartbeat**: endpoint heartbeat, trusted ingress, credential source, collector (0006).
5. **T4 Lengkapi**: semua halaman dan endpoint sisanya, user dan kantor, audit, history (0003, 0007, 0008).
6. **T5 Consumer dan operasional**: resolver internal, snapshot sesi, metrik, settings (0003, 0004, 0007).
7. **T6 Worker**: jadwal, lease runner, freshness sweep, retensi, partisi (0009).
8. **T7 Verifikasi**: benchmark k6, compatibility gate UniFi, review keamanan, uji rollback (semua spec).

## Script root

| Script | Fungsi |
|---|---|
| `dev:backend`, `dev:frontend` | Menjalankan backend (watch) dan `ng serve` dengan proxy |
| `db:up`, `db:down` | Compose PostgreSQL development |
| `db:migrate`, `db:seed`, `db:maintain` | Runner migration, seed, dan pemeliharaan partisi (spec 0002) |
| `iam:create-admin`, `iam:create-service-token` | CLI identitas (spec 0003) |
| `sync:once` | Menjalankan antrean sync sekali (spec 0005) |
| `api:openapi`, `api:check`, `sdk:generate`, `api:sync` | Kontrak dan SDK (spec 0007) |
| `typecheck`, `lint`, `format:check` | Pemeriksaan statis semua app |
| `test:unit`, `test:integration`, `test:frontend`, `test:e2e`, `perf:resolver` | Runner test per level |
| `build:backend`, `build:frontend`, `build:collector`, `build:worker` | Build artefak |
| `ci` | Rangkaian lengkap untuk CI |

## Consequences

**Positive**:
- Hanya dua komponen yang dioperasikan: PostgreSQL 18 dan container aplikasi. Tidak ada Redis, broker, vault, atau ORM untuk dirawat.
- Satu runtime (Bun) untuk backend, worker, collector, dan test server; kode domain dipakai bersama tanpa duplikasi.
- Versi semua dependency utama dipin eksplisit dan sudah dicek terhadap registry per 28 September 2026.

**Negative / tradeoffs**:
- SQL langsung berarti tipe baris ditulis manual dan harus dijaga sinkron dengan migration; test integration menjadi pengaman utama.
- Session auth dibuat sendiri (lihat spec 0003); risiko keamanan ditanggung tim, jadi review keamanan wajib.
- `@ojiepermana/angular` 22.1.14 tertinggal satu minor dari Angular 22.2.0; fitur library 22.2 belum bisa dipakai sampai dipublish.
- Angular butuh Node 24 di samping Bun, jadi CI dan mesin developer memasang dua runtime.
- Satu `package.json` membuat image collector dan worker perlu build yang memilih dependency sendiri (bundling `bun build`), bukan sekadar `bun install --production`.

**Neutral**:
- Hosting produksi dan topologi ingress belum dipilih; konfigurasi trusted proxy dibuat eksplisit (spec 0006) supaya keputusan itu bisa datang belakangan.
- PRD disimpan di root sebagai `PRD.md`; PRD sendiri meminta lokasi `docs/plan/prd/{NNN}-network-registry/`.

## Follow-up

- [ ] Putuskan platform hosting produksi dan topologi ingress (reverse proxy, Cloudflare, atau langsung), lalu isi konfigurasi `NR_TRUSTED_PROXIES` (OQ-NR-004).
- [ ] Naikkan `@ojiepermana/angular` ke 22.2.x begitu dipublish ke npm.
- [ ] Pindahkan `PRD.md` ke `docs/plan/prd/001-network-registry/` sesuai instruksi penyimpanan PRD, dipecah menjadi tiga lapisan dan dokumen pendukung.
- [ ] Jalankan `/audit` setelah scaffold untuk membuat `AGENTS.md` (rules stack, batas folder, skill `elysiajs` dan `angular-developer`).
- [ ] Daftarkan sembilan spec ini sebagai fitur di scope lewat `/scope` agar status build terlacak.
- [ ] Agent Skill dan MCP untuk PostgreSQL, Bun, Playwright, dan k6 ditolak saat desain; catat sebagai `Declined:` di `AGENTS.md`.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
