# 0007. Kontrak API, OpenAPI, dan SDK

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan seluruh permukaan HTTP backend Elysia di bawah prefix `/api`: daftar endpoint beserta permission, format error RFC 9457 (problem+json) dengan kode stabil, pagination cursor di semua daftar, rate limit, correlation id, health, dan metrik. OpenAPI yang dihasilkan dari route menjadi kontrak, diekspor ke `openapi.json`, dan SDK Angular digenerate dari situ dengan generator `@ojiepermana/angular:sdk`. Route tipis: validasi, auth, lalu memanggil service di `packages/registry-core`.

## Requirements

**User stories**:
- As a frontend developer, I want SDK bertipe yang selalu sama dengan backend so that saya tidak menulis DTO atau URL manual.
- As an integrator, I want error dengan kode stabil dan correlation id so that saya bisa menangani kegagalan dan melacaknya di log.
- As a security reviewer, I want setiap route mendeklarasikan permission so that tidak ada endpoint yang terbuka tanpa sengaja.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-API-*`):
- **AC-NR-035**: User read only yang memanggil manage, sync, rotate, atau remap lewat API langsung menerima 403.
- **AC-NR-042**: Schema API berubah: OpenAPI dan SDK Angular digenerate ulang, typecheck, build, dan contract test lulus; tidak ada secret provider di bundle frontend.
- **AC-API-01**: Setiap error dikirim `application/problem+json` dengan `type`, `title`, `status`, `code`, `correlationId`, dan untuk validasi `errors[]` berisi path dan pesan.
- **AC-API-02**: Setiap daftar menerima `cursor` dan `limit` (default 25, maksimal 100), mengembalikan `items` dan `nextCursor` (null di halaman terakhir); cursor rusak, dari sort lain, atau dimanipulasi ditolak 422 `INVALID_CURSOR`.
- **AC-API-03**: Filter dan sort hanya menerima field yang diizinkan per endpoint; field lain ditolak 422.
- **AC-API-04**: `bun run api:check` gagal jika ada route tanpa `operationId` unik, tanpa tag, tanpa schema response untuk setiap status yang mungkin, atau tanpa deklarasi permission (kecuali daftar publik yang disebut eksplisit).
- **AC-API-05**: `bun run api:openapi` mengekspor `openapi.json` tanpa menyalakan server, tanpa konek database, dan hasilnya deterministik (dua kali ekspor identik).
- **AC-API-06**: Header `X-Request-Id` yang valid dipakai sebagai correlation id; jika tidak ada atau tidak valid, dibuat uuidv7. Nilainya dikembalikan di header response dan masuk log, audit, dan problem body.
- **AC-API-07**: `/api/health/live` selalu 200 selama proses hidup; `/api/health/ready` 503 jika database tidak bisa dijangkau atau migration terakhir yang dibutuhkan belum diterapkan.
- **AC-API-08**: `/metrics` hanya bisa diakses dengan `Authorization: Bearer <NR_METRICS_TOKEN>` dan tidak memuat IP, secret, atau id user sebagai label (mendukung AC-NR-043).
- **AC-API-09**: Endpoint internal resolver dan heartbeat tidak ada di SDK frontend.
- **AC-API-10**: Payload request di atas batas per endpoint ditolak 413 sebelum diparse.

## Decision

**Chosen option**: Option 1: REST di bawah `/api` tanpa versi di path, problem+json, cursor di semua daftar, OpenAPI dari route Elysia sebagai sumber kebenaran.

Kontrak ditulis sekali di route Elysia (schema `t`), diekspor ke `openapi.json`, dan semua konsumen (SDK Angular, test kontrak) memakai file itu.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) · `angular-developer` (`~/.claude/skills/angular-developer/`) untuk konsumsi SDK.

## Feature design

### Struktur backend

```text
apps/backend/src/
├── index.ts            # Bun.serve, shutdown
├── app.ts              # komposisi Elysia tanpa listen (dipakai export OpenAPI dan test)
├── config/env.ts
├── plugins/            # request-context, auth, error-handler, openapi, rate-limit, body-limit, db (lazy)
└── routes/
    ├── health.ts, metrics.ts
    ├── auth.routes.ts, iam.routes.ts, org.routes.ts, audit.routes.ts
    └── network-registry/  # providers, connections, external-sites, sites, ip-history, observations, sources, heartbeats, diagnostics, sync-runs, dashboard, settings
    └── internal/resolve.routes.ts
