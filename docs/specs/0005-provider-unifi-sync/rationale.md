# 0005. Rationale: adapter UniFi Site Manager dan sync run

## Context

UniFi adalah satu satunya provider produksi V1. PRD menegaskan bahwa keberadaan endpoint list sites di dokumentasi bukan bukti bahwa field WAN atau IP publik tersedia pada Dream Router tertentu, dan melarang mengarang endpoint, field, atau hasil test (README, INT-NR-004, REQ-NR-015). Belum ada akses ke perangkat, akun UniFi, atau credential saat desain, sehingga adapter harus bisa selesai dan teruji dengan fixture sambil tetap jujur bahwa kompatibilitas live belum terbukti.

Sinkronisasi harus tahan terhadap rate limit, timeout, pagination yang putus, dan kegagalan satu site, tanpa menghapus data dan tanpa memproses satu connection dua kali. Worker baru dibangun di fase terakhir, padahal alur tracer butuh sync nyata sejak awal.

## Options considered

### Option 1: Site Manager cloud saja, capability `unverified` sampai terbukti, run di PostgreSQL dieksekusi CLI lalu worker

**Pros**:
- Satu jalur akses yang aman (HTTPS ke host tetap, tanpa jalur privat ke UDR).
- Kode sync sama untuk CLI dan worker.

**Cons**:
- Data IP dari polling bisa belum tersedia sampai compatibility capture.

### Option 2: Site Manager plus Local Integrations API bersyarat

**Pros**:
- Akses ke data lokal yang mungkin lebih lengkap.

**Cons**:
- Butuh jalur privat, allowlist host per kantor, CA privat, dan dokumentasi lokal yang bergantung versi; menambah permukaan SSRF.

### Option 3: Sync dijalankan langsung di request backend

**Pros**:
- Tidak butuh CLI atau worker untuk mencoba alur.

**Cons**:
- Melanggar INT-NR-010 (poll tidak boleh di request lifecycle) dan membuat request HTTP menunggu API vendor.

## Rationale

Option 1 dipilih (pilihan Anda untuk jalur UniFi dan CLI sebelum worker). Memulai semua capability dari `unverified` adalah cara paling langsung memenuhi REQ-NR-015: sistem tidak bisa tanpa sengaja menampilkan IP yang semantiknya belum dicek, karena mapper memang tidak menghasilkan observasi alamat sampai capability tersebut naik. Ini membuat nilai polling di awal rendah, tetapi PRD secara eksplisit lebih memilih status partial yang terlihat daripada data yang tampak lengkap.

Lease dengan partial unique index memberi dua lapis perlindungan terhadap run ganda: database menolak antrean kedua, dan `SKIP LOCKED` memastikan dua proses tidak mengklaim run yang sama. Lease berbatas waktu plus berhenti menulis saat lease hilang menangani proses yang mati di tengah (AC-NR-040). Menaruh `SyncRunner` di `packages/registry-core` dan menjalankannya dari CLI membuat alur tracer T1 dan T2 nyata tanpa menunggu worker, dan worker di T6 hanya menambah jadwal serta konkurensi.

## References

**Project sources**:
- `PRD.md` REQ-NR-001, REQ-NR-008, REQ-NR-015, INT-NR-003, INT-NR-004, INT-NR-009 (allowlist host, redirect, DNS rebinding), INT-NR-010, dokumen `unifi-compatibility.md` di PRD.
- `PRD.md` S01, S02 (dokumentasi resmi UniFi API) dan S06 (OWASP SSRF) sebagai sumber yang wajib ditinjau ulang saat compatibility capture.
- Spec [0004](../0004-domain-ingestion-resolver/index.md) kontrak `ProviderAdapter` dan `IngestionService`.

**Practices & standards**:
- Retry hanya untuk error yang retryable dengan exponential backoff dan full jitter; hormati `Retry-After`.
- Job lease dengan `FOR UPDATE SKIP LOCKED`.
- Pencegahan SSRF dengan allowlist host, redirect manual, dan pemeriksaan hasil DNS.

**Links** (diverifikasi saat desain):
- UniFi Site Manager API getting started (base URL, header `X-API-Key`, endpoint hosts, sites, devices, pagination): https://developer.ui.com/site-manager/v1.0.0/gettingstarted
