# 0006. Heartbeat, trusted ingress, dan reference collector

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan jalur kedua untuk mengamati IP keluar kantor: sebuah collector kecil di jaringan kantor mengirim heartbeat HTTPS ke backend, dan backend mencatat IP sumber request yang benar benar diterima. Identitas kantor dan source ditentukan oleh credential collector, bukan oleh isi body. Cara mengambil IP sumber diatur eksplisit lewat konfigurasi trusted proxy, dan jika rantai proxy tidak bisa dipastikan, observasi ditandai `unresolved` dan tidak dipakai matching. Collector dibangun sebagai satu binary Bun plus image Docker di `apps/collector`.

## Requirements

**User stories**:
- As a network administrator, I want memasang collector di kantor dan melihat heartbeat terakhirnya so that saya punya bukti IP keluar kantor walaupun API UniFi tidak menyediakannya.
- As a security administrator, I want mencabut atau merotasi secret collector tanpa menghapus history so that credential yang bocor bisa dihentikan dengan cepat.
- As an operator, I want panduan yang jelas bahwa collector harus berjalan di jalur keluar kantor so that tidak ada yang salah memasangnya di pusat.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-HB-*`):
- **AC-NR-029**: Collector kantor dengan credential sah: IP sumber dari server dan kantor dari credential disimpan, bukan IP atau kantor dari body.
- **AC-NR-030**: `X-Forwarded-For` atau `Forwarded` palsu, atau request langsung ke origin yang tidak dipercaya: header palsu tidak menetapkan IP kantor. Diuji untuk koneksi langsung dan rantai proxy tepercaya.
- **AC-NR-031**: `eventId` sama dari source sama: satu ingestion dan satu event logis; `eventId` sama dengan isi atau IP sumber berbeda: 409 conflict.
- **AC-NR-032**: Credential dicabut atau kedaluwarsa, atau source lain: ditolak dan tidak menambah evidence eligible, termasuk race saat commit; key baru hasil rotasi tetap bisa dipakai dan history tidak berubah.
- **AC-NR-033**: Secret heartbeat tampil sekali saat dibuat; storage hanya hash; secret tidak muncul di response lain, log, telemetry, atau fixture.
- **AC-NR-036**: Collector dijalankan dari pusat: yang tercatat adalah egress pusat, dan panduan deployment menyatakan ini tidak memenuhi verifikasi source kantor.
- **AC-HB-01**: Heartbeat ke source yang disabled ditolak 403 `SOURCE_DISABLED` tanpa menyimpan evidence.
- **AC-HB-02**: Body lebih dari 2 KB ditolak 413; lebih dari 6 request per menit per credential ditolak 429 dengan `Retry-After`.
- **AC-HB-03**: Collector mengulang heartbeat yang gagal dengan `eventId` yang sama, maksimal 2 kali dengan backoff, timeout 10 detik, dan tidak pernah menulis token ke log.
- **AC-HB-04**: Collector menolak endpoint `http:` dan tidak punya opsi mematikan verifikasi TLS; CA privat hanya lewat `NR_COLLECTOR_CA_FILE`.
- **AC-HB-05**: Mengubah `routing_assertion` source ke `single_egress_verified` butuh `nr.collectors.manage`, wajib catatan, dan diaudit.

## Decision

**Chosen option**: Option 1: Endpoint heartbeat dengan bearer credential per source, IP sumber dari modul trusted ingress yang dikonfigurasi eksplisit, collector binary Bun.

Backend menerima heartbeat hanya dengan credential source yang aktif, menurunkan IP sumber dari socket peer atau rantai proxy yang dipercaya, lalu meneruskannya ke `IngestionService` yang sama dengan polling.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) untuk `server.requestIP` dan batas body.

## Feature design

### Modul trusted ingress

`packages/platform/ingress/resolveClientAddress(request, server, config)`:

1. `peer` = `server.requestIP(request)` (socket peer).
2. Jika `NR_CLIENT_IP_HEADER = none` (default) atau `peer` tidak termasuk `NR_TRUSTED_PROXIES`: hasil `{ address: peer, ingressStatus: 'trusted_peer' }`.
3. Jika `peer` termasuk proxy tepercaya:
   - `x-forwarded-for`: baca semua nilai header digabung, dari kanan ke kiri, lewati alamat yang termasuk `NR_TRUSTED_PROXIES`; alamat pertama yang tidak tepercaya adalah klien. Hasil `trusted_chain`.
   - `forwarded`: sama, dari parameter `for=` (RFC 7239).
   - `cf-connecting-ip`: dipakai hanya jika `peer` termasuk range Cloudflare yang dicantumkan di `NR_TRUSTED_PROXIES`.
   - Header tidak ada, rusak, atau semua hop tepercaya: `{ address: peer, ingressStatus: 'unresolved' }`.
4. Alamat hasil diparse `parseHostAddress` (spec 0004).

Modul yang sama dipakai login (IP sesi, spec 0003) dan heartbeat. Evidence dengan `ingress_status = 'unresolved'` disimpan tetapi `ineligible` (INT-NR-009). Jika origin berada di belakang Cloudflare atau load balancer, akses langsung ke origin wajib ditutup di level jaringan; ini dicatat di panduan deployment.

### Credential heartbeat

- Format `nrh_<keyId>.<secret>`: `keyId` 16 karakter base32 acak (non secret), `secret` 32 byte acak (256 bit) base64url.
- Disimpan `sha256(secret)` di `heartbeat_credentials.token_hash`; verifikasi `crypto.timingSafeEqual`.
- Default `expires_at = now() + 365 hari`; bisa diatur saat dibuat.
- Rotasi: buat credential baru (keduanya aktif), pasang di collector, cabut yang lama. Pencabutan hanya mengisi `revoked_at`; evidence lama tetap sah (BR-NR-013).
- Dugaan bocor: cabut credential dan disable atau quarantine source (spec 0004).

### Endpoint heartbeat

`POST /api/network-registry/heartbeats`, tidak memakai cookie atau sesi.

Request:

```json
{ "eventId": "0192f6c4-...", "collectorVersion": "1.0.0", "localTime": "2026-09-28T03:00:00Z" }
```

- `eventId`: string 16 sampai 64 karakter `[A-Za-z0-9_-]`, wajib. `collectorVersion` dan `localTime` opsional, disimpan sebagai metadata tidak tepercaya, tidak mempengaruhi waktu evidence.
- Field lain ditolak (schema ketat). `site_id`, `company_id`, `ip` di body ditolak 422.

Alur:
1. Batas body 2 KB, rate limit per `keyId`.
2. Parse `Authorization: Bearer nrh_...`; cari credential by `keyId`; verifikasi hash; tolak jika dicabut atau kedaluwarsa (401 `INVALID_CREDENTIAL`, pesan sama untuk semua kasus).
3. Muat source; disabled menjadi 403 `SOURCE_DISABLED`.
4. `resolveClientAddress`.
5. `IngestionService.ingest` dengan `role = 'egress_public'` jika klasifikasi public, selain itu `role = 'unknown'`; `timestamp_quality = 'receipt_based'`; `received_at = now()`; `dedup_key = eventId`; fingerprint menyertakan IP sumber. Pemeriksaan ulang credential dan source di transaksi (AC-DOM-03).
6. Perbarui `heartbeat_credentials.last_used_at` (paling sering sekali per menit).

Response 202 `{ "status": "accepted" | "duplicate", "observationId": "...", "receivedAt": "..." }`. Error: 401, 403, 409 `IDEMPOTENCY_CONFLICT`, 413, 422, 429, 503 `DEPENDENCY_UNAVAILABLE`.

### Endpoint source dan credential

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/network-registry/sources` | GET | `cursor`, `limit`, `officeId?`, `sourceType?`, `freshness?` | `items[]` dengan freshness, last heartbeat, route label, `nextCursor` | `nr.view` (difilter kantor) | 403 |
| `/api/network-registry/sources` | POST | `officeId`, `routeLabel`, `expectedIntervalSeconds?`, `addressFamily?` | source `heartbeat` | `nr.collectors.manage` | 404 office, 422 |
| `/api/network-registry/sources/:id` | PATCH | `version` (req), `enabled?`, `routeLabel?`, `expectedIntervalSeconds?`, `routingAssertion?`, `routingAssertionNote?` | source | `nr.collectors.manage` | 409 `VERSION_CONFLICT`, 422 `NOTE_REQUIRED` |
| `/api/network-registry/sources/:id/quarantine` | POST | `reason` | source disabled, periode terbuka `quarantined` | `nr.collectors.manage` | 404 |
| `/api/network-registry/sources/:id/credentials` | POST | `expiresInDays?` | `{ credentialId, keyId, token }` sekali saja, header `Cache-Control: no-store` | `nr.collectors.manage` | 404 |
| `/api/network-registry/sources/:id/credentials` | GET | | daftar credential tanpa token: keyId, dibuat, kedaluwarsa, dicabut, terakhir dipakai | `nr.collectors.manage` | 404 |
| `/api/network-registry/sources/:id/credentials/:credentialId` | DELETE | | 204, `revoked_at` diisi | `nr.collectors.manage` | 404 |
| `/api/network-registry/heartbeats` | POST | lihat di atas | 202 | credential source | 401, 403, 409, 413, 422, 429 |