```

Setiap route mendeklarasikan `detail: { operationId, tags, security }`, schema `body`, `query`, `params`, `response` per status, dan macro `permission`. Plugin `db` membuat pool saat request pertama, sehingga `app.ts` bisa diimpor untuk ekspor OpenAPI tanpa database.

### Konvensi

**Error** (`plugins/error-handler.ts`): semua error domain membawa `code`. `type` = `urn:nr:error:<code huruf kecil>`. Error tak terduga menjadi 500 `INTERNAL_ERROR` tanpa stack atau pesan internal di response; detail hanya di log dengan correlation id.

| Code | Status | Keterangan |
|---|---|---|
| `VALIDATION_FAILED` | 422 | Schema request gagal, dengan `errors[]` |
| `INVALID_CURSOR` | 422 | Cursor rusak atau tidak cocok |
| `UNAUTHENTICATED`, `SESSION_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_CREDENTIAL` | 401 | Sesi, login, credential mesin |
| `FORBIDDEN`, `CSRF_REJECTED`, `SOURCE_DISABLED` | 403 | Permission, CSRF, source mati |
| `NOT_FOUND` | 404 | Termasuk data di luar batas kantor |
| `VERSION_CONFLICT`, `MAPPING_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `LAST_ADMIN`, `EMAIL_TAKEN`, `NAME_TAKEN`, `CODE_TAKEN`, `CONNECTION_DISABLED`, `RUN_NOT_FINISHED`, `RUN_FINISHED` | 409 | Konflik state |
| `PAYLOAD_TOO_LARGE` | 413 | Batas body |
| `CAPABILITY_UNSUPPORTED`, `COMPATIBILITY_UNVERIFIED`, `PROVIDER_NOT_AVAILABLE`, `SCOPE_RESTRICTED_ROLE`, `PASSWORD_POLICY`, `OUT_OF_RETENTION`, `NOTE_REQUIRED`, `SETTING_OUT_OF_RANGE` | 422 | Aturan bisnis |
| `RATE_LIMITED` | 429 | Dengan `Retry-After` |
| `PROVIDER_AUTH_FAILED` | 502 | Key vendor ditolak |
| `PROVIDER_RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE` | 503 | Vendor atau database, dengan `Retry-After` jika diketahui |
| `PROVIDER_TIMEOUT` | 504 | Vendor timeout |

Run `partial` bukan error; statusnya ada di body run.

**Pagination**: query `cursor` (opaque) dan `limit`. Cursor = base64url JSON `{ s: <sort key>, v: [<nilai sort>, <id>] }` ditandatangani HMAC SHA-256 dengan `NR_CURSOR_SECRET` supaya tidak bisa dimanipulasi. Query keyset `WHERE (sort_col, id) < ($1, $2) ORDER BY sort_col DESC, id DESC LIMIT limit + 1`. Tidak ada total count di daftar besar; dashboard menyediakan hitungan agregat.

**Rate limit** (`packages/platform/rate-limit`, token bucket in process per kunci):

| Endpoint | Kunci | Batas |
|---|---|---|
| `POST /auth/login` | IP klien dan email | 10 per menit per IP, 5 per menit per email |
| `POST /network-registry/heartbeats` | `keyId` credential | 6 per menit, burst 3 |
| `POST /internal/network-registry/resolve` | `keyId` service token | 3000 per menit |
| `POST /network-registry/diagnostics/resolve` | user | 30 per menit |
| Endpoint lain dengan sesi | user | 600 per menit |

**Batas body**: default 64 KB; heartbeat 2 KB; login 4 KB; resolve 1 KB.

### Daftar endpoint

Semua di bawah `/api`. Sesi = cookie sesi (spec 0003). Kolom Permission memakai kode spec 0003.

