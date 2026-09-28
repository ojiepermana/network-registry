# 0009. Rationale: worker jadwal, freshness, retensi, dan partisi

## Context

PRD meminta scheduled sync yang tidak berjalan sekali per replica HTTP, tidak membuat jadwal ganda lintas replica, dan bertahan saat restart tanpa history atau event ganda (INT-NR-010, target non fungsional). Event `source_stale` dan `source_recovered` membutuhkan sesuatu yang memeriksa waktu, karena tidak ada request yang memicu perubahan saat sebuah source berhenti mengirim. Retensi (30 hari evidence mentah, 365 hari history, 90 hari sync log) dan partisi bulanan butuh pemeliharaan berkala.

Anda meminta worker dikerjakan paling akhir. Karena itu fase sebelumnya sudah dirancang tanpa worker: CLI `sync:once` memakai kode sync yang sama, migration menyiapkan 12 bulan partisi, dan resolver menghitung freshness saat baca. Worker di sini menggantikan pekerjaan manual itu, bukan menambah logika bisnis baru.

## Options considered

### Option 1: Satu proses worker dengan beberapa loop, koordinasi lewat PostgreSQL

**Pros**:
- Tanpa infrastruktur tambahan; replica tanpa state.
- Memakai lease dan constraint yang sudah ada di spec 0002 dan 0005.

**Cons**:
- Polling database konstan; loop harus dijaga agar ringan.

### Option 2: `pg-boss` untuk jadwal dan antrean

**Pros**:
- Cron, retry, dan singleton job siap pakai.

**Cons**:
- Driver dan schema sendiri di luar `Bun.SQL`; Anda memilih tabel job sendiri.

### Option 3: Cron host yang menjalankan CLI

**Pros**:
- Paling sederhana; tidak ada proses panjang.

**Cons**:
- Tidak ada lease renewal selama run panjang, tidak ada konkurensi terkontrol, dan jadwal bergantung pada konfigurasi host di luar repo.

### Option 4: Worker terpisah per tugas (sync, freshness, maintenance)

**Pros**:
- Skala dan kegagalan terisolasi per tugas.

**Cons**:
- Tiga deployment untuk volume yang kecil; tidak dibutuhkan sekarang.

## Rationale

Option 1 dipilih karena semua kebutuhan koordinasi sudah bisa dijawab PostgreSQL: partial unique index mencegah run ganda, `SKIP LOCKED` membagi antrean ke replica, advisory lock membuat loop singleton tanpa pemilihan leader, dan lease berbatas waktu menangani proses yang mati. Satu proses dengan beberapa loop cukup untuk 100 site dan 200 stream; memecah worker per tugas bisa dilakukan belakangan karena loop sudah terpisah per file.

Freshness sweep menyimpan state terakhir supaya event hanya ditulis saat berubah, yang membuat sweep aman diulang dan aman dijalankan beberapa replica (dengan advisory lock sebagai penghemat, bukan satu satunya pengaman). Relay outbox sengaja tidak dibangun karena belum ada consumer (keputusan outbox saja di V1); backlog dipantau lewat metrik.

## References

**Project sources**:
- `PRD.md` REQ-NR-008, REQ-NR-012, REQ-NR-014, INT-NR-010, target non fungsional (replica, restart), Definition of Done (rollback tanpa hapus history).
- Spec [0002](../0002-database-schema-migration/index.md) fungsi partisi dan `purge_expired_sessions`; spec [0005](../0005-provider-unifi-sync/index.md) `SyncRunner` dan lease; spec [0004](../0004-domain-ingestion-resolver/index.md) policy freshness dan settings.

**Practices & standards**:
- Database backed job queue dengan `FOR UPDATE SKIP LOCKED` dan lease.
- Advisory lock sebagai mutex singleton lintas replica.
- Transactional outbox dengan delivery at least once dan consumer idempotent.

**Links**: none verified.