Source `provider_api` dibuat otomatis oleh sync (spec 0005); endpoint POST di atas hanya untuk `heartbeat`.

### Reference collector (`apps/collector`)

| Aspek | Keputusan |
|---|---|
| Kode | `apps/collector/src/main.ts`, hanya memakai `@nr/contracts` (schema heartbeat) dan logger dari `@nr/platform` |
| Konfigurasi | `NR_COLLECTOR_ENDPOINT` (URL `https:` tetap), `NR_COLLECTOR_TOKEN` atau `NR_COLLECTOR_TOKEN_FILE` (disarankan), `NR_COLLECTOR_INTERVAL_SECONDS` (default 300), `NR_COLLECTOR_JITTER_SECONDS` (default 30), `NR_COLLECTOR_TIMEOUT_SECONDS` (default 10), `NR_COLLECTOR_CA_FILE` (opsional) |
| Siklus | Tidur `interval ± jitter`, buat `eventId` uuidv7 baru, kirim, retry maksimal 2 dengan backoff 2 lalu 4 detik ditambah jitter memakai `eventId` yang sama, lalu lanjut siklus berikutnya |
| Log | JSON ke stdout: waktu, hasil, status HTTP, durasi, `eventId`. Token dan header `Authorization` tidak pernah dicatat |
| Shutdown | `SIGTERM` dan `SIGINT` menyelesaikan request yang sedang berjalan lalu keluar |
| Health | Kode keluar bukan 0 jika konfigurasi invalid; 5 kegagalan berturut menulis log level `error` |
| Build | `bun build --compile` untuk `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64`, `bun-windows-x64`; image Docker `apps/collector/Dockerfile` berisi binary saja di atas base image minimal |
| Panduan | `docs/deployment/collector.md`: pasang di host yang keluar lewat jalur kantor yang ingin diamati; satu source per jalur; collector di pusat hanya membuktikan egress pusat; cara rotasi dan pencabutan |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Heartbeat | kantor | `observation_sources.office_id` dari credential, bukan body |
| Heartbeat | IP sumber | `resolveClientAddress` (socket peer atau rantai proxy tepercaya) |
| Heartbeat | status ingress | Hasil `resolveClientAddress` |
| Heartbeat | waktu observasi | `now()` server saat request diterima |
| Heartbeat | `dedup_key` | `eventId` body |
| Heartbeat | stream | `observation_sources.stream_key` (`heartbeat:<sourceId>`) |
| Buat source | `stream_key` | `heartbeat:<sourceId>` dibuat server |
| Buat credential | token | 32 byte dari `crypto.getRandomValues`, ditampilkan sekali |
| Daftar source | last heartbeat | `observation_sources.last_observation_at` |
| Daftar source | freshness | Dihitung saat baca dari periode eligible terbaru dan `expected_interval_s`; `disabled` jika source disabled |
| Collector | `eventId` | uuidv7 dibuat collector per siklus |

