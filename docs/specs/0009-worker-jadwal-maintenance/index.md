# 0009. Worker: jadwal sync, freshness, retensi, dan partisi

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini adalah pekerjaan terakhir sesuai permintaan Anda. Worker di `apps/worker` adalah proses Bun tanpa server bisnis yang menggantikan pekerjaan manual sebelumnya: mengantrekan sync terjadwal, menjalankan antrean dengan lease (memakai `SyncRunner` yang sama dengan CLI), memantau source yang menjadi stale atau pulih dan menulis event ke outbox, serta menjaga partisi dan retensi data. Worker boleh dijalankan lebih dari satu replica tanpa membuat jadwal atau run ganda.

## Requirements

**User stories**:
- As an operator, I want sync berjalan sendiri sesuai interval setiap connection so that saya tidak menjalankan CLI lewat cron.
- As a network administrator, I want tahu kapan sebuah source menjadi stale atau pulih so that saya bisa memeriksa collector atau koneksi.
- As an operator, I want data lama dibersihkan sesuai kebijakan tanpa merusak history so that database tetap sehat.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-WK-*`):
- **AC-NR-037**: Scheduled dan manual sync atau beberapa worker bersamaan: lease dan idempotency mencegah run efektif ganda dan history atau event duplikat.
- **AC-NR-040**: Worker restart dan redelivery: job dilanjutkan atau diulang aman; outbox dan consumer tidak menggandakan efek.
- **AC-NR-045**: Retensi, migration, dan rollback di fixture staging: current evidence tidak rusak, history sesuai kebijakan, referensi yang kedaluwarsa jelas, restore path diuji.
- **AC-WK-01**: Tiga replica worker selama satu jam dengan 10 connection interval 300 detik menghasilkan tepat satu run per connection per interval (toleransi jitter), tanpa run bersamaan untuk connection yang sama.
- **AC-WK-02**: Source yang periode eligible terakhirnya kedaluwarsa menghasilkan tepat satu `source_stale.v1`; saat evidence baru masuk, tepat satu `source_recovered.v1`; sweep berulang tanpa perubahan tidak menulis event.
- **AC-WK-03**: Maintenance memastikan partisi `ip_observations` tersedia minimal 3 bulan ke depan dan metrik `nr_observation_partitions_ahead` di bawah 2 memicu log level `error`.
- **AC-WK-04**: Retensi menghapus partisi evidence di luar `raw_observation_retention_days`, baris dedup yang lebih tua dari itu, periode dengan `last_seen_at` di luar `ip_history_retention_days`, run di luar `sync_run_retention_days`, dan sesi kedaluwarsa lebih dari 30 hari; tidak menyentuh periode terbuka, audit, atau outbox yang belum terkirim.
- **AC-WK-05**: Periode yang evidence miliknya sudah dibuang menampilkan `evidenceRetained: false` di API history, bukan error atau referensi rusak.
- **AC-WK-06**: `SIGTERM` menghentikan klaim baru, menunggu run berjalan sampai 30 detik, lalu melepas lease run yang belum selesai (`lease_expires_at = now()`) sehingga worker lain mengambilnya.
- **AC-WK-07**: Worker tidak punya akses tabel `iam` dan berjalan dengan role `nr_worker`; health dan metrik di port internal dengan token.
- **AC-WK-08**: Relay outbox tidak aktif di V1; `nr_outbox_backlog` melaporkan jumlah event belum terkirim.

## Decision

**Chosen option**: Option 1: Satu proses worker dengan beberapa loop berbasis PostgreSQL (jadwal, eksekutor, reaper lease, freshness sweep, maintenance), koordinasi lewat constraint dan advisory lock.

Worker tidak memiliki state sendiri; semua koordinasi antar replica lewat PostgreSQL, sehingga replica bisa ditambah atau dijalankan ulang kapan saja.

## Feature design

### Struktur

```text
apps/worker/
├── Dockerfile
└── src/
    ├── main.ts          # config, pool nr_worker, start loops, shutdown
    ├── loops/
    │   ├── scheduler.ts
    │   ├── executor.ts
    │   ├── lease-reaper.ts
    │   ├── freshness-sweep.ts
    │   └── maintenance.ts
    └── ops-server.ts    # /health, /metrics dengan token
