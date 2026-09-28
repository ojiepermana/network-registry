# 0001. Rationale: fondasi stack dan struktur repository

## Context

Network Registry adalah modul baru tanpa kode, tanpa `AGENTS.md`, dan tanpa project induk yang bisa dipakai ulang. PRD (lapisan 2, INT-NR-001) berasumsi ada project existing yang menyediakan auth, master cabang, job framework, logger, secret store, SDK generator, dan outbox, lalu meminta semuanya dipakai ulang. Karena tidak ada, setiap kemampuan itu harus diputuskan di sini, dengan prinsip PRD yang tetap berlaku: jangan membuat infrastruktur kedua, jangan menambah dependency tanpa keputusan tercatat.

Anda menetapkan tiga batas stack: PostgreSQL 18, Elysia versi terbaru, Angular 22.2 terbaru. Anda juga menetapkan struktur: folder `apps/` berisi `frontend` dan `backend`, worker di dalamnya tetapi dikerjakan paling akhir, komponen UI dari `@ojiepermana/angular`, dan layout memakai default layout wrapper. Anda memilih membuat aturan sendiri, bukan menyalin project `foundation`, walaupun banyak pola foundation cocok.

Beban teknis domain ini khas: data alamat IP (`inet`, IPv4 dan IPv6), history dengan konkurensi (compare and set, row lock), dedup idempotent, antrean job dengan lease, partisi untuk retensi, dan resolver dengan target p95 100 ms pada 50 request per detik. Volume sedang (100 site, 200 stream, satu juta observasi uji). Tim kecil, dan sistem harus bisa dioperasikan tanpa tim platform.

Jika fondasi tidak diputuskan, setiap spec lapisan akan memilih alat sendiri (misalnya ORM di satu tempat, SQL langsung di tempat lain, dua cara menjadwalkan job), dan PRD secara eksplisit melarang duplikasi semacam itu.

## Options considered

### Option 1: Monolith berlapis Bun, SQL langsung, PostgreSQL sebagai satu satunya infrastruktur

Backend Elysia tunggal, worker Bun, collector Bun, frontend Angular. PostgreSQL 18 menyimpan data, antrean job, outbox, dan ciphertext secret. Akses database lewat `Bun.SQL` dan file SQL. Satu `package.json` root.

**Pros**:
- Paling sedikit komponen untuk dioperasikan: satu database dan container aplikasi.
- Semua fitur PostgreSQL 18 (partisi, `inet`, `uuidv7()`, `NULLS NOT DISTINCT`, `SKIP LOCKED`) terpakai langsung.
- Kode domain dipakai bersama backend, worker, dan CLI lewat `packages/`.

**Cons**:
- Tipe baris dan query ditulis manual; tidak ada generator schema.
- Auth, secret box, dan logger ditulis sendiri, jadi butuh review keamanan dan test yang lebih disiplin.

### Option 2: Bun workspaces dengan Drizzle ORM dan `pg-boss`

Setiap app punya `package.json` sendiri dalam Bun workspaces. Drizzle mendefinisikan schema dan migration. `pg-boss` mengelola antrean dan jadwal.

**Pros**:
- Schema bertipe dan migration digenerate dari TypeScript.
- Cron, retry, dan singleton job sudah jadi di `pg-boss`.

**Cons**:
- Query paling penting (resolver, projection history, klaim job) tetap harus ditulis sebagai SQL mentah, jadi ORM hanya membantu bagian CRUD.
- `pg-boss` membawa driver `pg` dan schema sendiri di luar pola `Bun.SQL`; dua cara mengakses database dalam satu sistem.
- Lebih banyak manifest untuk disinkronkan.

### Option 3: Salin fondasi `foundation`

Mengambil tooling foundation (doctor dan serve, image PostgreSQL Oracle Linux, runner migration, aturan).

**Pros**:
- Tooling dan aturan sudah teruji di project Anda yang lain.

