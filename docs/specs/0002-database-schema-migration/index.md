# 0002. Schema database, role, dan runner migration

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan seluruh struktur PostgreSQL 18 untuk Network Registry: empat schema (`core`, `iam`, `org`, `network_registry`), semua tabel dengan kolom, constraint, dan index, role database per aplikasi, serta runner migration berbasis file SQL. Evidence IP mentah dipartisi per bulan supaya retensi cukup dengan membuang partisi lama. Tabel dedup terpisah menjamin idempotency heartbeat lintas partisi, dan history tidak pernah memakai unique `(site, ip)` supaya urutan A ke B ke A tetap terlacak.

## Requirements

**User stories**:
- As a developer, I want satu perintah `db:migrate` yang aman dijalankan berulang dan paralel so that schema selalu konsisten di semua environment.
- As a security reviewer, I want role runtime yang tidak bisa mengubah struktur atau membaca domain di luar tugasnya so that kebocoran satu aplikasi tidak membuka seluruh database.
- As an operator, I want retensi evidence tanpa `DELETE` besar so that database tidak membengkak.

**Acceptance criteria** (ID lokal `AC-DB-*`, plus AC PRD yang didukung):
- **AC-DB-01**: `db:migrate` pada database kosong menerapkan semua migration berurutan, mencatat nama dan checksum SHA-256 di `core.schema_migrations`, dan dijalankan kedua kali tidak mengubah apa pun.
- **AC-DB-02**: Dua proses `db:migrate` bersamaan tidak menerapkan migration yang sama dua kali (advisory lock); proses kedua menunggu lalu selesai tanpa perubahan.
- **AC-DB-03**: Migration yang isi file SQL berubah setelah diterapkan membuat runner berhenti dengan error checksum, tanpa menerapkan migration lain.
- **AC-DB-04**: Runner menolak berjalan pada server PostgreSQL di bawah versi 18.
- **AC-DB-05**: Role `nr_backend` dan `nr_worker` tidak bisa menjalankan DDL, tidak bisa `UPDATE` atau `DELETE` di `core.audit_logs`, dan `nr_worker` tidak bisa membaca tabel `iam` kecuali yang diberi izin eksplisit (tidak ada di V1).
- **AC-DB-06**: Insert kedua dengan `(source_id, dedup_key)` sama ke `network_registry.observation_dedup` ditolak constraint, walaupun `received_at` berada di bulan berbeda (mendukung AC-NR-031).
- **AC-DB-07**: Membuat binding aktif kedua untuk `external_site_id` yang sama gagal atomik oleh partial unique index (mendukung AC-NR-006).
- **AC-DB-08**: Membuat run `queued` kedua untuk connection yang sudah punya run `queued` atau `running` gagal oleh partial unique index (mendukung AC-NR-037).
- **AC-DB-09**: `network_registry.ensure_observation_partitions(n)` membuat partisi bulanan untuk n bulan ke depan secara idempotent, dan dapat dijalankan oleh `nr_worker` tanpa hak DDL (fungsi `SECURITY DEFINER`).
- **AC-DB-10**: `network_registry.drop_observation_partitions_before(ts)` hanya membuang partisi yang seluruh rentangnya lebih tua dari `ts`, dan tidak menyentuh `ip_periods` (mendukung AC-NR-045).
- **AC-DB-11**: Query kandidat current resolver (`address = $1` dengan `expires_at > now()`) memakai index scan pada fixture satu juta observasi, dibuktikan dengan `EXPLAIN (ANALYZE, BUFFERS)` yang disimpan sebagai bukti (mendukung AC-NR-044).
- **AC-DB-12**: Tidak ada unique constraint pada `ip_periods` yang terdiri hanya dari site dan alamat (REQ-NR-005).
- **AC-DB-13**: Seed `db:seed` idempotent: role sistem, permission, dan settings default dibuat atau diperbarui tanpa menduplikasi, dan tidak menyentuh data bisnis.

## Decision