**Key invariants**:
- Kantor dan source sebuah observasi heartbeat selalu berasal dari credential.
- IP sumber tidak pernah diambil dari body atau dari header yang dikirim peer yang tidak dipercaya.
- Token hanya ada di memori saat dibuat dan di collector; database hanya menyimpan hash.
- Pencabutan credential tidak mengubah evidence atau periode yang sudah ada.

**Security model**:
- Endpoint heartbeat publik di internet tetapi hanya menerima credential source aktif; rate limit per credential dan batas body.
- Credential membuktikan otorisasi collector, bukan attestation perangkat atau kehadiran fisik; UI dan panduan menyatakan ini.
- Kelola source dan credential butuh `nr.collectors.manage`; user dengan batas kantor hanya bisa mengelola source kantornya.

**Configuration required**:
- `NR_TRUSTED_PROXIES`: daftar CIDR proxy tepercaya, default kosong.
- `NR_CLIENT_IP_HEADER`: `none` (default), `x-forwarded-for`, `forwarded`, atau `cf-connecting-ip`.
- Variabel collector di tabel di atas.

**Critical test scenarios**:
- Happy path: buat source dan credential, jalankan collector melawan backend test, heartbeat diterima, periode terbuka dengan IP peer, verifies **AC-NR-029**.
- Ingress: koneksi langsung dengan `X-Forwarded-For` palsu; peer tepercaya dengan rantai dua proxy; peer tepercaya tanpa header; semuanya menghasilkan alamat dan status yang benar, verifies **AC-NR-030**.
- Idempotency: kirim ulang `eventId` sama; `eventId` sama dari IP berbeda, verifies **AC-NR-031**.
- Race: cabut credential di transaksi lain saat heartbeat menunggu lock; heartbeat ditolak atau tidak eligible; key hasil rotasi tetap diterima, verifies **AC-NR-032**.
- Security: pencarian token di log backend, log collector, response daftar credential, verifies **AC-NR-033**, **AC-HB-03**.
- Batas: body 3 KB, 10 request per menit, source disabled, verifies **AC-HB-01**, **AC-HB-02**.
- Collector: endpoint `http:` ditolak saat start; CA privat lewat file, verifies **AC-HB-04**.
- Deployment: collector di jaringan pusat dicatat sebagai egress pusat, verifies **AC-NR-036**.