**Cons**:
- Anda memilih aturan sendiri untuk project ini; menyalin berarti mewarisi keputusan (port, image custom, struktur `libs/`) yang belum tentu cocok.
- Foundation sendiri masih banyak fitur `planned`, jadi yang disalin sebagian besar aturan, bukan kode.

### Option 4: Layanan terpisah dengan broker

Service ingestion, resolver, dan admin terpisah, komunikasi lewat NATS atau Redis.

**Pros**:
- Skala tiap bagian terpisah.

**Cons**:
- Volume PRD tidak membutuhkan ini; biaya operasional dan debugging berlipat. PRD melarang menambah broker hanya untuk cron.

## Rationale

Option 1 dipilih karena beban tersulit di domain ini adalah SQL yang spesifik PostgreSQL: projection history dengan compare and set, dedup lintas partisi, klaim job dengan `SKIP LOCKED`, dan query kandidat berbasis `inet`. ORM tidak mengurangi pekerjaan di bagian itu, justru menambah lapisan yang harus ditembus. `Bun.SQL` sudah menyediakan pool, parameter, dan transaksi native, dan Anda sudah memakai pola ini.

PostgreSQL sebagai satu satunya infrastruktur sesuai INT-NR-010 (job state di PostgreSQL, tanpa Redis atau NATS hanya untuk cron) dan REQ-NR-012 (outbox tanpa menjadikan broker prasyarat). Untuk volume 100 site dan 200 stream, satu PostgreSQL 18 jauh di bawah batasnya. Secret upstream harus bisa dibaca worker, jadi hash tidak cukup; enkripsi AES-256-GCM di aplikasi dengan kunci dari env memberi pemisahan kunci dan data tanpa layanan vault.

Anda memilih satu `package.json` root, bukan workspaces. Itu sederhana untuk dependency Angular dan Elysia dan sama dengan kebiasaan Anda. Konsekuensinya, image collector dan worker dibangun dengan `bun build` (bundling) supaya tidak membawa dependency frontend; ini dicatat di Consequences. Elysia dipin di 1.4.30 karena 2.0 masih beta (beta.19 per 24 September 2026). `@ojiepermana/angular` dipin di 22.1.14 karena 22.2.0 belum ada di npm, dan peer 22.1.14 sudah menerima Angular 22.2.0.

## References

**Project sources**:
- `PRD.md` lapisan 2: INT-NR-001 (audit reuse), INT-NR-002 (batas modul), INT-NR-005 (PostgreSQL, `inet`, `timestamptz`), INT-NR-010 (job PostgreSQL, tanpa broker untuk cron).
- `PRD.md` lapisan 1: REQ-NR-012 (outbox), target non fungsional (p95 100 ms, satu juta observasi).
- Project `foundation` (repo tetangga): pola `apps/frontend`, `apps/backend`, `Bun.SQL`, generator SDK `@ojiepermana/angular:sdk`; dipakai sebagai pembanding, tidak disalin.
- Source `@ojiepermana/angular` (repo tetangga `angular`): `packages/angular/theme/layout/README.md` untuk kontrak `Layout`.
- Skill terpasang `elysiajs` dan `angular-developer`.

**Practices & standards**:
- Monolith first; database backed queue sebelum broker khusus.
- Envelope encryption dengan key id untuk rotasi kunci.

**Links** (diverifikasi saat desain, 28 September 2026):
- npm registry elysia (latest 1.4.30, next 2.0.0 beta): https://registry.npmjs.org/elysia
- npm registry @elysia/openapi (latest 1.4.16): https://registry.npmjs.org/@elysia/openapi
- npm registry @angular/core (latest 22.2.0): https://registry.npmjs.org/@angular/core
- npm registry @ojiepermana/angular (latest 22.1.14, peer Angular >=22.1.0 <23): https://registry.npmjs.org/@ojiepermana/angular
- npm registry ipaddr.js (2.5.0): https://registry.npmjs.org/ipaddr.js
- PostgreSQL 18.6 release: https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/
- Bun (1.4.2): https://bun.com
- Elysia 1.4 dan Standard Schema: https://elysiajs.com/blog/elysia-14
