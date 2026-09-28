# 0004. Rationale: domain kanonik, ingestion, history, dan resolver

## Context

Inti PRD adalah menjawab pertanyaan sempit dengan jujur: kantor apa yang mungkin terkait sebuah IP, kapan bukti terakhir datang, dari sumber apa, dan apakah ada kandidat lain. Kesulitannya ada di waktu dan ketidakpastian. Sample polling bisa datang ulang dengan data lama; heartbeat bisa di retry; jam sumber bisa salah; IP bisa berganti A ke B lalu kembali ke A; satu kantor bisa punya beberapa WAN; satu IP bisa dipakai beberapa kantor. PRD melarang last write wins, melarang merapikan A ke B ke A menjadi satu record, melarang menurunkan prefix dari satu alamat IPv6, dan melarang skor confidence.

Dua sumber yang sangat berbeda (API vendor dan heartbeat) harus memakai aturan yang sama, dan provider berikutnya harus bisa ditambah tanpa menyentuh logika matching. Resolver punya target p95 100 ms dan tidak boleh bergantung pada vendor. Disable, revoke, dan remap harus berlaku seketika, termasuk saat bersamaan dengan ingestion yang sedang berjalan.

## Options considered

### Option 1: Evidence immutable plus projection periode dengan row lock per stream

**Pros**:
- Evidence utuh untuk audit; projection bisa dibangun ulang.
- Aturan transisi berupa fungsi murni yang mudah diuji tabel.
- Eligibility saat baca membuat perubahan status berlaku seketika.

**Cons**:
- Dua tabel harus konsisten dalam satu transaksi; lebih banyak SQL.

### Option 2: Event sourcing penuh, projection dari replay event

**Pros**:
- Projection bisa dibangun ulang dari awal kapan saja.

**Cons**:
- Replay atas jutaan observasi mahal; retensi evidence 30 hari berarti replay penuh tidak mungkin setelah bulan pertama.

### Option 3: Satu tabel "current IP per site" yang ditimpa, plus log

**Pros**:
- Query resolver paling sederhana.

**Cons**:
- Secara struktural adalah last write wins; multi WAN, multi sumber, dan A ke B ke A tidak bisa direpresentasikan.

### Option 4: Resolver dengan cache in process

**Pros**:
- Latensi lebih rendah pada IP yang sering ditanya.

**Cons**:
- Invalidasi lintas replica butuh broker; risiko `matched` dari cache setelah disable atau TTL. Anda memilih tanpa cache.

## Rationale

Option 1 dipilih karena memisahkan dua kebutuhan yang saling bertentangan: bukti harus lengkap dan tidak berubah (untuk audit dan AC-NR-018), sementara jawaban resolver harus cepat dan mencerminkan kondisi sekarang. `ip_periods` memberi keduanya: history yang mudah dibaca dan sumber kandidat dengan index `(address, expires_at)`. Row lock per stream plus compare and set di `version` mencegah sample lama memundurkan projection (BR-NR-008) tanpa lock global.

Menutup periode hanya diizinkan pada stream yang dinyatakan operator sebagai single egress dan snapshot yang complete, karena itu satu satunya kondisi di mana alamat baru membuktikan alamat lama tidak aktif (INT-NR-006). Di luar kondisi itu, membuka periode paralel dan membiarkan TTL bekerja lebih jujur daripada menebak failover. Basis `wan_assigned_public` saya masukkan sebagai eligible dengan reason `BASIS_WAN_ASSIGNED_ONLY` karena untuk jalur polling sering hanya itu yang tersedia; keputusan ini ditandai policy version `1` dan dievaluasi ulang setelah compatibility report UniFi. Runner up adalah hanya `egress_public` yang eligible, lebih ketat tetapi membuat polling tanpa heartbeat hampir tidak pernah menghasilkan match.

Tanpa cache (pilihan Anda) sesuai prinsip ukur dulu: satu juta baris dengan index btree pada `inet` biasanya jauh di bawah 100 ms, dan menghapus seluruh kelas bug invalidasi yang PRD sebut satu per satu di INT-NR-007.

## References

**Project sources**:
- `PRD.md` REQ-NR-004 sampai REQ-NR-006, BR-NR-006 sampai BR-NR-014, INT-NR-003, INT-NR-006, INT-NR-007, fixture minimum bagian 6.
- Spec [0002](../0002-database-schema-migration/index.md) tabel `ip_observations`, `observation_dedup`, `ip_periods`.
- `PRD.md` S05 (RFC 6269, shared IP) sebagai dasar `SHARED_EGRESS_POSSIBLE`.

**Practices & standards**:
- Evidence immutable dengan projection terpisah (pola event log plus read model tanpa event sourcing penuh).
- Optimistic concurrency dengan kolom version plus row lock.
- Transactional outbox.

**Links** (diverifikasi saat desain):
- npm registry ipaddr.js (2.5.0): https://registry.npmjs.org/ipaddr.js