## Build plan

1. (T3) Migration `0008` (spec 0002) dan modul `packages/platform/ingress` dengan test tabel direct dan proxy chain, satisfies **AC-NR-030**
2. (T3) Endpoint source dan credential (buat, daftar, cabut, patch, quarantine) dengan audit, satisfies **AC-NR-033**, **AC-HB-05**
3. (T3) Endpoint heartbeat dengan batas body, rate limit, verifikasi credential, ingestion, satisfies **AC-NR-029**, **AC-NR-031**, **AC-NR-032**, **AC-HB-01**, **AC-HB-02**
4. (T3) `packages/contracts/heartbeat.ts` dan `apps/collector` dengan retry, jitter, shutdown, log aman, satisfies **AC-HB-03**, **AC-HB-04**
5. (T3) Build binary lintas target dan Dockerfile collector, satisfies **AC-HB-04**
6. (T3) `docs/deployment/collector.md` termasuk peringatan collector pusat dan prosedur rotasi, satisfies **AC-NR-036**
7. (T3) Test integration race revoke saat commit dan pencarian secret di log, satisfies **AC-NR-032**, **AC-NR-033**
8. (T7) Uji live: collector dari jaringan kantor pilot lewat ingress mirip produksi, satisfies **AC-NR-036**

## Consequences

**Positive**:
- Observasi egress kantor tidak bergantung pada field API vendor yang belum terverifikasi.
- Satu modul ingress untuk login dan heartbeat, dengan default aman (socket peer) sampai topologi produksi diketahui.

**Negative / tradeoffs**:
- Setiap kantor butuh host yang dikelola untuk collector; kantor tanpa host tidak punya bukti egress langsung.
- Credential yang bocor memungkinkan observasi palsu sampai dicabut; tidak ada attestation perangkat.
- Selama `NR_TRUSTED_PROXIES` belum diisi di produksi yang memakai proxy, semua heartbeat tercatat dengan IP proxy dan tidak berguna; ini harus diputuskan sebelum pilot.

**Neutral**:
- Collector tidak menyimpan state; `eventId` baru per siklus membuat restart aman.

## Follow-up

- [ ] Isi `NR_TRUSTED_PROXIES` dan `NR_CLIENT_IP_HEADER` setelah topologi ingress produksi diputuskan, lalu jalankan ulang test ingress terhadap deployment nyata (OQ-NR-004).
- [ ] Tentukan per kantor apakah ada host untuk collector dan jalur mana yang diamati (OQ-NR-006, OQ-NR-007).

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
