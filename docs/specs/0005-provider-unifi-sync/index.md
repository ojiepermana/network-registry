# 0005. Adapter UniFi Site Manager dan sync run

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan adapter UniFi pertama dan cara sinkronisasi dijalankan. V1 hanya memakai UniFi Site Manager API di cloud (`https://api.ui.com`, header `X-API-Key`), dan setiap kemampuan (site, gateway, WAN, IP publik) dimulai berstatus `unverified` sampai dibuktikan dengan fixture dan perangkat nyata. Sync dicatat di `sync_runs` dengan lease supaya satu connection tidak diproses ganda. Sebelum worker ada, antrean dijalankan dengan perintah `bun run sync:once`, memakai kode yang sama yang nanti dipanggil worker.

## Requirements

**User stories**:
- As a platform administrator, I want menambah akun UniFi, mengujinya, dan melihat kemampuan apa saja yang benar benar tersedia so that saya tahu data apa yang bisa dipercaya.
- As a network administrator, I want menekan Sync now dan melihat progres serta kegagalan per site so that saya tidak menebak kenapa data tidak muncul.
- As an operator, I want sync yang gagal sebagian tetap menyimpan data yang valid so that satu site bermasalah tidak menghentikan yang lain.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-UNI-*`):
- **AC-NR-002**: Dua connection UniFi berbeda disinkronkan: credential, state, dan error tidak tercampur.
- **AC-NR-004**: Capability WAN atau public egress tidak tersedia: status `unsupported` atau `unverified` dengan reason terlihat, bukan sukses dengan IP dummy atau array kosong.
- **AC-NR-005**: Discovery berhalaman: setiap site muncul tepat sekali; site belum terpetakan tidak menghasilkan match.
- **AC-NR-008**: Live smoke test di UDR nyata mencatat model, versi, API, schema, timestamp, dan privilege, dengan fixture tersanitasi. Tanpa perangkat atau credential, status `BLOCKED`.
- **AC-NR-037**: Scheduled dan manual sync, atau beberapa proses bersamaan: lease mencegah run efektif ganda dan history atau event duplikat.
- **AC-NR-038**: 429, `Retry-After`, timeout, 5xx, dan key invalid: retry hanya untuk yang retryable, backoff terbatas, auth error tidak di retry.
- **AC-NR-039**: Pagination atau site gagal sebagian: run `partial` terlihat, data valid diproses, data yang belum terbaca tidak dihapus.
- **AC-NR-040**: Proses sync mati di tengah: lease kedaluwarsa, run diulang aman tanpa efek samping ganda.
- **AC-UNI-01**: `POST /connections/:id/test` memanggil probe dengan timeout 10 detik, menyimpan `capability_report`, mengubah status connection, dan tidak pernah mengembalikan atau mencatat API key.
- **AC-UNI-02**: Klien HTTP adapter hanya bisa menghubungi `https://api.ui.com`; redirect, host lain, atau hasil DNS ke alamat private, loopback, link local, atau metadata ditolak (mendukung AC-NR-034).
- **AC-UNI-03**: Mapper menolak respons upstream yang tidak cocok schema tervalidasi dengan issue `UPSTREAM_SCHEMA_MISMATCH`, bukan menebak field.
- **AC-UNI-04**: `bun run sync:once` mengambil run `queued`, memprosesnya dengan role `nr_worker`, lalu keluar dengan kode 0 jika semua run selesai (termasuk `partial`) dan kode bukan 0 jika proses sendiri gagal.
- **AC-UNI-05**: Sync now saat connection sudah punya run `queued` atau `running` mengembalikan 202 dengan run yang sudah ada dan `deduplicated: true`.
- **AC-UNI-06**: Rotate credential mengganti ciphertext, mencatat audit tanpa nilai secret, dan run berikutnya memakai key baru.
- **AC-UNI-07**: Connection disabled tidak diantrekan, run `queued` miliknya dibatalkan, dan evidence miliknya berhenti eligible seketika.