| Endpoint | Method | Key inputs | Key outputs | Permission | Key errors |
|---|---|---|---|---|---|
| `/health/live` | GET | | `{ status }` | publik | |
| `/health/ready` | GET | | `{ status, checks: { database, migrations } }` | publik | 503 |
| `/metrics` | GET | | teks Prometheus | token metrik | 401 |
| `/auth/login`, `/auth/logout`, `/auth/me` (GET, PATCH), `/auth/password` | | lihat spec 0003 | | publik atau sesi | |
| `/iam/users`, `/iam/users/:id`, `/iam/users/:id/reset-password`, `/iam/roles` | | lihat spec 0003 | | `iam.users.manage` | |
| `/org/offices` | GET | `cursor`, `limit`, `q`, `isActive` | kantor dengan ringkasan registry | `nr.view` (difilter kantor) | |
| `/org/offices` | POST | `code`, `name`, `timezone` | kantor | `org.offices.manage` | 409 `CODE_TAKEN`, 422 timezone |
| `/org/offices/:id` | GET, PATCH | PATCH: `version`, `name?`, `timezone?`, `isActive?` | kantor | GET `nr.view`, PATCH `org.offices.manage` | 404, 409 |
| `/network-registry/providers` | GET | | katalog | `nr.view` | |
| `/network-registry/connections` | GET | `cursor`, `limit`, `status?`, `enabled?` | connection dengan capability ringkas, mapped count, last attempt, last success, error ringkas | `nr.view` tanpa batas kantor | 403 |
| `/network-registry/connections` | POST | lihat spec 0005 | | `nr.connections.manage` | |
| `/network-registry/connections/:id` | GET | | detail tanpa secret, `hasCredential: true` | `nr.view` tanpa batas kantor | 404 |
| `/network-registry/connections/:id` | PATCH | `version`, `name?`, `enabled?`, `pollIntervalSeconds?`, `jitterSeconds?` | connection | `nr.connections.manage` | 409 |
| `/network-registry/connections/:id/test`, `/rotate-credential`, `/sync` | POST | lihat spec 0005 | | lihat spec 0005 | |
| `/network-registry/external-sites` | GET | `cursor`, `limit`, `connectionId?`, `mappingStatus? (mapped, unmapped)`, `q?` | external site, host, connection, kantor terikat, status mapping, konflik | `nr.view`; unmapped hanya tanpa batas kantor | |
| `/network-registry/external-sites/:id/binding` | PUT | `officeId: uuid \| null`, `bindingVersion: int` | binding aktif baru atau null | `nr.mapping.manage` | 409 `MAPPING_CONFLICT`, 409 `VERSION_CONFLICT`, 404 |
| `/network-registry/sites` | GET | `cursor`, `limit`, `freshness?`, `q?` | kantor dengan jumlah binding, source, freshness, IP current | `nr.view` (difilter kantor) | |
| `/network-registry/sites/:officeId` | GET | | ringkasan, binding, gateway, WAN, periode current, source, coverage, capability yang tidak didukung | `nr.view` (difilter kantor) | 404 |
| `/network-registry/ip-history` | GET | `cursor`, `limit`, `officeId?`, `address?`, `sourceId?`, `from?`, `to?` | periode: IP, family, kantor, source, WAN, first seen, last seen, expires, jendela deteksi, status, reason, basis | `nr.view` (difilter kantor) | 422 |
| `/network-registry/observations` | GET | `cursor`, `limit`, `periodId?` atau `sourceId?`, `from?`, `to?` | evidence: waktu upstream, waktu terima, kualitas waktu, provenance, eligibility, sync run | `nr.view` (difilter kantor) | 422 |
| `/network-registry/sources` dan turunannya | | lihat spec 0006 | | | |
| `/network-registry/heartbeats` | POST | lihat spec 0006 | | credential source | |
| `/network-registry/diagnostics/resolve` | POST | `address: string`, `at?: date-time` | hasil resolver (spec 0004) | `nr.resolve.diagnose`; `at` butuh `nr.resolve.historical` | 422, 403 |
| `/internal/network-registry/resolve` | POST | `address: string` | hasil resolver tanpa masking | service token `nr.resolve.internal` | 401, 403, 503 |
| `/network-registry/sync-runs` dan turunannya | | lihat spec 0005 | | | |
| `/network-registry/dashboard` | GET | | jumlah connection per status, site mapped dan unmapped, source fresh dan stale, konflik IP current, run gagal 24 jam, 10 perubahan terbaru | `nr.view` (difilter kantor) | |
| `/network-registry/settings` | GET | | nilai settings dan batas | `nr.view` | |
| `/network-registry/settings` | PATCH | pasangan kunci nilai | settings | `nr.settings.manage` | 422 `SETTING_OUT_OF_RANGE` |
| `/audit-logs` | GET | `cursor`, `limit`, `action?`, `targetType?`, `targetId?`, `actorId?`, `from?`, `to?` | entri audit tersanitasi | `nr.audit.read` (difilter kantor) | |