```

Semua logika bisnis ada di `packages/registry-core` (`SyncRunner`, policy freshness, `OutboxWriter`); worker hanya menjadwalkan.

### Loop

| Loop | Interval | Koordinasi | Tugas |
|---|---|---|---|
| Scheduler | 15 detik | `pg_try_advisory_xact_lock(hashtext('nr.scheduler'))`; partial unique run aktif | Untuk connection `enabled`, `next_sync_at <= now()`, `backoff_until` lewat: `INSERT sync_runs (trigger='scheduled') ON CONFLICT DO NOTHING`, set `next_sync_at = now() + interval ± jitter` di transaksi yang sama |
| Executor | terus menerus, konkurensi `NR_WORKER_CONCURRENCY` (default 4) | `FOR UPDATE SKIP LOCKED` dan lease (spec 0005) | Klaim run `queued`, jalankan `SyncRunner`, perpanjang lease setiap 30 detik |
| Lease reaper | 30 detik | `FOR UPDATE SKIP LOCKED` | Run `running` dengan `lease_expires_at < now()`: kembali `queued` dengan `attempt + 1`, atau `failed` setelah attempt 3 dengan event `sync_failed.v1` |
| Freshness sweep | 60 detik | advisory lock `nr.freshness` | Hitung freshness setiap source enabled; jika berbeda dari `freshness_state`, update state dan `freshness_changed_at`, tulis `source_stale.v1` (fresh ke stale) atau `source_recovered.v1` (stale ke fresh) di transaksi yang sama. Source disabled menjadi `disabled` tanpa event |
| Maintenance | 1 jam | advisory lock `nr.maintenance` | `ensure_observation_partitions(3)`, `drop_observation_partitions_before(now() - raw_retention)`, hapus dedup, periode, run, dan sesi lama per batch 5000 baris |

Transisi freshness memakai state persisten, jadi event hanya ditulis saat state berubah, dan replay sweep tidak menggandakan event. Event memakai id `uuidv7()` dari insert outbox; consumer masa depan dedup by id.

Jadwal pertama: connection baru dengan `next_sync_at` null dijadwalkan `now() + random(0, jitter)`.

### Konfigurasi dan operasi

| Variabel | Default | Fungsi |
|---|---|---|
| `DATABASE_URL_WORKER` | wajib | Role `nr_worker` |
| `NR_WORKER_CONCURRENCY` | 4 | Run paralel per replica |
| `NR_WORKER_OPS_PORT` | 9464 | Port `/health` dan `/metrics`, bind `0.0.0.0` di container, tidak diekspos publik |
| `NR_METRICS_TOKEN` | wajib | Token metrik (sama dengan backend) |
| `NR_SECRET_KEYS` | wajib | Membuka API key connection |
| `NR_PROVIDER_ALLOWED_HOSTS` | `api.ui.com` | Sama dengan spec 0005 |

Metrik tambahan: `nr_worker_runs_in_progress`, `nr_worker_loop_last_success_timestamp{loop}`, `nr_observation_partitions_ahead`, `nr_retention_deleted_total{kind}`, `nr_outbox_backlog`.

Health `/health`: 200 jika setiap loop sukses dalam dua kali intervalnya dan database terjangkau; selain itu 503 dengan nama loop yang tertinggal.

Pool: `max = NR_WORKER_CONCURRENCY + 3`.

Rollback: mematikan worker menghentikan pengumpulan baru tanpa menghapus history (PRD Definition of Done); CLI `sync:once` tetap tersedia sebagai jalur manual.

### API surface

Worker tidak menambah endpoint bisnis. API history (spec 0007) menambah field `evidenceRetained` per periode: `true` jika `last_evidence_id` masih ada di partisi yang belum dibuang, dihitung dari batas partisi tertua yang masih ada.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Scheduler | connection yang jatuh tempo | `provider_connections.next_sync_at`, `enabled`, `backoff_until` |
| Scheduler | `next_sync_at` baru | `now() + poll_interval_s ± random(jitter_s)` |
| Freshness sweep | freshness saat ini | Policy spec 0004: ada periode eligible dengan `expires_at > now()` |
| Freshness sweep | state sebelumnya | `observation_sources.freshness_state` |
| Maintenance | batas retensi | `network_registry.settings` (`raw_observation_retention_days`, `ip_history_retention_days`, `sync_run_retention_days`) |
| Maintenance | batas sesi | `now() - 30 hari`, konstanta worker |
| History API | `evidenceRetained` | Batas bawah partisi tertua yang ada, dibanding waktu `last_evidence_id` (uuidv7 mengandung waktu) |
| Lease | `lease_owner` | `<hostname>:<pid>:<uuid proses>` |

**Key invariants**:
- Tidak ada state koordinasi di memori yang dibutuhkan replica lain.
- Event freshness hanya ditulis bersama perubahan `freshness_state` dalam satu transaksi.
- Retensi tidak pernah menghapus periode `open` yang belum kedaluwarsa, audit, atau outbox `published_at IS NULL`.

**Security model**:
- Role `nr_worker` tanpa DDL dan tanpa akses tabel `iam`; DDL partisi dan pembersihan sesi lewat fungsi `SECURITY DEFINER` (spec 0002).
- Port ops tidak diekspos publik; metrik butuh token; tidak ada label dengan cardinality tinggi.

**Configuration required**:
- Variabel di tabel di atas.

**Critical test scenarios**:
- Happy path: satu worker, dua connection fake dengan interval 60 detik, clock dipercepat; run terjadwal muncul dan selesai, verifies **AC-WK-01**.
- Konkurensi: tiga worker, satu Sync now manual di tengah; tidak ada run ganda, tidak ada periode atau event ganda, verifies **AC-NR-037**, **AC-WK-01**.
- Failure case: worker dibunuh (`SIGKILL`) di tengah run; reaper mengembalikan run; worker lain menyelesaikan tanpa event ganda; `SIGTERM` melepas lease dalam 30 detik, verifies **AC-NR-040**, **AC-WK-06**.
- Freshness: source berhenti heartbeat; sweep berulang; heartbeat kembali, verifies **AC-WK-02**.
- Retensi: fixture 14 bulan; jalankan maintenance; periksa partisi, periode terbuka utuh, `evidenceRetained: false` untuk periode lama, audit utuh, verifies **AC-WK-03**, **AC-WK-04**, **AC-WK-05**, **AC-NR-045**.
- Security: worker mencoba `SELECT` dari `iam.users` dan gagal; `/metrics` tanpa token 401, verifies **AC-WK-07**.

## Build plan

1. (T6) Scaffold `apps/worker`: config, pool, `ops-server`, shutdown, Dockerfile, satisfies **AC-WK-06**, **AC-WK-07**
2. (T6) Loop executor dan lease reaper memakai `SyncRunner`, satisfies **AC-NR-037**, **AC-NR-040**, **AC-WK-06**
3. (T6) Loop scheduler dengan advisory lock dan `ON CONFLICT DO NOTHING`, satisfies **AC-WK-01**, **AC-NR-037**
4. (T6) Loop freshness sweep dengan event stale dan recovered, satisfies **AC-WK-02**
5. (T6) Loop maintenance: partisi, retensi batch, sesi, satisfies **AC-WK-03**, **AC-WK-04**
6. (T6) Field `evidenceRetained` di API history dan regenerasi SDK, satisfies **AC-WK-05**
7. (T6) Metrik worker dan `nr_outbox_backlog`, satisfies **AC-WK-08**, **AC-WK-03**
8. (T6) Test integration multi replica, kill, dan retensi dengan fixture 14 bulan, satisfies **AC-NR-037**, **AC-NR-040**, **AC-WK-01**, **AC-WK-04**
9. (T7) Uji rollback dan restore di staging: matikan worker, restore backup, jalankan migration dan maintenance, satisfies **AC-NR-045**

## Consequences

**Positive**:
- Tidak ada scheduler eksternal, Redis, atau broker; replica bisa ditambah tanpa konfigurasi.
- Pekerjaan manual sebelum fase ini (CLI `sync:once --enqueue-due`, `db:maintain`) digantikan tanpa mengubah logika bisnis.

**Negative / tradeoffs**:
- Polling database setiap 15 sampai 60 detik oleh setiap replica menambah beban kecil yang konstan.
- Freshness sweep mendeteksi stale paling lambat 60 detik setelah kedaluwarsa, sehingga event tidak real time (resolver tetap benar karena menghitung saat baca).
- Relay outbox belum ada; event menumpuk sampai consumer diputuskan, jadi backlog perlu dipantau dan mungkin perlu kebijakan retensi outbox.

**Neutral**:
- Worker dan CLI memakai kode sync yang sama; CLI tetap berguna untuk operasi manual dan debugging.

## Follow-up

- [ ] Putuskan target relay outbox (webhook bertanda tangan, NATS, atau consumer polling) saat ada consumer nyata, lalu tambahkan loop relay.
- [ ] Putuskan retensi outbox untuk event yang tidak pernah dikirim selama relay belum ada.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