## Decision

**Chosen option**: Option 1: Site Manager API cloud saja, capability dimulai `unverified`, sync run di tabel PostgreSQL dengan lease, dieksekusi CLI lalu worker.

Adapter UniFi hanya membaca, lewat klien HTTP dengan allowlist host, dan setiap field alamat hanya dipetakan setelah semantiknya diverifikasi terhadap respons nyata.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) untuk route test, sync, rotate.

## Feature design

### Adapter

Letak: `packages/registry-core/src/providers/unifi/`.

| File | Tanggung jawab |
|---|---|
| `client.ts` | Klien HTTP Site Manager: base `https://api.ui.com`, header `X-API-Key`, `Accept: application/json`, timeout per request dari settings, retry dan backoff, parsing `Retry-After`, pagination `pageSize` dan `nextToken` |
| `schemas.ts` | Schema TypeBox untuk respons upstream yang sudah diverifikasi (hosts, sites, devices). Toleran terhadap field tambahan, ketat terhadap field yang dipakai |
| `mapper.ts` | Upstream ke kanonik: `ExternalSiteRecord`, `GatewayRecord`, `WanRecord`, `AddressObservation` |
| `capabilities.ts` | Matriks capability per `access_mode` dan bukti verifikasi |
| `adapter.ts` | Implementasi `ProviderAdapter` (spec 0004) |
| `fixtures/` | Respons tersanitasi dari compatibility capture |

Endpoint yang dipakai (menurut dokumentasi Site Manager, wajib dikonfirmasi saat compatibility capture): list hosts, list sites, list devices. Semua `GET`. Tidak ada endpoint tulis yang dipanggil (REQ-NR-010 read only).

Aturan capability awal:

| Capability | Status awal | Syarat naik ke `supported` |
|---|---|---|
| `authenticate` | `unverified` | Probe berhasil dengan key nyata |
| `discover_sites` | `unverified` | Fixture live dengan pagination tercatat |
| `host_identity` | `unverified` | Field host id dan relasinya ke site terverifikasi |
| `gateway_inventory` | `unverified` | Device gateway teridentifikasi dari respons nyata |
| `wan_identification`, `wan_assigned_address`, `public_egress_address`, `multi_wan`, `ipv6_host_address` | `unverified` | Field dan artinya terverifikasi di UDR nyata; tanpa itu mapper tidak menghasilkan `AddressObservation` dan menulis issue `CAPABILITY_UNVERIFIED` |
| `source_timestamp` | `unverified` | Terbukti field waktu adalah waktu sample upstream, bukan waktu baca; tanpa itu `timestamp_quality = 'unknown'` sehingga evidence tidak eligible |
| `health_metadata` | `unverified` | Status device terverifikasi |

Tidak ada nilai yang dikarang. Jika field IP belum terverifikasi, sync tetap berhasil untuk discovery dan inventory, tetapi site detail menunjukkan "IP publik belum didukung sumber ini" dengan reason, dan heartbeat menjadi jalur observasi egress (INT-NR-004).

Klien HTTP egress (`packages/platform/egress-http`): `fetch` dengan `redirect: 'manual'` (3xx menjadi error), host dicocokkan dengan allowlist `NR_PROVIDER_ALLOWED_HOSTS` (default `api.ui.com`), hanya `https:`, resolusi DNS diperiksa sebelum koneksi dan ditolak jika menghasilkan alamat non public, verifikasi TLS selalu aktif. Tidak ada input URL dari pengguna di mode `site_manager`.

### Sync run

State machine `sync_runs.status`:

```
queued → running → succeeded | partial | failed
queued → cancelled
running → cancelled (cancel_requested diperiksa antar site)
running (lease kedaluwarsa) → queued (attempt + 1, maksimal 3) | failed
```

Alur satu run (`SyncRunner.run(runId)` di `packages/registry-core/src/application/sync/`):

