# 0002. Rationale: schema database, role, dan runner migration

## Context

PRD INT-NR-005 memberi model logis (tabel dan kolom minimum) tetapi membiarkan penempatan schema, tipe kunci, strategi retensi, dan privilege diputuskan project. Project ini baru, jadi tidak ada schema existing untuk dipakai ulang. Keputusan di sini menjadi dasar semua spec berikutnya; kesalahan di tahap ini (misalnya unique `(site_id, ip)` atau FK cascade dari connection ke history) langsung melanggar aturan bisnis PRD (REQ-NR-005, BR-NR-009) dan mahal diperbaiki setelah data ada.

Tekanan utamanya: evidence mentah tumbuh cepat dan harus dibuang setelah 30 hari, sementara history disimpan 365 hari dan harus tetap menunjuk evidence (dengan tombstone jika evidence sudah dibuang). Idempotency heartbeat harus dijamin lintas waktu. Tiga aplikasi (backend, worker, CLI) mengakses database dengan kebutuhan berbeda, dan PRD meminta batas scope serta secret tetap terjaga di job dan cache.

Anda sudah memutuskan: empat schema (`core`, `iam`, `org`, `network_registry`), `uuidv7()` sebagai primary key, tanpa tabel `site_profiles`, evidence dipartisi bulanan, dua tabel credential terpisah, tanpa hard delete, dan migration berupa file SQL dengan runner Bun sendiri.

## Options considered

### Option 1: Empat schema, partisi bulanan, tabel dedup terpisah, runner sendiri

Seperti di index.md.

**Pros**:
- Privilege per domain ditegakkan database.
- Dedup benar lintas partisi karena tabel dedup tidak dipartisi.
- Retensi murah lewat drop partisi.

**Cons**:
- Tabel tambahan (`observation_dedup`) dan fungsi `SECURITY DEFINER` untuk dirawat.
- FK ke dan dari tabel partisi tidak dipakai.

### Option 2: Satu tabel evidence tanpa partisi, unique `(source_id, event_id)` langsung

**Pros**:
- Paling sederhana; FK dan unique bisa langsung di tabel evidence.

**Cons**:
- Retensi 30 hari berarti `DELETE` harian jutaan baris, memicu bloat dan kebutuhan vacuum agresif.
- Anda memilih partisi bulanan.

### Option 3: Partisi dengan default partition

**Pros**:
- Insert tidak pernah gagal karena partisi belum dibuat.

**Cons**:
- Baris yang jatuh ke default partition menghalangi pembuatan partisi untuk rentang itu sampai dipindahkan manual; kegagalan menjadi diam diam dan menumpuk.

## Rationale

Option 1 dipilih karena satu satunya yang memenuhi dua tuntutan sekaligus: retensi evidence tanpa `DELETE` besar dan idempotency heartbeat yang dijamin constraint, bukan kode. Unique index di tabel partisi wajib menyertakan kolom partisi (`received_at`), sehingga `(source_id, event_id)` tidak bisa unik lintas bulan di tabel evidence itu sendiri; tabel `observation_dedup` kecil yang tidak dipartisi menutup celah ini. Retry heartbeat yang tiba setelah pergantian bulan tetap terdeteksi sebagai duplikat.

Tanpa default partition, kegagalan pemeliharaan menjadi keras dan terlihat. Karena worker baru dibangun di fase terakhir, migration membuat 12 bulan partisi di depan, jadi fase sebelum worker tidak bergantung pada pemeliharaan manual. Fungsi `SECURITY DEFINER` memberi worker kemampuan terbatas (buat dan buang partisi, bersihkan sesi) tanpa hak DDL atau akses tabel `iam`.

Role cluster tidak dibuat di migration karena `CREATE ROLE` butuh hak `CREATEROLE` yang tidak boleh dimiliki pemilik objek aplikasi di produksi. Memisahkan provisioning membuat hak pemilik tetap minimum. `text` plus `CHECK` dipilih di atas tipe enum PostgreSQL karena nilai status di domain ini akan bertambah (status connection, alasan eligibility), dan mengubah `CHECK` lebih mudah dibatalkan daripada `ALTER TYPE ... ADD VALUE`.

## References

**Project sources**:
- `PRD.md` INT-NR-005 (model logis, `inet`, `timestamptz`, constraint dan index minimum, tanpa cascade), REQ-NR-005 (tanpa unique `(site_id, ip)`), REQ-NR-014 (retensi), VAL-NR-003 (binding atomik), VAL-NR-006 (idempotency).
- Spec [0001](../0001-fondasi-stack-struktur/index.md): PostgreSQL 18, `Bun.SQL`, runner migration sendiri.

**Practices & standards**:
- Least privilege per role aplikasi; pemilik objek terpisah dari role runtime.
- Declarative partitioning untuk data berbasis waktu dengan retensi.
- Migration forward only dengan checksum dan advisory lock.

**Links** (diverifikasi saat desain):
- PostgreSQL 18.6 release: https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/