**Chosen option**: Option 1: Empat schema domain, file SQL berurutan, runner Bun sendiri, evidence dipartisi bulanan.

Semua objek hidup di empat schema berkualifikasi penuh, dibuat oleh role pemilik `nr_owner` lewat runner migration, dan diakses runtime lewat role terbatas per aplikasi.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) untuk plugin database di backend.

## Feature design

### Role dan privilege

Role cluster dibuat oleh langkah provisioning terpisah (`database/provision.sql`, dijalankan dengan kredensial admin; di development otomatis lewat init script Compose). Migration tidak membuat role, hanya memberi grant ke role yang sudah ada, dan runner memeriksa role itu ada sebelum mulai.

| Role | Login | Dipakai oleh | Hak |
|---|---|---|---|
| `nr_owner` | ya | runner migration dan seed saja | Pemilik semua schema dan objek; satu satunya yang menjalankan DDL. |
| `nr_backend` | ya | `apps/backend`, CLI `iam:*` | `USAGE` di keempat schema. CRUD sesuai tabel di bawah. `INSERT` saja di `core.audit_logs` dan `core.outbox_events`. `SELECT` di `core.schema_migrations` untuk readiness. |
| `nr_worker` | ya | `apps/worker`, CLI `sync:once`, `db:maintain` | `USAGE` di `core`, `org`, `network_registry`. Tanpa akses tabel `iam`. `SELECT` di `network_registry.connection_secrets`. `DELETE` hanya di `observation_dedup`, `ip_periods`, dan `sync_runs` untuk retensi. `EXECUTE` fungsi partisi dan `iam.purge_expired_sessions`. |
| `nr_readonly` | ya | analis, backup verifikasi | `SELECT` di `org` dan `network_registry` kecuali `connection_secrets` dan `heartbeat_credentials`. |

Aturan tambahan:
- Setiap role runtime memakai `search_path = pg_catalog`. Semua query memakai nama berkualifikasi schema.
- `REVOKE CREATE ON SCHEMA public FROM PUBLIC` di migration pertama.
- `ALTER DEFAULT PRIVILEGES FOR ROLE nr_owner` diset per schema agar tabel baru tidak otomatis terbuka.
- `nr_backend` tidak punya `DELETE` di tabel mana pun (kebijakan tanpa hard delete). Revoke sesi memakai `UPDATE revoked_at`, nonaktif memakai `is_active` atau `enabled`.

### Tabel