1. Klaim: `UPDATE sync_runs SET status='running', started_at=now(), lease_owner=$owner, lease_expires_at=now()+interval '2 minutes' WHERE id = (SELECT id FROM sync_runs WHERE status='queued' ORDER BY queued_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`. Perpanjang lease setiap 30 detik; jika perpanjangan gagal (lease sudah diambil), hentikan run tanpa menulis apa pun lagi.
2. Muat connection; jika disabled, run `cancelled`. Buka secret lewat `secret-box`.
3. Discovery semua halaman. Upsert `external_sites` (`last_discovered_at`). Jika semua halaman berhasil, set `last_seen_in_complete_discovery_at`. Jika ada halaman gagal, discovery `partial`: site yang tidak terlihat tidak ditandai hilang.
4. Untuk setiap external site: `collectSiteSnapshot`; upsert gateway dan WAN; pastikan `observation_sources` `provider_api` per stream (`stream_key = unifi:<connectionId>:<siteId>:<wanKey>:<family>`); ingest lewat `IngestionService` (spec 0004). Site tanpa binding aktif tetap di inventory, evidence tersimpan dengan `office_id` null dan tidak eligible (AC-NR-005). Kegagalan satu site menjadi issue, lanjut site berikutnya.
5. Setelah setiap site, tulis `checkpoint` (site terakhir, cursor) dan `counts` (`sites`, `gateways`, `wans`, `observations`, `changes`, `errors`).
6. Akhir: `succeeded` jika tanpa issue, `partial` jika ada issue tetapi ada data valid, `failed` jika probe atau auth gagal atau tidak ada site yang diproses. Perbarui `provider_connections.status`, `last_attempt_at`, `last_success_at`, `consecutive_failures`, `backoff_until`, `next_sync_at`. Status `failed` menulis event `sync_failed.v1`.

Retry per request: hanya untuk timeout, error jaringan, 429, dan 5xx; maksimal `provider_max_retries` (default 2) tambahan; backoff eksponensial 1 detik kali 2 dengan full jitter, dibatasi 30 detik; `Retry-After` dihormati sampai 60 detik; lebih dari itu, run berhenti `partial` atau `failed` dengan reason `RATE_LIMITED` dan connection `rate_limited` dengan `backoff_until`. 401 dan 403 tidak di retry: connection `auth_failed`, run `failed`.

Anggaran per run: maksimal 1000 request dan 10 menit. Melewati anggaran menjadi `partial` dengan issue `RUN_BUDGET_EXCEEDED`.

Backoff connection setelah run gagal berturut: `backoff_until = now() + min(2^consecutive_failures × poll_interval, 1 jam)`.

### CLI `sync:once`

`scripts/sync-once.ts`, koneksi `DATABASE_URL_WORKER`:
- Tanpa argumen: proses semua run `queued` yang ada saat mulai, satu per satu, lalu keluar.
- `--connection <id>`: antrekan run manual untuk connection itu (lewat service yang sama dengan route) lalu proses.
- `--enqueue-due`: antrekan connection yang `next_sync_at <= now()` lalu proses (pengganti jadwal sampai worker ada).
- Log JSON ke stdout; ringkasan run di akhir.

### API surface