### OpenAPI dan SDK

- `plugins/openapi.ts` memakai `@elysia/openapi` 1.4.16. Tag: `auth`, `iam`, `org`, `network-registry`, `audit`, `internal`, `machine`, `ops`.
- `scripts/export-openapi.ts` mengimpor `app.ts`, mengambil dokumen dari plugin, mengurutkan kunci, menulis `openapi.json` di root.
- `scripts/check-api.ts` (`api:check`): ekspor ke memori, bandingkan dengan `openapi.json` yang di commit (harus sama), cek aturan AC-API-04, cek tidak ada properti bernama seperti secret di schema response.
- `sdk:generate`: `ng generate @ojiepermana/angular:sdk --config sdk.config.json` di `apps/frontend`, output `apps/frontend/sdk/`, mengecualikan tag `internal`, `machine`, `ops`. Jika generator tidak mendukung filter tag, `export-openapi.ts` menulis `openapi.frontend.json` tanpa tag itu sebagai input SDK.
- `api:sync` = `api:openapi` lalu `api:check` lalu `sdk:generate`. Wajib dijalankan setiap perubahan backend; CI gagal jika `openapi.json` atau `sdk/` berbeda dengan hasil generate.

### Observability

- Log request JSON: waktu, metode, route template (bukan path mentah), status, durasi, correlation id, user id (tanpa email atau nama), tanpa query string untuk route yang menerima alamat IP.
- Metrik (`packages/platform/metrics`, format teks Prometheus): `nr_http_requests_total{route,method,status}`, `nr_http_request_duration_seconds{route}`, `nr_resolver_duration_seconds{status}`, `nr_resolver_results_total{status}`, `nr_sync_runs_total{status}`, `nr_sync_run_duration_seconds`, `nr_provider_responses_total{provider,class}` (class: `2xx`, `429`, `auth`, `5xx`, `timeout`), `nr_observations_ingested_total{source_type,eligibility}`, `nr_sources_stale` (gauge), `nr_ip_conflicts_current` (gauge), `nr_outbox_backlog` (gauge). Tidak ada label IP, id kantor, id user, atau id connection.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Semua request | correlation id | Header `X-Request-Id` jika cocok `^[A-Za-z0-9._-]{8,128}$`, selain itu uuidv7 baru |
| Daftar | `nextCursor` | Nilai sort dan id baris ke `limit + 1`, ditandatangani `NR_CURSOR_SECRET` |
| Daftar terbatas kantor | kantor diizinkan | Konteks auth (spec 0003) |
| Dashboard | hitungan | Query agregat saat baca dari tabel spec 0002; freshness dari policy spec 0004 |
| Dashboard | "perubahan terbaru" | 10 `ip_periods` terbaru yang dibuka dengan `previous_period_id` atau reason perubahan |
| Site detail | coverage IPv6 | Sama dengan reason `IPV6_COVERAGE_LIMITED` spec 0004 |
| Site detail | capability tidak didukung | `provider_connections.capability_report` connection dari binding aktif |
| Ready | migration yang dibutuhkan | Konstanta `REQUIRED_MIGRATION` di backend dibandingkan `core.schema_migrations` |
| Metrik | nilai gauge | Dihitung saat scrape dengan query ringan, disimpan di cache 15 detik |
| Waktu di response | format | ISO 8601 UTC; tampilan zona waktu urusan frontend |

**Key invariants**:
- Tidak ada route tanpa permission kecuali `health/*`, `auth/login`, heartbeat, internal resolve, dan metrics, yang masing masing punya mekanisme auth sendiri.
- Data di luar batas kantor tidak pernah dibedakan dari data yang tidak ada (404, bukan 403).
- `openapi.json` dan `apps/frontend/sdk/` selalu hasil generate dari kode saat ini.

