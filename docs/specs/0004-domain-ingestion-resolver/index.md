# 0004. Domain kanonik, ingestion, history, dan resolver

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini adalah inti Network Registry. Semua sumber (polling UniFi dan heartbeat) diubah ke satu model kanonik yang tidak mengenal vendor, lalu melewati satu jalur ingestion: validasi, parsing IP, dedup, simpan evidence, perbarui periode pengamatan, dan tulis event ke outbox dalam satu transaksi. Resolver membaca periode yang masih berlaku dan menjawab `matched`, `ambiguous`, `stale`, `unknown`, atau `unavailable` beserta alasan dan evidence, tanpa pernah memanggil API vendor dan tanpa pernah mengklaim kehadiran fisik. Fake adapter khusus test membuktikan domain ini benar benar vendor netral.

## Requirements

**User stories**:
- As a network administrator, I want setiap IP yang teramati tercatat dengan sumber, waktu, dan maknanya so that saya bisa menelusuri kapan dan dari mana bukti datang.
- As an auth service, I want bertanya "kantor mana yang mungkin terkait IP ini" dan menerima jawaban jujur so that audit login punya konteks tanpa kepastian palsu.
- As a developer, I want menambah provider baru cukup dengan adapter dan mapper so that domain matching dan history tidak ikut berubah.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-DOM-*`):
- **AC-NR-003**: Fake provider dengan format upstream berbeda, didaftarkan lewat registry, membuat ingestion, history, dan resolver bekerja tanpa perubahan domain atau route bisnis.
- **AC-NR-009**: Sample IP A baru lalu IP A lagi: `last_seen_at` bertambah, event `ip_changed` tidak bertambah.
- **AC-NR-010**: Stream single egress terverifikasi menerima A, B, A: tiga periode terpisah, evidence utuh, jendela deteksi ditampilkan, bukan waktu perubahan pasti.
- **AC-NR-011**: Receipt baru untuk sample upstream lama yang sama tidak memperpanjang freshness.
- **AC-NR-012**: Sample lama atau clock skew yang tiba setelah sample baru tidak memundurkan projection; sample masa depan lebih dari 120 detik di quarantine.
- **AC-NR-013**: Dua WAN aktif; WAN1 berubah atau WAN2 tidak ada di respons parsial: data WAN lain tidak tertimpa atau terhapus.
- **AC-NR-014**: WAN assigned private atau shared disimpan dengan klasifikasi benar dan tidak menjadi kandidat match.
- **AC-NR-015**: IPv4 mapped IPv6 dan representasi valid lain dinormalisasi konsisten; invalid, CIDR, zone id, dan port ditolak.
- **AC-NR-016**: Hanya IPv6 router yang diketahui; IPv6 lain di subnet serupa tidak menjadi match prefix; keterbatasan cakupan terlihat.
- **AC-NR-017**: Heartbeat dari jalur tak teridentifikasi dengan IP berbeda: evidence tersimpan, WAN lain tidak dihapus, tidak ada klaim failover.
- **AC-NR-018**: API dan heartbeat melaporkan IP berbeda: provenance terpisah, ketidakpastian rute terlihat, tanpa last write wins.
- **AC-NR-019**: Satu site dengan beberapa evidence eligible untuk IP sama: `matched`, evidence references, `isPhysicalPresenceVerified: false`.
- **AC-NR-020**: Dua site dengan IP sama: `ambiguous`, `siteId` null, tidak memilih kandidat pertama.
- **AC-NR-022**: TTL berakhir: hasil `stale` atau `unknown`, tidak lagi `matched`.
- **AC-NR-023**: Database gagal: `unavailable`, dibedakan dari `unknown`.
- **AC-NR-024**: Kandidat lain disamarkan oleh batas kantor: ambiguity tetap, rincian terlarang tidak bocor.
- **AC-NR-026**: Provider outage: tidak ada panggilan HTTP vendor di jalur resolver.
- **AC-NR-027**: Source atau connection disabled, bukti di quarantine, atau site di remap: eligibility berubah seketika; history tetap; re enable butuh bukti baru.
- **AC-DOM-01**: Semua kode di `packages/registry-core/src/domain` dan `src/application` lolos test arsitektur yang menolak import dari `src/providers/*`.
- **AC-DOM-02**: Operasi adapter yang tidak didukung melempar `CapabilityUnsupportedError`, bukan mengembalikan array kosong (mendukung AC-NR-004).
- **AC-DOM-03**: Ingestion memeriksa ulang status enabled source, epoch, binding aktif, dan credential di dalam transaksi commit; disable atau revoke yang terjadi bersamaan tidak menghasilkan evidence eligible (mendukung AC-NR-032).
- **AC-DOM-04**: Setiap perubahan settings dan setiap aksi admin yang disebut REQ-NR-011 menulis audit tersanitasi di transaksi yang sama dengan perubahannya.

## Decision

**Chosen option**: Option 1: Evidence immutable plus projection periode per stream dengan compare and set, resolver query langsung tanpa cache.

Setiap sample disimpan sebagai evidence yang tidak pernah diubah, dan satu tabel `ip_periods` menjadi projection history sekaligus sumber kandidat resolver, diperbarui di bawah row lock per stream.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) hanya untuk pemanggil di route; domain tidak bergantung pada Elysia.

## Feature design

### Letak kode

```text
packages/registry-core/src/
├── domain/          # tipe kanonik, policy murni (freshness, eligibility, transisi periode, reason code)
├── application/     # IngestionService, ResolverService, ConnectionService, BindingService, SourceService, AuditWriter, OutboxWriter
├── repositories/    # SQL Bun.SQL per agregat
├── providers/
│   ├── registry.ts  # ProviderRegistry: code → adapter factory
│   └── unifi/       # spec 0005
├── ip/              # parseHostAddress, classify (ipaddr.js)
└── testing/fake-provider/   # hanya diimpor test dan mode dev yang dijaga
```

### Kontrak provider

```ts
interface ProviderAdapter {
  descriptor: { code: string; displayName: string; accessModes: string[]; availability: 'available' | 'planned' };
  probe(ctx: ProviderContext): Promise<CapabilityReport>;
  discoverSites(ctx: ProviderContext, cursor?: string): Promise<{ sites: ExternalSiteRecord[]; nextCursor?: string }>;
  collectSiteSnapshot(ctx: ProviderContext, site: ExternalSiteRef): Promise<SiteSnapshot>;
}
interface ProviderContext {
  connectionId: string; config: unknown; getSecret(): Promise<string>;
  signal: AbortSignal; http: EgressHttpClient; logger: Logger; now(): Date;
}
```

- `ProviderRegistry` hanya mendaftarkan `unifi` di produksi. Katalog juga menampilkan `meraki`, `mikrotik`, `fortinet` sebagai `planned` tanpa adapter (REQ-NR-001).
- Fake provider (`code: 'fake'`) memakai format upstream berbeda (objek bersarang dengan nama field lain) dan hanya terdaftar jika `NR_ENABLE_FAKE_PROVIDER=true`. Konfigurasi startup menolak flag ini saat `NR_ENV=production`.
- `CapabilityReport` adalah map kunci capability ke `{ status: 'supported' | 'unsupported' | 'unverified', reason, apiMode, evidence: { docsRef, verifiedAt, firmware? } }`. Kunci: `authenticate`, `discover_sites`, `host_identity`, `gateway_inventory`, `wan_identification`, `wan_assigned_address`, `public_egress_address`, `multi_wan`, `ipv6_host_address`, `source_timestamp`, `health_metadata`.
- `SiteSnapshot` mengikuti INT-NR-003: `providerCode, connectionId, externalHostId?, externalSiteId, sourceSnapshotId?, sourceObservedAt?, fetchedAt, timestampQuality, completeness, capabilityReport, gatewayRecords[], wanRecords[], addressObservations[], issues[]`. `completeness` per stream: `{ streamKey, status: 'complete' | 'partial' | 'unknown' }`.

### Parser dan klasifikasi IP

`parseHostAddress(input: string)` di `src/ip/`:
- Tolak jika ada spasi, `/` (CIDR), `%` (zone id), atau pola port (`a.b.c.d:port`, `[v6]:port`).
- IPv4 wajib empat bagian desimal (`ipaddr.IPv4.isValidFourPartDecimal`); bentuk oktal, hex, atau singkat ditolak.
- IPv6 diparse `ipaddr.IPv6.parse`; IPv4 mapped (`::ffff:a.b.c.d`) dinormalisasi ke IPv4.
- Output `{ address: string (IPv4 dotted atau IPv6 RFC 5952), family: 4 | 6, classification }`.
- Klasifikasi dari `range()` ipaddr.js dipetakan ke `public`, `private`, `shared` (100.64.0.0/10), `loopback`, `link_local`, `unique_local`, `multicast`, `reserved`, `unspecified`, ditambah pengecekan eksplisit `documentation` (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32).
- Alamat `documentation` hanya boleh eligible jika `NR_ALLOW_DOCUMENTATION_ADDRESSES=true`, yang ditolak startup saat `NR_ENV=production` (fixture policy PRD bagian 6).

### Policy eligibility (policy version `1`)

Periode eligible untuk current matching jika semua benar:
1. `classification = 'public'` (atau `documentation` dengan flag test).
2. `role = 'egress_public'` (basis `observed_egress`), atau `role = 'wan_assigned'` dengan klasifikasi public (basis `wan_assigned_public`).
3. `status = 'open'` dan `expires_at > now()`.
4. Source `enabled` dan `ip_periods.source_epoch = observation_sources.enabled_epoch`.
5. Untuk `provider_api`: connection `enabled` dan `ip_periods.binding_id` sama dengan binding aktif external site saat ini.
6. Evidence terakhir punya `timestamp_quality` `upstream`, atau `receipt_based` dari source heartbeat dengan `ingress_status` trusted.

`expires_at = effective_time + expected_interval_s × freshness_multiplier`, dengan `effective_time = source_observed_at` untuk `upstream` dan `received_at` untuk `receipt_based`.

### Alur ingestion (satu transaksi per stream batch)

`IngestionService.ingest(batch: CanonicalObservationBatch, auth: IngestionAuth)`:

1. Parse dan klasifikasi setiap alamat; alamat invalid menjadi issue, tidak disimpan.
2. `SELECT ... FROM observation_sources WHERE id = $1 FOR SHARE`; untuk heartbeat juga `heartbeat_credentials ... FOR SHARE`; untuk polling juga `provider_connections ... FOR SHARE` dan binding aktif `FOR SHARE`. Jika disabled, dicabut, atau epoch berubah: batch ditolak (`SOURCE_DISABLED`, `CREDENTIAL_REVOKED`) atau, untuk polling, dicatat sebagai issue run. Lock ini membuat revoke dan disable yang bersamaan menunggu atau terlihat.
3. Hitung `dedup_key` dan `fingerprint` (SHA-256 dari alamat, role, source_observed_at, source_sample_id, dan untuk heartbeat IP ingress). `INSERT INTO observation_dedup ... ON CONFLICT DO NOTHING RETURNING`. Konflik dengan fingerprint sama: replay idempotent, kembalikan `observation_id` lama, tidak ada event. Fingerprint beda: `IDEMPOTENCY_CONFLICT`.
4. Tentukan eligibility evidence: `quarantined` dengan reason `FUTURE_TIMESTAMP` jika `source_observed_at > received_at + clock_skew_tolerance_s`; `ineligible` untuk klasifikasi non public, ingress unresolved, atau `timestamp_quality = 'unknown'`.
5. Insert `ip_observations` dengan `office_id`, `binding_id`, `source_epoch` saat ini.
6. Jika evidence bukan `quarantined`: `SELECT ... FROM ip_periods WHERE source_id = $1 AND stream_key = $2 AND status = 'open' FOR UPDATE`, lalu terapkan transisi di bawah.
7. Tulis event outbox dan perbarui `observation_sources.last_observation_at` (hanya jika maju).

Transisi periode (fungsi murni `decidePeriodTransition` di `domain/`, diuji unit):

| Kondisi | Aksi | Event |
|---|---|---|
| Tidak ada periode terbuka untuk alamat ini di stream | Buka periode baru; jika ada periode terbuka alamat lain di stream, isi `previous_period_id` dan `detection_window_start = previous.last_seen_at` | `ip_observed.v1`; `ip_conflict_detected.v1` jika alamat punya periode eligible di kantor lain |
| Alamat sama, `effective_time > last_seen_at` | `last_seen_at`, `expires_at`, `last_evidence_id`, `observation_count` maju (compare and set lewat `version`) | tidak ada |
| Alamat sama, `effective_time <= last_seen_at` | Evidence disimpan, projection tidak berubah | tidak ada |
| Alamat berbeda, stream `single_egress_verified`, snapshot `complete` untuk stream, `effective_time > previous.last_seen_at` | Tutup periode lama (`status = 'closed'`, `close_reason = 'replaced_in_verified_stream'`, `closed_at = effective_time`), buka periode baru | `ip_changed.v1` |
| Alamat berbeda, stream `unidentified` atau snapshot tidak complete | Buka periode baru paralel; periode lama dibiarkan sampai kedaluwarsa; reason `EGRESS_PATH_UNCERTAIN` | `ip_observed.v1` |
| Alamat berbeda, `effective_time` lebih tua dari periode terbuka | Evidence disimpan sebagai `ineligible` reason `OUT_OF_ORDER_SAMPLE`, projection tidak berubah | tidak ada |

A lalu B lalu A pada stream terverifikasi membuka periode ketiga untuk A (bukan membuka ulang yang pertama), sehingga tiga urutan tetap terlacak. Snapshot polling parsial tidak menutup periode stream yang tidak muncul (BR-NR-007).

### Aksi yang mengubah eligibility

- Disable source atau connection: set `enabled = false`, audit, invalidasi otomatis karena eligibility dihitung saat baca.
- Enable ulang: set `enabled = true` dan `enabled_epoch + 1`; periode lama tidak lagi eligible karena epoch beda, jadi resolver menunggu evidence baru.
- Quarantine source (dugaan credential bocor): disable source plus ubah periode terbuka menjadi `status = 'quarantined'`, audit.
- Remap binding: binding lama `effective_to = now()`, binding baru dibuat; periode dengan `binding_id` lama berhenti eligible seketika, evidence lama tetap menunjuk binding lama.

### Resolver

`ResolverService.resolve({ address, at?, viewer })`:

1. `parseHostAddress`; invalid menjadi 422 di route.
2. Query dengan `statement_timeout` 500 ms:
   `SELECT` periode `WHERE address = $1` beserta source, connection, binding aktif, kantor. Untuk `at`: periode dengan `first_seen_at <= at AND last_seen_at >= at`, dibatasi retensi history.
3. Bagi menjadi current eligible dan historis (gagal hanya karena `expires_at`).
4. Kelompokkan per `office_id`. Status: satu kantor current menjadi `matched`; lebih dari satu menjadi `ambiguous`; nol current tetapi ada historis menjadi `stale`; selain itu `unknown`. Error database atau timeout menjadi `unavailable` dengan reason `DEPENDENCY_UNAVAILABLE`.
5. Hitung ambiguity sebelum proyeksi. Lalu proyeksikan ke viewer: kandidat di luar batas kantor viewer menjadi `{ masked: true }` tanpa id, nama, atau evidence; reason `CANDIDATES_MASKED` ditambahkan. Status tidak pernah berubah karena masking.
6. `siteId` hanya diisi untuk `matched`, selain itu `null`.

Reason code deterministik: `ONE_RECENT_CANDIDATE`, `MULTIPLE_CANDIDATES`, `ONLY_EXPIRED_EVIDENCE`, `NO_ELIGIBLE_EVIDENCE`, `SHARED_EGRESS_POSSIBLE` (selalu menyertai `matched`), `EGRESS_PATH_UNCERTAIN`, `BASIS_WAN_ASSIGNED_ONLY`, `IPV6_COVERAGE_LIMITED` (alamat IPv6 dan tidak ada source dengan cakupan IPv6), `CANDIDATES_MASKED`, `HISTORICAL_OBSERVATION`, `DEPENDENCY_UNAVAILABLE`. Tidak ada skor confidence.

Kontrak hasil:

```json
{
  "status": "matched",
  "siteId": "<office uuid>",
  "candidates": [{ "siteId": "<uuid>", "officeCode": "JKT01", "evidenceIds": ["<uuid>"], "basis": "observed_egress", "expiresAt": "..." }],
  "maskedCandidateCount": 0,
  "basis": "registry_ip_observation",
  "reasons": ["ONE_RECENT_CANDIDATE", "SHARED_EGRESS_POSSIBLE"],
  "isPhysicalPresenceVerified": false,
  "resolvedAt": "2026-09-28T03:00:00Z",
  "policyVersion": "1"
}
```

### Event outbox

Nama `network_registry.<event>.v1`: `ip_observed`, `ip_changed`, `source_stale`, `source_recovered`, `ip_conflict_detected`, `sync_failed`. Payload berisi id (periode, source, kantor, run), alamat, waktu, reason; tanpa secret dan tanpa data user. `source_stale` dan `source_recovered` ditulis worker (spec 0009). `sync_failed` ditulis sync runner (spec 0005). Event id = `outbox_events.id`, jadi replay tidak menggandakan.

### Settings

Kunci yang diizinkan (tabel `network_registry.settings`, divalidasi aplikasi, perubahan diaudit):

| Kunci | Default | Batas |
|---|---|---|
| `default_poll_interval_s` | 300 | 60 sampai 86400 |
| `default_jitter_s` | 30 | 0 sampai interval/2 |
| `freshness_multiplier` | 3 | 2 sampai 10 |
| `provider_request_timeout_s` | 10 | 1 sampai 60 |
| `provider_max_retries` | 2 | 0 sampai 5 |
| `clock_skew_tolerance_s` | 120 | 0 sampai 3600 |
| `raw_observation_retention_days` | 30 | 7 sampai 365 |
| `ip_history_retention_days` | 365 | 30 sampai 3650 |
| `sync_run_retention_days` | 90 | 7 sampai 3650 |

### Audit

`AuditWriter.write(tx, entry)` menulis `core.audit_logs` di transaksi yang sama. Before dan after melewati sanitizer yang membuang kunci yang cocok `secret|token|password|apiKey|ciphertext|nonce|hash`. Aksi yang wajib diaudit: connection create, update, enable, disable, rotate, test, sync manual; binding bind, unbind, remap; source create, update, disable, quarantine, routing assertion; credential create, revoke; settings update; ditambah aksi IAM di spec 0003.

### API surface

Spec ini tidak menambah route sendiri; service dipanggil route di spec 0007 (`/diagnostics/resolve`, `/internal/network-registry/resolve`, `/ip-history`, `/sites`), heartbeat (spec 0006), dan sync (spec 0005).

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Ingest | `office_id`, `binding_id` observasi | Heartbeat: `observation_sources.office_id`. Polling: binding aktif `external_site_id` saat commit |
| Ingest | `source_epoch` | `observation_sources.enabled_epoch` saat commit |
| Ingest | `effective_time` | `source_observed_at` jika `timestamp_quality = 'upstream'`, selain itu `received_at` |
| Ingest | `received_at` | `now()` server saat request diterima (heartbeat) atau saat respons diterima (polling) |
| Ingest | TTL | `observation_sources.expected_interval_s × settings.freshness_multiplier` |
| Ingest | role dan klasifikasi | Role dari adapter atau `egress_public` untuk heartbeat; klasifikasi dari `parseHostAddress` |
| Ingest | routing assertion | `observation_sources.routing_assertion` |
| Ingest | completeness stream | `SiteSnapshot.completeness` dari adapter; heartbeat selalu `unknown` |
| Resolve | scope viewer | Konteks auth (spec 0003): kantor diizinkan; service token berarti semua kantor |
| Resolve | `resolvedAt` | `now()` server |
| Resolve | `policyVersion` | Konstanta `RESOLVER_POLICY_VERSION = '1'` di `domain/` |
| Resolve | `officeCode` kandidat | `org.offices.code` |
| Resolve | `IPV6_COVERAGE_LIMITED` | Tidak ada `observation_sources` enabled dengan `address_family = 6` atau periode IPv6 eligible dalam retensi |
| Resolve historis | batas `at` | `now() - settings.ip_history_retention_days`; lebih tua menjadi 422 `OUT_OF_RETENTION` |
| Sync failed event | ringkasan | `sync_runs.error_summary` tersanitasi |

**Key invariants**:
- Evidence tidak pernah diubah setelah insert, termasuk kolom eligibility yang ditetapkan saat insert. Quarantine berlaku di `ip_periods`, bukan di evidence.
- `ip_periods.last_seen_at` dan `expires_at` hanya maju.
- Hanya stream terverifikasi dengan snapshot complete yang boleh menutup periode karena pergantian alamat.
- Resolver tidak pernah memanggil HTTP; `packages/registry-core/src/application/resolver*` tidak boleh mengimpor `providers/` atau `EgressHttpClient` (test arsitektur).
- `matched` selalu disertai `isPhysicalPresenceVerified: false` dan `SHARED_EGRESS_POSSIBLE`.

**Security model**:
- Service domain menerima `viewer` eksplisit (kantor diizinkan); repository wajib menerima filter kantor dan test memastikan tidak ada query domain tanpa filter kecuali untuk viewer tanpa batas.
- Secret tidak pernah masuk model kanonik; adapter mengambilnya lewat `ctx.getSecret()` yang membuka ciphertext (`packages/platform/secret-box`, AES-256-GCM, kunci dari `NR_SECRET_KEYS`).

**Configuration required**:
- `NR_SECRET_KEYS`: daftar `keyId:base64(32 byte)`; kunci pertama untuk enkripsi baru, semua untuk dekripsi.
- `NR_ENABLE_FAKE_PROVIDER`: hanya development dan test.
- `NR_ALLOW_DOCUMENTATION_ADDRESSES`: hanya test.

**Critical test scenarios**:
- Happy path: fake provider mengirim snapshot dengan satu WAN public; ingest; resolve menjadi `matched` dengan evidence, verifies **AC-NR-003**, **AC-NR-019**.
- History: urutan A, A, B, A pada stream terverifikasi dan tidak terverifikasi; periksa jumlah periode, event, dan jendela deteksi, verifies **AC-NR-009**, **AC-NR-010**, **AC-NR-017**.
- Waktu: receipt baru untuk sample lama; sample lebih tua tiba belakangan; sample 10 menit di masa depan, verifies **AC-NR-011**, **AC-NR-012**.
- Multi WAN dan konflik sumber: WAN2 hilang di snapshot parsial; heartbeat dan API beda IP, verifies **AC-NR-013**, **AC-NR-018**.
- Parser: tabel kasus valid dan invalid (oktal, CIDR, zone, port, mapped), verifies **AC-NR-015**, **AC-NR-014**, **AC-NR-016**.
- Resolver: dua kantor IP sama; TTL lewat dengan clock tiruan; database dimatikan; viewer terbatas satu kantor dari dua kandidat, verifies **AC-NR-020**, **AC-NR-022**, **AC-NR-023**, **AC-NR-024**.
- Eligibility: disable, enable ulang tanpa bukti baru, quarantine, remap, verifies **AC-NR-027**.
- Konkurensi: revoke credential di transaksi lain saat ingestion menunggu lock, verifies **AC-DOM-03**.
- Arsitektur: domain tidak mengimpor providers; resolver tidak mengimpor HTTP, verifies **AC-DOM-01**, **AC-NR-026**.

## Build plan

1. (T1) `packages/platform`: config, logger JSON dengan redaksi, clock, error dasar, `secret-box` AES-256-GCM dengan key id, satisfies **AC-DOM-04**
2. (T1) `src/ip/` parser dan klasifikasi dengan test tabel, satisfies **AC-NR-014**, **AC-NR-015**, **AC-NR-016**
3. (T1) Tipe kanonik, `CapabilityReport`, `CapabilityUnsupportedError`, `ProviderRegistry`, fake provider dengan format upstream berbeda, satisfies **AC-NR-003**, **AC-DOM-02**
4. (T1) `decidePeriodTransition` dan policy eligibility sebagai fungsi murni dengan test unit, satisfies **AC-NR-009**, **AC-NR-010**, **AC-NR-011**, **AC-NR-012**, **AC-NR-017**
5. (T1) `IngestionService` dengan lock, dedup, evidence, projection, outbox, satisfies **AC-NR-009**, **AC-NR-012**, **AC-NR-013**, **AC-NR-018**, **AC-DOM-03**
6. (T1) `ResolverService` current dengan grouping, status, reason, masking, satisfies **AC-NR-019**, **AC-NR-020**, **AC-NR-022**, **AC-NR-023**, **AC-NR-024**
7. (T1) `AuditWriter` dan `OutboxWriter` dengan sanitizer, satisfies **AC-DOM-04**
8. (T1) Test arsitektur import, satisfies **AC-DOM-01**, **AC-NR-026**
9. (T4) Aksi eligibility: disable, enable dengan epoch, quarantine, remap, satisfies **AC-NR-027**
10. (T4) Resolver historis `at` dengan batas retensi, satisfies **AC-NR-022**
11. (T5) Service settings dengan validasi dan audit, satisfies **AC-DOM-04**

## Consequences

**Positive**:
- Satu jalur ingestion untuk polling dan heartbeat; semua aturan waktu dan history diuji di satu tempat.
- Eligibility dihitung saat baca, jadi disable, remap, dan TTL berlaku seketika tanpa cache untuk diinvalidasi.
- Resolver tidak bisa gagal karena vendor; hanya database yang menjadi dependensinya.

**Negative / tradeoffs**:
- Query resolver melakukan join ke source, connection, dan binding pada setiap request; performa harus dibuktikan dengan benchmark (AC-NR-044).
- Stream tak teridentifikasi bisa punya beberapa periode terbuka sekaligus sampai TTL habis, sehingga satu kantor tampak punya beberapa IP; ini disengaja tetapi perlu dijelaskan di UI.
- Kunci enkripsi di env berarti siapa pun yang membaca env container backend atau worker bisa membuka API key.

**Neutral**:
- Menambah provider cukup dengan adapter di `providers/<vendor>/` dan satu baris di registry.

## Follow-up

- [ ] Putuskan apakah basis `wan_assigned_public` tetap eligible setelah compatibility report UniFi selesai; jika field WAN terbukti bukan egress, ubah policy ke versi `2`.
- [ ] Prosedur rotasi `NR_SECRET_KEYS` (tambah kunci baru, re encrypt semua `connection_secrets`, hapus kunci lama) ditulis di runbook.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