Konvensi: `id uuid PRIMARY KEY DEFAULT uuidv7()`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()` di tabel yang bisa diubah. Kolom enum memakai `text` dengan `CHECK`.

**Schema `core`**

| Tabel | Kolom | Constraint dan index |
|---|---|---|
| `schema_migrations` | `name text PK`, `checksum text NOT NULL`, `applied_at timestamptz NOT NULL`, `duration_ms int NOT NULL` | Dibuat oleh bootstrap runner. |
| `audit_logs` | `id`, `occurred_at timestamptz NOT NULL DEFAULT now()`, `actor_type text CHECK IN ('user','service','system')`, `actor_id uuid NULL`, `action text NOT NULL`, `target_type text NOT NULL`, `target_id uuid NULL`, `office_id uuid NULL`, `result text CHECK IN ('succeeded','failed','denied')`, `correlation_id text NOT NULL`, `before jsonb NULL`, `after jsonb NULL`, `metadata jsonb NOT NULL DEFAULT '{}'` | Index `(occurred_at DESC, id)`, `(target_type, target_id, occurred_at DESC)`, `(actor_id, occurred_at DESC)`. Append only (tanpa grant `UPDATE`/`DELETE`). |
| `outbox_events` | `id uuid PK` (= event id), `event_type text NOT NULL`, `schema_version int NOT NULL`, `aggregate_type text NOT NULL`, `aggregate_id uuid NOT NULL`, `office_id uuid NULL`, `payload jsonb NOT NULL`, `occurred_at timestamptz NOT NULL`, `published_at timestamptz NULL`, `attempts int NOT NULL DEFAULT 0`, `last_error text NULL` | Partial index `(occurred_at) WHERE published_at IS NULL` untuk backlog. |

**Schema `org`**

| Tabel | Kolom | Constraint dan index |
|---|---|---|
| `offices` | `id`, `code text NOT NULL`, `name text NOT NULL`, `timezone text NOT NULL DEFAULT 'Asia/Jakarta'`, `is_active boolean NOT NULL DEFAULT true`, `version int NOT NULL DEFAULT 1`, timestamps | `UNIQUE (lower(code))`; `CHECK (length(code) BETWEEN 2 AND 32)`. Timezone divalidasi di aplikasi terhadap daftar IANA. |

**Schema `iam`**

| Tabel | Kolom | Constraint dan index |
|---|---|---|
| `users` | `id`, `email text NOT NULL`, `display_name text NOT NULL`, `password_hash text NOT NULL`, `locale text NOT NULL DEFAULT 'id' CHECK IN ('id','en')`, `is_active boolean NOT NULL DEFAULT true`, `must_change_password boolean NOT NULL DEFAULT false`, `failed_login_count int NOT NULL DEFAULT 0`, `locked_until timestamptz NULL`, `last_login_at timestamptz NULL`, `version int NOT NULL DEFAULT 1`, timestamps | `UNIQUE (lower(email))`. |
| `sessions` | `id`, `user_id uuid NOT NULL FK users`, `token_hash bytea NOT NULL`, `created_at`, `last_seen_at timestamptz NOT NULL`, `idle_expires_at timestamptz NOT NULL`, `absolute_expires_at timestamptz NOT NULL`, `revoked_at timestamptz NULL`, `revoke_reason text NULL`, `client_ip inet NULL`, `user_agent text NULL`, `network_context jsonb NULL` | `UNIQUE (token_hash)`; index `(user_id) WHERE revoked_at IS NULL`. `network_context` diisi sekali saat login, tidak pernah diubah (REQ-NR-013). |
| `roles` | `id`, `code text NOT NULL`, `name_id text NOT NULL`, `name_en text NOT NULL`, `is_system boolean NOT NULL DEFAULT true` | `UNIQUE (code)`. Isi hanya dari seed. |
| `role_permissions` | `role_id uuid FK roles`, `permission text NOT NULL` | `PK (role_id, permission)`. |
| `user_roles` | `user_id uuid FK users`, `role_id uuid FK roles`, `granted_at`, `granted_by uuid NULL` | `PK (user_id, role_id)`. |
| `user_office_scopes` | `user_id uuid FK users`, `office_id uuid FK org.offices` | `PK (user_id, office_id)`. Tidak ada baris berarti semua kantor. |
| `service_tokens` | `id`, `name text NOT NULL`, `key_id text NOT NULL`, `token_hash bytea NOT NULL`, `permissions text[] NOT NULL`, `created_at`, `expires_at timestamptz NULL`, `revoked_at timestamptz NULL`, `last_used_at timestamptz NULL` | `UNIQUE (key_id)`. |

**Schema `network_registry`**

| Tabel | Kolom | Constraint dan index |
|---|---|---|
| `provider_connections` | `id`, `provider_code text NOT NULL`, `name text NOT NULL`, `access_mode text NOT NULL CHECK IN ('site_manager')`, `config jsonb NOT NULL DEFAULT '{}'` (non secret), `enabled boolean NOT NULL DEFAULT true`, `enabled_epoch int NOT NULL DEFAULT 1`, `poll_interval_s int NOT NULL DEFAULT 300 CHECK BETWEEN 60 AND 86400`, `jitter_s int NOT NULL DEFAULT 30`, `status text NOT NULL DEFAULT 'unverified' CHECK IN ('unverified','ok','degraded','auth_failed','rate_limited','error','disabled')`, `capability_report jsonb NULL`, `last_attempt_at`, `last_success_at`, `next_sync_at timestamptz NULL`, `backoff_until timestamptz NULL`, `consecutive_failures int NOT NULL DEFAULT 0`, `last_error jsonb NULL` (tersanitasi), `version int NOT NULL DEFAULT 1`, timestamps | `UNIQUE (lower(name))`; index `(next_sync_at) WHERE enabled`. |
| `connection_secrets` | `connection_id uuid PK FK provider_connections`, `key_id text NOT NULL`, `nonce bytea NOT NULL`, `ciphertext bytea NOT NULL`, `created_at`, `rotated_at timestamptz NULL` | Grant `SELECT` hanya ke `nr_backend` dan `nr_worker`; tidak pernah di `nr_readonly`. |
| `external_sites` | `id`, `connection_id uuid NOT NULL FK`, `external_host_id text NULL`, `external_site_id text NOT NULL`, `external_name text NULL`, `host_name text NULL`, `first_discovered_at timestamptz NOT NULL`, `last_discovered_at timestamptz NOT NULL`, `last_seen_in_complete_discovery_at timestamptz NULL`, `binding_version int NOT NULL DEFAULT 0` | `UNIQUE NULLS NOT DISTINCT (connection_id, external_host_id, external_site_id)`. |
| `site_bindings` | `id`, `external_site_id uuid NOT NULL FK external_sites`, `office_id uuid NOT NULL FK org.offices`, `effective_from timestamptz NOT NULL`, `effective_to timestamptz NULL`, `created_by uuid NULL`, `ended_by uuid NULL`, `end_reason text NULL CHECK IN ('remapped','unbound')` | Partial unique `(external_site_id) WHERE effective_to IS NULL`; index `(office_id) WHERE effective_to IS NULL`; `CHECK (effective_to IS NULL OR effective_to > effective_from)`. |
| `gateways` | `id`, `external_site_id uuid NOT NULL FK`, `external_device_id text NOT NULL`, `name text NULL`, `model text NULL`, `reported_status text NULL`, `first_observed_at`, `last_observed_at timestamptz NOT NULL` | `UNIQUE (external_site_id, external_device_id)`. |
| `wan_interfaces` | `id`, `gateway_id uuid NOT NULL FK gateways`, `external_wan_key text NOT NULL`, `name text NULL`, `reported_status text NULL`, `route_metadata jsonb NOT NULL DEFAULT '{}'`, `last_observed_at timestamptz NOT NULL` | `UNIQUE (gateway_id, external_wan_key)`. |
| `observation_sources` | `id`, `source_type text NOT NULL CHECK IN ('provider_api','heartbeat')`, `office_id uuid NULL FK org.offices` (wajib untuk heartbeat), `connection_id uuid NULL FK`, `external_site_id uuid NULL FK`, `gateway_id uuid NULL FK`, `wan_interface_id uuid NULL FK`, `stream_key text NOT NULL`, `address_family smallint NULL CHECK IN (4,6)`, `route_label text NULL`, `expected_interval_s int NOT NULL DEFAULT 300`, `enabled boolean NOT NULL DEFAULT true`, `enabled_epoch int NOT NULL DEFAULT 1`, `routing_assertion text NOT NULL DEFAULT 'unidentified' CHECK IN ('unidentified','single_egress_verified')`, `routing_assertion_note text NULL`, `freshness_state text NOT NULL DEFAULT 'never' CHECK IN ('never','fresh','stale','disabled')`, `freshness_changed_at timestamptz NULL`, `last_observation_at timestamptz NULL`, `version int NOT NULL DEFAULT 1`, timestamps | `UNIQUE (stream_key)`; `CHECK (source_type <> 'heartbeat' OR office_id IS NOT NULL)`; `CHECK (source_type <> 'provider_api' OR (connection_id IS NOT NULL AND external_site_id IS NOT NULL))`. |
| `heartbeat_credentials` | `id`, `source_id uuid NOT NULL FK observation_sources`, `key_id text NOT NULL`, `token_hash bytea NOT NULL`, `created_at`, `created_by uuid NULL`, `expires_at timestamptz NULL`, `revoked_at timestamptz NULL`, `revoked_by uuid NULL`, `last_used_at timestamptz NULL` | `UNIQUE (key_id)`; index `(source_id) WHERE revoked_at IS NULL`. |
| `ip_observations` | `id uuid NOT NULL DEFAULT uuidv7()`, `received_at timestamptz NOT NULL`, `source_id uuid NOT NULL`, `source_epoch int NOT NULL`, `office_id uuid NULL`, `binding_id uuid NULL`, `address inet NOT NULL`, `family smallint NOT NULL`, `role text NOT NULL CHECK IN ('wan_assigned','egress_public','unknown')`, `classification text NOT NULL CHECK IN ('public','private','shared','loopback','link_local','unique_local','multicast','reserved','documentation','unspecified')`, `stream_key text NOT NULL`, `source_sample_id text NULL`, `event_id text NULL`, `source_observed_at timestamptz NULL`, `timestamp_quality text NOT NULL CHECK IN ('upstream','receipt_based','unknown')`, `schema_version text NOT NULL`, `fingerprint bytea NOT NULL`, `credential_id uuid NULL`, `sync_run_id uuid NULL`, `ingress_status text NULL CHECK IN ('trusted_peer','trusted_chain','unresolved')`, `eligibility text NOT NULL CHECK IN ('eligible','quarantined','ineligible')`, `eligibility_reason text NULL`, `snapshot_completeness text NULL CHECK IN ('complete','partial','unknown')` | `PRIMARY KEY (id, received_at)`; `PARTITION BY RANGE (received_at)` bulanan, nama `ip_observations_yYYYYmMM`; index per partisi `(source_id, received_at DESC)`, `(address, received_at DESC)`. Tanpa FK keluar (partisi dibuang oleh retensi); integritas dijaga aplikasi. |
| `observation_dedup` | `source_id uuid NOT NULL`, `dedup_key text NOT NULL`, `fingerprint bytea NOT NULL`, `observation_id uuid NOT NULL`, `received_at timestamptz NOT NULL` | `PRIMARY KEY (source_id, dedup_key)`; index `(received_at)` untuk cleanup. `dedup_key` = `event_id` untuk heartbeat, `source_sample_id` atau fingerprint sample untuk polling. |
| `ip_periods` | `id`, `office_id uuid NOT NULL FK org.offices`, `source_id uuid NOT NULL FK observation_sources`, `source_epoch int NOT NULL`, `binding_id uuid NULL FK site_bindings`, `stream_key text NOT NULL`, `address inet NOT NULL`, `family smallint NOT NULL`, `role text NOT NULL`, `classification text NOT NULL`, `first_seen_at timestamptz NOT NULL`, `last_seen_at timestamptz NOT NULL`, `expires_at timestamptz NOT NULL`, `previous_period_id uuid NULL FK ip_periods`, `detection_window_start timestamptz NULL`, `status text NOT NULL CHECK IN ('open','closed','quarantined')`, `close_reason text NULL CHECK IN ('replaced_in_verified_stream','quarantined')`, `closed_at timestamptz NULL`, `first_evidence_id uuid NOT NULL`, `last_evidence_id uuid NOT NULL`, `observation_count int NOT NULL DEFAULT 1`, `eligible_basis text NULL CHECK IN ('observed_egress','wan_assigned_public')`, `version int NOT NULL DEFAULT 1` | Index `(address, expires_at DESC) INCLUDE (office_id, source_id, status)`; `(office_id, first_seen_at DESC)`; `(source_id, stream_key) WHERE status = 'open'`. **Tidak ada** unique `(office_id, address)` atau `(source_id, address)`. Evidence id tanpa FK karena observasi mentah lebih cepat dibuang. |
| `sync_runs` | `id`, `connection_id uuid NOT NULL FK`, `trigger text NOT NULL CHECK IN ('scheduled','manual','retry')`, `actor_user_id uuid NULL`, `status text NOT NULL CHECK IN ('queued','running','succeeded','partial','failed','cancelled')`, `queued_at timestamptz NOT NULL DEFAULT now()`, `started_at`, `finished_at`, `lease_owner text NULL`, `lease_expires_at timestamptz NULL`, `attempt int NOT NULL DEFAULT 1`, `cancel_requested boolean NOT NULL DEFAULT false`, `counts jsonb NOT NULL DEFAULT '{}'`, `checkpoint jsonb NULL`, `issues jsonb NOT NULL DEFAULT '[]'`, `error_summary jsonb NULL`, `correlation_id text NOT NULL`, `retry_of uuid NULL FK sync_runs` | Partial unique `(connection_id) WHERE status IN ('queued','running')`; index `(connection_id, queued_at DESC)`; `(status, queued_at) WHERE status = 'queued'`; `(lease_expires_at) WHERE status = 'running'`. |
| `settings` | `key text PK`, `value jsonb NOT NULL`, `updated_at`, `updated_by uuid NULL` | Kunci diizinkan dikunci di aplikasi (spec 0004). |

### Fungsi dan partisi

- `network_registry.ensure_observation_partitions(months_ahead int)`: `SECURITY DEFINER`, pemilik `nr_owner`, `SET search_path = pg_catalog`. Membuat partisi bulan berjalan sampai `months_ahead` ke depan, beserta index lokalnya. Idempotent.
- `network_registry.drop_observation_partitions_before(cutoff timestamptz)`: `SECURITY DEFINER`. `DETACH` lalu `DROP` partisi yang batas atasnya `<= cutoff`. Mengembalikan daftar partisi yang dibuang.
- `iam.purge_expired_sessions(before timestamptz)`: `SECURITY DEFINER`, menghapus sesi yang `absolute_expires_at` atau `revoked_at` lebih tua dari `before`. Dipanggil worker tanpa memberi worker akses tabel `iam`.
- Migration partisi membuat 12 bulan ke depan, sehingga sistem aman sebelum worker (spec 0009) mengambil alih pemeliharaan. `db:maintain` menjalankan kedua fungsi secara manual.
- Tidak ada default partition. Insert ke bulan tanpa partisi gagal keras dan dilaporkan sebagai `DEPENDENCY_UNAVAILABLE`, bukan disimpan diam diam.
- Retensi efektif evidence mentah adalah 30 sampai 61 hari karena batas partisi bulanan. Jika kebijakan menuntut tepat 30 hari, ganti ke partisi harian lewat migration baru.

### Runner migration

`database/migrate.ts` (Bun, `Bun.SQL`, koneksi `DATABASE_URL_OWNER`):

1. Konek, cek `server_version_num >= 180000`, cek target database sama dengan `NR_DB_EXPECTED_NAME` (mencegah salah target).
2. `SELECT pg_advisory_lock(hashtext('nr.migrate'))`.
3. Bootstrap `core` schema dan `core.schema_migrations` jika belum ada.
4. Baca `database/migrations/NNNN-<domain>-<judul>.sql` urut nama. Untuk yang sudah tercatat, bandingkan checksum SHA-256 byte file; beda berarti berhenti dengan error.
5. Untuk setiap file baru: jalankan dalam satu transaksi bersama insert `schema_migrations`. File yang diawali komentar `-- nr:no-transaction` dijalankan di luar transaksi, satu statement per bagian, dan dicatat setelah selesai.
6. Setelah semua, verifikasi grant (query `has_table_privilege` untuk role runtime pada tabel kunci), lalu lepas lock.

`database/seed.ts` menjalankan `database/seeds/*.sql` yang semuanya idempotent (`INSERT ... ON CONFLICT DO UPDATE` untuk data sistem). Seed dev (`database/seeds/dev/`) hanya jalan dengan flag `--dev` dan menolak jika `NR_ENV=production`.

### Daftar migration dan slice

| File | Isi | Slice |
|---|---|---|
| `0001-core-schemas.sql` | Buat schema `core`, `iam`, `org`, `network_registry`; revoke `public`; default privileges | T0 |
| `0002-org-offices.sql` | `org.offices` plus grant | T0 |
| `0003-core-audit-outbox.sql` | `core.audit_logs`, `core.outbox_events` | T1 |
| `0004-iam-identity.sql` | `users`, `sessions`, `roles`, `role_permissions`, `user_roles`, `user_office_scopes` | T1 |
| `0005-nr-connections-sites.sql` | `provider_connections`, `connection_secrets`, `external_sites`, `site_bindings`, `gateways`, `wan_interfaces` | T1 |
| `0006-nr-sources-observations.sql` | `observation_sources`, `ip_observations` (partisi) plus fungsi partisi dan 12 bulan ke depan, `observation_dedup`, `ip_periods` | T1 |
| `0007-nr-sync-runs-settings.sql` | `sync_runs`, `settings` | T1 |
| `0008-nr-heartbeat-credentials.sql` | `heartbeat_credentials` | T3 |
| `0009-iam-service-tokens.sql` | `service_tokens` | T5 |

Seed sistem: `0001-roles-permissions.sql` (role `viewer`, `operator`, `auditor`, `admin` dan permission dari spec 0003), `0002-settings-defaults.sql` (nilai dari spec 0004).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Runner mencatat migration | `checksum` | SHA-256 dari byte file SQL |
| Runner cek versi | versi server | `current_setting('server_version_num')` |
| Partisi dibuat | rentang bulan | `date_trunc('month', now())` ditambah n bulan, UTC |
| Partisi dibuang | `cutoff` | `now() - settings.raw_observation_retention_days` (spec 0004), dikirim oleh `db:maintain` atau worker |
| Grant diverifikasi | daftar role | `NR_DB_RUNTIME_ROLES` default `nr_backend,nr_worker,nr_readonly` |

**Key invariants**:
- Satu binding aktif per external site (partial unique), satu run aktif per connection (partial unique).
- `(source_id, dedup_key)` unik selamanya selama baris dedup masih dalam retensi.
- Observasi menyimpan `office_id`, `binding_id`, dan `source_epoch` saat ingest dan tidak pernah diubah (BR-NR-009).
- Tidak ada `ON DELETE CASCADE` dari connection, source, atau office ke history atau evidence.
- Migration yang sudah diterapkan tidak pernah diedit.

**Security model**:
- Hanya `nr_owner` yang punya DDL. Kredensialnya hanya ada di job migration, tidak di container backend atau worker.
- `connection_secrets` dan `heartbeat_credentials` tidak pernah bisa dibaca `nr_readonly`.
- Audit append only lewat grant, bukan hanya aturan aplikasi.

**Configuration required**:
- `DATABASE_URL_OWNER`: koneksi `nr_owner` untuk runner migration, seed, dan `db:maintain` bagian DDL.
- `DATABASE_URL_BACKEND`: koneksi `nr_backend`.
- `DATABASE_URL_WORKER`: koneksi `nr_worker` (worker dan CLI `sync:once`).
- `NR_DB_EXPECTED_NAME`: nama database yang diharapkan runner.
- `NR_ENV`: `development` | `test` | `production`, dipakai seed dan pengaman lain.
- `POSTGRES_ADMIN_PASSWORD`: hanya untuk Compose development dan provisioning role, tidak dipakai aplikasi.

**Critical test scenarios**:
- Happy path: database kosong, `db:migrate` lalu `db:migrate` lagi, lalu `db:seed` dua kali; semua tabel dan seed ada tanpa duplikat, verifies **AC-DB-01**, **AC-DB-13**.
- Failure case: dua runner paralel; lalu ubah satu byte migration yang sudah diterapkan dan jalankan lagi, verifies **AC-DB-02**, **AC-DB-03**.
- Failure case: insert dedup dengan kunci sama di dua bulan berbeda; binding aktif kedua; run queued kedua, verifies **AC-DB-06**, **AC-DB-07**, **AC-DB-08**.
- Auth/permission: sebagai `nr_backend` coba `CREATE TABLE`, `UPDATE core.audit_logs`; sebagai `nr_worker` coba `SELECT iam.users`; semua ditolak, verifies **AC-DB-05**.
- Performance: fixture satu juta observasi dan periode sebanding, simpan `EXPLAIN ANALYZE` query kandidat, verifies **AC-DB-11**.

## Build plan

1. (T0) `docker-compose.yml` dengan `postgres:18.6` dipin digest, init script yang menjalankan `database/provision.sql` untuk membuat role dengan password dari env, satisfies **AC-DB-04**, **AC-DB-05**
2. (T0) Runner `database/migrate.ts`: cek versi, cek nama database, advisory lock, bootstrap, checksum, transaksi per file, penanda `no-transaction`, verifikasi grant, satisfies **AC-DB-01**, **AC-DB-02**, **AC-DB-03**, **AC-DB-04**
3. (T0) Migration `0001` dan `0002`, satisfies **AC-DB-01**, **AC-DB-05**
4. (T1) Migration `0003` sampai `0007` termasuk fungsi partisi dan 12 partisi ke depan, satisfies **AC-DB-06**, **AC-DB-07**, **AC-DB-08**, **AC-DB-09**, **AC-DB-12**
5. (T1) `database/seed.ts` plus seed sistem role, permission, settings; seed dev kantor contoh dengan penjaga `NR_ENV`, satisfies **AC-DB-13**
6. (T1) `packages/db`: factory `Bun.SQL` per role (pool per proses, `search_path` dicek saat konek), helper `withTransaction`, tipe baris per tabel, satisfies **AC-DB-05**
7. (T1) Test integration role dan constraint (`tests/integration/database/`), satisfies **AC-DB-05**, **AC-DB-06**, **AC-DB-07**, **AC-DB-08**, **AC-DB-12**
8. (T3) Migration `0008`, satisfies **AC-DB-05**
9. (T5) Migration `0009`, satisfies **AC-DB-05**
10. (T6) Script `db:maintain` memanggil `ensure_observation_partitions` dan `drop_observation_partitions_before`; test batas partisi, satisfies **AC-DB-09**, **AC-DB-10**
11. (T7) Fixture generator satu juta observasi dan bukti `EXPLAIN ANALYZE`, satisfies **AC-DB-11**

## Consequences

**Positive**:
- Batas privilege ditegakkan database, bukan hanya kode. Worker yang bocor tidak bisa membaca password hash atau sesi.
- Retensi evidence murah (drop partisi), tanpa bloat dari `DELETE` besar.
- A ke B ke A dan multi kandidat lintas kantor terjamin oleh desain schema, bukan kedisiplinan query.

**Negative / tradeoffs**:
- Tabel partisi tidak bisa punya FK keluar maupun masuk dengan mudah; integritas evidence dijaga aplikasi dan test.
- Partisi bulanan membuat retensi mentah efektif 30 sampai 61 hari, bukan tepat 30.
- Role cluster harus diprovisioning di luar migration, jadi deployment punya satu langkah tambahan.
- Tanpa default partition, lupa memelihara partisi akan menggagalkan ingestion; mitigasinya 12 bulan di depan dan metrik di spec 0009.

**Neutral**:
- Nilai enum diubah lewat migration `ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT`, bukan `ALTER TYPE`.

## Follow-up

- [ ] Putuskan kebijakan retensi audit produksi (PRD: ikuti kebijakan existing, yang belum ada). Sampai diputuskan, audit tidak dibersihkan.
- [ ] Putuskan retensi final (OQ-NR-008) sebelum produksi; default 30 hari mentah, 365 hari history, 90 hari sync log.
- [ ] Rencana backup dan uji restore (AC-NR-045) mengikuti platform hosting yang belum dipilih.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