**Security model**:
- Sesi dan CSRF dari spec 0003; credential mesin dari spec 0003 dan 0006.
- Tidak ada DTO yang memuat API key, token hash, ciphertext, atau password hash; `api:check` memeriksa nama properti.
- CORS tidak diaktifkan; frontend disajikan dari origin yang sama atau lewat proxy dev.

**Configuration required**:
- `NR_CURSOR_SECRET`: kunci HMAC cursor (32 byte).
- `NR_METRICS_TOKEN`: bearer token untuk `/metrics`.
- `HOST`, `PORT`: default `127.0.0.1` dan `3000`.

**Critical test scenarios**:
- Happy path: tiap endpoint dipanggil dengan permission yang benar dan menghasilkan response sesuai schema OpenAPI (contract test membaca `openapi.json`), verifies **AC-NR-042**, **AC-API-01**.
- Auth/permission: matriks role kali endpoint; viewer ditolak di semua mutasi; terbatas kantor mendapat 404 di luar kantornya, verifies **AC-NR-035**.
- Pagination: jalan melewati 250 baris dengan limit 100; cursor diubah satu byte; cursor dari sort lain, verifies **AC-API-02**, **AC-API-03**.
- Kontrak: tambah route tanpa `operationId` atau permission di cabang uji, `api:check` gagal; ekspor dua kali identik tanpa database, verifies **AC-API-04**, **AC-API-05**.
- Operasional: ready saat database mati; metrics tanpa token; request 70 KB, verifies **AC-API-07**, **AC-API-08**, **AC-API-10**.
- SDK: cari `internal` dan `heartbeats` di `apps/frontend/sdk/`; cari pola secret di bundle build, verifies **AC-API-09**, **AC-NR-042**.

## Build plan

1. (T0) `app.ts`, `index.ts`, plugin `request-context`, `error-handler`, `body-limit`, route health, satisfies **AC-API-01**, **AC-API-06**, **AC-API-07**, **AC-API-10**
2. (T1) Plugin `openapi`, `scripts/export-openapi.ts`, `scripts/check-api.ts`, `sdk.config.json`, `api:sync`, satisfies **AC-API-04**, **AC-API-05**, **AC-API-09**, **AC-NR-042**
3. (T1) Helper cursor HMAC dan helper filter atau sort allowlist, satisfies **AC-API-02**, **AC-API-03**
4. (T1) Route benang tipis: providers, connections (daftar, buat, detail), external sites, binding, diagnostics resolve, sync run detail, satisfies **AC-NR-035**, **AC-NR-042**
5. (T1) Plugin `rate-limit` token bucket, satisfies **AC-API-01**
6. (T4) Route sisanya: offices, sites, site detail, ip history, observations, dashboard, audit logs, sync runs daftar, retry, cancel, satisfies **AC-NR-035**, **AC-API-02**
7. (T5) Route internal resolve, settings, `/metrics` dengan token dan metrik yang didaftar, satisfies **AC-API-08**, **AC-API-09**
8. (T4) Contract test berbasis `openapi.json` dan matriks permission, satisfies **AC-NR-035**, **AC-NR-042**
9. (T7) Gate CI: `api:check`, SDK diff, pencarian secret di bundle, satisfies **AC-NR-042**

## Consequences

**Positive**:
- Satu sumber kontrak; frontend tidak bisa melenceng dari backend tanpa CI gagal.
- Error bisa ditangani program lewat `code` dan dilacak lewat `correlationId`.

**Negative / tradeoffs**:
- Tanpa versi di path (pilihan Anda), perubahan breaking harus dilakukan dengan menambah field atau endpoint baru; untuk konsumen internal resolver ini perlu koordinasi eksplisit.
- Cursor di semua daftar berarti tabel UI tidak bisa lompat ke halaman tertentu dan tidak ada total count.
- Rate limit in process tidak akurat lintas replica.

**Neutral**:
- `openapi.json` dan `sdk/` di commit ke repository sehingga review melihat perubahan kontrak.

## Follow-up

- [ ] Konfirmasi dukungan filter tag di schematic `@ojiepermana/angular:sdk` 22.1.14; jika tidak ada, pakai `openapi.frontend.json`.
- [ ] Jika consumer internal resolver bertambah di luar tim, putuskan strategi versioning (prefix `/api/v2` atau header) lewat spec baru.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