Route ada di spec 0007; yang khusus adapter dan sync:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/network-registry/providers` | GET | | katalog provider: code, nama, availability, access mode, capability yang dideskripsikan | `nr.view` | 401 |
| `/api/network-registry/connections` | POST | `name`, `providerCode`, `accessMode`, `apiKey` (write only), `pollIntervalSeconds?` | connection tanpa secret, status `unverified` | `nr.connections.manage` | 422 `PROVIDER_NOT_AVAILABLE`, 409 `NAME_TAKEN` |
| `/api/network-registry/connections/:id/test` | POST | | `capabilityReport`, `status` | `nr.connections.manage` | 502 `PROVIDER_AUTH_FAILED`, 503 `PROVIDER_RATE_LIMITED`, 504 `PROVIDER_TIMEOUT` |
| `/api/network-registry/connections/:id/rotate-credential` | POST | `apiKey`, `version` | connection tanpa secret | `nr.connections.manage` | 409 `VERSION_CONFLICT` |
| `/api/network-registry/connections/:id/sync` | POST | | 202 `{ runId, deduplicated }` | `nr.sync.execute` | 409 `CONNECTION_DISABLED` |
| `/api/network-registry/sync-runs` | GET | `cursor`, `limit`, `connectionId?`, `status?`, `from?`, `to?` | `items[]`, `nextCursor` | `nr.view` tanpa batas kantor | 403 |
| `/api/network-registry/sync-runs/:id` | GET | | run lengkap: status, counts, issues, checkpoint, correlationId | `nr.view` tanpa batas kantor | 404 |
| `/api/network-registry/sync-runs/:id/retry` | POST | | 202 run baru `trigger='retry'`, `retry_of` | `nr.sync.execute` | 409 `RUN_NOT_FINISHED` |
| `/api/network-registry/sync-runs/:id/cancel` | POST | | run | `nr.sync.execute` | 409 `RUN_FINISHED` |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Test connection | capability report | `adapter.probe()`, disimpan di `provider_connections.capability_report` |
| Sync | API key | `connection_secrets` dibuka `secret-box` dengan kunci `key_id` dari `NR_SECRET_KEYS` |
| Sync | `lease_owner` | `<hostname>:<pid>:<uuid proses>` |
| Sync | timeout request | `settings.provider_request_timeout_s` |
| Sync | `next_sync_at` | `now() + poll_interval_s ± random(jitter_s)` |
| Sync | `stream_key` | Format di atas dari connection id, external site id, WAN key, family |
| Sync | `office_id` evidence | Binding aktif external site saat commit ingestion |
| Sync | `source_observed_at` | Field waktu upstream hanya jika capability `source_timestamp` sudah `supported`; selain itu null dan `timestamp_quality = 'unknown'` |
| Sync | `received_at` | Waktu server saat respons snapshot site diterima |
| Status run di UI | progres | `sync_runs.counts` dan `checkpoint` |
| Error di UI | ringkasan | `sync_runs.error_summary` dan `issues` tersanitasi (tanpa header, key, atau body mentah) |
| Sync now | `correlation_id` run | Correlation id request yang mengantrekan |

**Key invariants**:
- Paling banyak satu run `queued` atau `running` per connection (partial unique, spec 0002).
- Run yang kehilangan lease tidak menulis apa pun lagi.
- Tidak ada penghapusan data karena site, gateway, WAN, atau field tidak muncul di respons.
- API key tidak pernah ada di response, log, issue, metrik, fixture, atau audit.
- Adapter tidak menulis database; hanya mengembalikan model kanonik.

**Security model**:
- Test, rotate, dan create butuh `nr.connections.manage` (tanpa batas kantor). Sync, retry, cancel butuh `nr.sync.execute`.
- Klien egress dengan allowlist host dan pemeriksaan DNS mencegah SSRF walaupun konfigurasi bocor.
- Secret dibuka hanya di memori proses yang menjalankan run atau test, tidak disimpan di cache antar run.

**Configuration required**:
- `NR_PROVIDER_ALLOWED_HOSTS`: default `api.ui.com`.
- `NR_SECRET_KEYS`: dari spec 0004.
- `DATABASE_URL_WORKER`: untuk CLI.

**Critical test scenarios**:
- Happy path: fixture dua halaman sites, satu site dengan gateway; test lalu sync; site tepat sekali, gateway tersimpan, capability `unverified` untuk WAN terlihat, verifies **AC-NR-005**, **AC-NR-004**, **AC-UNI-01**.
- Failure case: halaman kedua timeout; site ketiga 500 setelah retry; run `partial`, site lain tersimpan, tidak ada yang dihapus, verifies **AC-NR-039**, **AC-NR-038**.
- Failure case: 429 dengan `Retry-After: 5` lalu sukses; 401 langsung `auth_failed` tanpa retry, verifies **AC-NR-038**.
- Konkurensi: dua proses `sync:once` dan satu Sync now bersamaan; satu run efektif; proses dimatikan di tengah, lease kedaluwarsa, run diulang tanpa event ganda, verifies **AC-NR-037**, **AC-NR-040**, **AC-UNI-05**.
- Isolasi: dua connection dengan fixture berbeda dan key berbeda; state dan error terpisah, verifies **AC-NR-002**.
- Security: host lain, redirect, DNS ke 169.254.169.254 ditolak; pencarian API key di log dan response kosong, verifies **AC-UNI-02**, **AC-UNI-06**.
- Live: compatibility capture di UDR nyata atau `BLOCKED`, verifies **AC-NR-008**.

## Build plan

1. (T1) `SyncRunner` dengan klaim, lease, checkpoint, counts, state machine; dijalankan dengan fake provider, satisfies **AC-NR-037**, **AC-NR-040**
2. (T1) CLI `scripts/sync-once.ts` dengan `--connection` dan `--enqueue-due`, satisfies **AC-UNI-04**
3. (T1) Route create connection, sync now dengan dedup, get sync run, satisfies **AC-UNI-05**
4. (T2) `packages/platform/egress-http` dengan allowlist, redirect manual, pemeriksaan DNS, satisfies **AC-UNI-02**
5. (T2) Klien Site Manager: header, timeout, retry, backoff, `Retry-After`, pagination, satisfies **AC-NR-038**
6. (T2) Schema upstream, mapper, capability matriks awal `unverified`, issue `CAPABILITY_UNVERIFIED` dan `UPSTREAM_SCHEMA_MISMATCH`, satisfies **AC-NR-004**, **AC-UNI-03**
7. (T2) Discovery lengkap dan parsial, snapshot per site dengan isolasi kegagalan, satisfies **AC-NR-005**, **AC-NR-039**
8. (T2) Route test connection dan rotate credential dengan audit, satisfies **AC-UNI-01**, **AC-UNI-06**
9. (T2) Disable connection membatalkan run queued, satisfies **AC-UNI-07**
10. (T2) Contract test dengan fixture tersanitasi (halaman, missing gateway, missing egress, rate limit, schema berubah, API key gagal), dua connection terisolasi, satisfies **AC-NR-002**, **AC-NR-038**, **AC-NR-039**
11. (T4) Retry dan cancel run, satisfies **AC-NR-037**
12. (T7) Compatibility capture di UDR nyata, isi `docs/compatibility/unifi.md`, naikkan capability yang terbukti, satisfies **AC-NR-008**

## Consequences

**Positive**:
- Tidak ada klaim kemampuan tanpa bukti; UI jujur tentang apa yang belum didukung.
- Satu `SyncRunner` dipakai CLI dan worker, jadi worker nanti hanya menambah jadwal dan loop.

**Negative / tradeoffs**:
- Sampai compatibility capture selesai, polling UniFi mungkin tidak menghasilkan evidence IP eligible sama sekali; nilai registry pada fase awal bergantung pada heartbeat.
- Tanpa worker, jadwal otomatis tidak ada; operator harus menjalankan `sync:once --enqueue-due` (misalnya lewat cron host) sampai fase T6.
- Local API tidak didukung, jadi site tanpa akun cloud UniFi tidak bisa dipolling.

**Neutral**:
- Batas rate limit Site Manager diambil dari dokumentasi dan dikonfirmasi di compatibility capture, bukan ditebak.

## Follow-up

- [ ] Compatibility capture di Dream Router nyata (OQ-NR-001, OQ-NR-002). Tanpa itu AC-NR-008 `BLOCKED` dan status produksi tidak boleh diklaim.
- [ ] Evaluasi mode Local API setelah V1 jika ada kantor tanpa akun cloud (spec baru, butuh allowlist host dan CA privat).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
