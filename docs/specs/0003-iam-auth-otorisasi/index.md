# 0003. Identitas, sesi, dan otorisasi

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan cara admin masuk ke Network Registry dan apa yang boleh mereka lakukan. Login memakai email dan password (hash argon2id), sesi disimpan di PostgreSQL dan dibawa lewat cookie httpOnly, dengan batas idle 30 menit dan absolut 12 jam. Hak akses berupa permission tetap di kode yang dikelompokkan ke empat role dari seed, dan setiap user bisa dibatasi ke kantor tertentu. Spec ini juga mencakup service token untuk resolver internal dan snapshot konteks jaringan yang disimpan sekali saat login (REQ-NR-013).

## Requirements

**User stories**:
- As an admin, I want login dengan email dan password so that hanya orang berwenang yang mengelola koneksi jaringan.
- As an admin, I want memberi role dan batas kantor ke user so that auditor dan operator hanya bisa melakukan tugasnya.
- As a security analyst, I want setiap sesi login menyimpan konteks jaringan saat itu so that audit login lama tidak berubah walaupun registry berubah.
- As an operator, I want membuat admin pertama dan service token lewat CLI so that tidak ada halaman setup yang bisa diambil alih.

**Acceptance criteria** (ID lokal `AC-IAM-*`, plus AC PRD yang didukung):
- **AC-IAM-01**: Login dengan kredensial benar membuat sesi baru, mengirim cookie `__Host-nr_session` (httpOnly, Secure, SameSite=Strict, Path=/), dan `GET /api/auth/me` mengembalikan user, permission efektif, dan batas kantor.
- **AC-IAM-02**: Login gagal (user tidak ada, password salah, user nonaktif, akun terkunci) selalu mengembalikan 401 `INVALID_CREDENTIALS` yang sama, dengan waktu respons setara (verifikasi hash dummy untuk user tidak ada).
- **AC-IAM-03**: Lima kegagalan berturut turut untuk satu akun mengunci akun 15 menit; login benar selama terkunci tetap 401; setelah 15 menit login benar berhasil dan counter direset.
- **AC-IAM-04**: Sesi tanpa aktivitas 30 menit, atau berumur 12 jam, ditolak 401 `SESSION_EXPIRED`; logout mengisi `revoked_at` dan cookie lama tidak bisa dipakai lagi.
- **AC-IAM-05**: Request yang mengubah data (`POST`, `PUT`, `PATCH`, `DELETE`) dengan cookie sesi tetapi tanpa `Origin` yang diizinkan atau tanpa header `X-Requested-With: nr-web` ditolak 403 `CSRF_REJECTED`.
- **AC-IAM-06**: Setiap endpoint bisnis memeriksa permission di backend; user tanpa permission menerima 403 `FORBIDDEN` walaupun UI dimanipulasi (mendukung AC-NR-035).
- **AC-IAM-07**: User dengan batas kantor hanya melihat data kantor itu; data kantor lain tidak muncul di daftar, detail mengembalikan 404, dan kandidat resolver di luar izin disamarkan (mendukung AC-NR-024).
- **AC-IAM-08**: Permission `nr.connections.manage` dan `iam.users.manage` hanya bisa diberikan ke user tanpa batas kantor; percobaan sebaliknya ditolak 422 `SCOPE_RESTRICTED_ROLE`.
- **AC-IAM-09**: Sistem menolak menonaktifkan atau mencabut role admin dari admin aktif terakhir (409 `LAST_ADMIN`).
- **AC-IAM-10**: `iam:create-admin` membuat admin dengan password yang dibaca dari prompt tanpa echo atau stdin, menolak jika email sudah ada, dan tidak pernah menerima password lewat argumen atau env.
- **AC-IAM-11**: `iam:create-service-token` mencetak token sekali; database hanya menyimpan hash SHA-256; request resolver internal dengan token yang dicabut, kedaluwarsa, atau tanpa permission `nr.resolve.internal` ditolak 401 atau 403.
- **AC-IAM-12**: Login berhasil menyimpan `network_context` di sesi berisi status resolver, kandidat, IP teramati, evidence id, `resolvedAt`, dan `policyVersion`; jika resolver gagal, login tetap berhasil dengan status `unavailable`; snapshot tidak pernah diubah setelahnya (mendukung AC-NR-023, AC-NR-028).
- **AC-IAM-13**: Login, logout, pembuatan user, perubahan role atau batas kantor, reset password, dan pembuatan atau pencabutan service token tercatat di `core.audit_logs` tanpa password, hash, atau token (mendukung AC-NR-043).
- **AC-IAM-14**: Login dibatasi 10 percobaan per menit per IP dan 5 per menit per email; kelebihan menerima 429 dengan `Retry-After`.
- **AC-IAM-15**: User dengan `must_change_password` hanya bisa memanggil `GET /api/auth/me`, `POST /api/auth/password`, dan `POST /api/auth/logout` sampai password diganti.

## Decision

**Chosen option**: Option 1: Session auth sendiri di atas `Bun.password` dan PostgreSQL, RBAC permission tetap di kode, role dari seed.

Backend mengautentikasi dengan session token opaque acak (hash disimpan), mengotorisasi lewat permission per route yang diturunkan dari role user, dan menerapkan batas kantor di query service.

**Implementation skills**: `elysiajs` (`~/.claude/skills/elysiajs/`) untuk macro dan `derive` auth di Elysia.

## Feature design

### Permission dan role

Permission adalah konstanta di `packages/registry-core/src/iam/permissions.ts`. Role berisi permission, diisi seed `0001-roles-permissions.sql`, dan tidak bisa diubah dari UI (keputusan Anda: user dikelola di UI, role tetap).

| Permission | Arti |
|---|---|
| `nr.view` | Melihat dashboard, connection, site, history, source, sync run |
| `nr.connections.manage` | Buat, ubah, test, disable, rotate connection (tanpa batas kantor) |
| `nr.mapping.manage` | Bind, unbind, remap external site |
| `nr.sync.execute` | Sync now, retry, cancel run |
| `nr.collectors.manage` | Buat source heartbeat, credential, disable, routing assertion |
| `nr.resolve.diagnose` | Diagnostics resolve current |
| `nr.resolve.historical` | Diagnostics resolve dengan waktu `at` |
| `nr.audit.read` | Membaca audit log |
| `nr.settings.manage` | Mengubah settings registry (tanpa batas kantor) |
| `org.offices.manage` | Buat dan ubah kantor (tanpa batas kantor) |
| `iam.users.manage` | Kelola user, role, batas kantor (tanpa batas kantor) |
| `nr.resolve.internal` | Hanya untuk service token |

| Role | Permission |
|---|---|
| `viewer` | `nr.view` |
| `operator` | `nr.view`, `nr.sync.execute`, `nr.mapping.manage`, `nr.collectors.manage` |
| `auditor` | `nr.view`, `nr.audit.read`, `nr.resolve.diagnose`, `nr.resolve.historical` |
| `admin` | Semua permission user (tidak termasuk `nr.resolve.internal`) |

Permission efektif user = gabungan permission dari semua role. Batas kantor = daftar `iam.user_office_scopes`; kosong berarti semua kantor.

Aturan batas kantor per data:
- Data yang terikat kantor (binding, site detail, source, periode, observasi, history, audit dengan `office_id`) difilter `office_id = ANY(allowed)`.
- Connection dan external site belum terpetakan hanya terlihat oleh user tanpa batas kantor, karena tidak punya kantor.
- Sync run terlihat oleh user tanpa batas kantor; user dengan batas kantor melihat ringkasan run hanya lewat site detail kantornya.

### Alur login dan sesi

1. `POST /api/auth/login {email, password}`. Rate limit per IP dan per email (token bucket in process `packages/platform/rate-limit`, spec 0007).
2. Cari user `lower(email)`. Tidak ada: jalankan `Bun.password.verify` terhadap hash dummy lalu 401.
3. Tolak jika `locked_until > now()` atau `is_active = false` (tetap 401 generik).
4. Verifikasi argon2id. Gagal: `failed_login_count + 1`; jika mencapai 5, `locked_until = now() + 15 menit` dan counter kembali 0. Audit `iam.login.failed`.
5. Berhasil: reset counter, buat token 32 byte acak (base64url), simpan `sha256(token)`, `idle_expires_at = now() + 30m`, `absolute_expires_at = now() + 12h`, `client_ip` dari modul ingress (spec 0006).
6. Panggil resolver in process (spec 0004) dengan IP klien dari modul ingress, timeout 300 ms; simpan hasilnya di `network_context`. Error atau timeout menjadi `{status: 'unavailable'}`. Tidak ada keputusan login berdasarkan hasil ini (BR-NR-015).
7. Set cookie, audit `iam.login.succeeded`, kembalikan profil.

Validasi sesi per request (Elysia `derive` global di plugin `auth`): baca cookie, hash, cari sesi aktif (belum dicabut, `idle_expires_at > now()`, `absolute_expires_at > now()`, user aktif). Perpanjang `idle_expires_at` paling sering sekali per menit untuk mengurangi write. Password diganti atau user dinonaktifkan mencabut semua sesi user itu.

Kebijakan password: panjang 12 sampai 128 karakter, tidak sama dengan email, tanpa aturan komposisi. Hash `Bun.password.hash(password, {algorithm: 'argon2id'})`.

CSRF: untuk metode yang mengubah data dengan autentikasi cookie, `Origin` wajib ada dan termasuk `NR_APP_ORIGINS`, serta header `X-Requested-With: nr-web` wajib ada (interceptor HTTP frontend menambahkannya). Endpoint machine (heartbeat, internal resolve) memakai header `Authorization` dan tidak membaca cookie, jadi tidak terkena aturan ini.

### Service token

Format `nrs_<keyId>.<secret>`: `keyId` 16 karakter acak base32, `secret` 32 byte acak base64url. Disimpan `sha256(secret)`. Verifikasi dengan `crypto.timingSafeEqual`. Dibuat dengan `bun run iam:create-service-token --name <nama> --permission nr.resolve.internal [--expires-days 365]`, dicabut dengan `iam:revoke-service-token --key-id`. Rate limit per token (spec 0007). `last_used_at` diperbarui paling sering sekali per menit.

### API surface

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | `email: string`, `password: string` | profil, permission, batas kantor, `mustChangePassword` | publik, rate limit | 401 `INVALID_CREDENTIALS`, 429 |
| `/api/auth/logout` | POST | | 204 | sesi | 401 |
| `/api/auth/me` | GET | | user, permission, `officeScope: 'all' \| uuid[]`, locale | sesi | 401 `SESSION_EXPIRED` |
| `/api/auth/me` | PATCH | `version` (req), `displayName?`, `locale?: 'id' \| 'en'` | profil | sesi | 409 `VERSION_CONFLICT`, 422 |
| `/api/auth/password` | POST | `currentPassword`, `newPassword` | 204, semua sesi lain dicabut | sesi | 401, 422 `PASSWORD_POLICY` |
| `/api/iam/users` | GET | `cursor`, `limit`, `q`, `isActive` | `items[]`, `nextCursor` | `iam.users.manage` | 403 |
| `/api/iam/users` | POST | `email`, `displayName`, `temporaryPassword`, `roleCodes[]`, `officeIds[]`, `locale` | user | `iam.users.manage` | 409 `EMAIL_TAKEN`, 422 `SCOPE_RESTRICTED_ROLE` |
| `/api/iam/users/:id` | GET | | user dengan role dan kantor | `iam.users.manage` | 404 |
| `/api/iam/users/:id` | PATCH | `version` (req), `displayName`, `isActive`, `roleCodes[]`, `officeIds[]`, `locale` | user | `iam.users.manage` | 409 `VERSION_CONFLICT`, 409 `LAST_ADMIN`, 422 |
| `/api/iam/users/:id/reset-password` | POST | `temporaryPassword` | 204, `must_change_password = true`, sesi user dicabut | `iam.users.manage` | 404, 422 |
| `/api/iam/roles` | GET | | daftar role dan permission | `iam.users.manage` | 403 |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Login | IP klien sesi | Modul trusted ingress (spec 0006), bukan header mentah |
| Login | `network_context` | Resolver in process (spec 0004) dengan IP klien di atas |
| Login | waktu kedaluwarsa | `now()` plus konstanta 30 menit dan 12 jam di `packages/platform/config` (bisa dioverride env) |
| `me` | permission efektif | Gabungan `iam.role_permissions` dari `iam.user_roles` |
| `me` | batas kantor | `iam.user_office_scopes`; kosong menjadi `'all'` |
| `me` | locale | `iam.users.locale` |
| Audit | `correlation_id` | Header `X-Request-Id` atau dibuat plugin request context |
| Audit login gagal | target | `user_id` jika email dikenal; jika tidak, `target_id` null dan tanpa menyimpan email mentah |
| Semua query bisnis | kantor yang diizinkan | Konteks auth yang di `derive`, diteruskan eksplisit ke service |

**Key invariants**:
- Selalu ada minimal satu user aktif dengan role `admin`.
- Token sesi dan service token tidak pernah disimpan plaintext dan tidak pernah dicatat di log.
- `network_context` ditulis sekali, di transaksi pembuatan sesi.
- User dengan batas kantor tidak pernah memegang permission yang ditandai "tanpa batas kantor".

**Security model**:
- Semua endpoint selain `/api/auth/login`, `/api/health/*`, dan endpoint machine (heartbeat, internal resolve) butuh sesi.
- Permission diperiksa oleh macro route `permission: 'nr.view'` yang dideklarasikan di setiap route; route tanpa deklarasi gagal di test kontrak (spec 0007).
- Tidak ada data kesehatan atau pembayaran. Data pribadi terbatas pada email, nama, IP sesi; tidak ada kewajiban kepatuhan khusus yang dinyatakan. Audit tetap wajib karena menyentuh kontrol akses.

**Configuration required**:
- `NR_APP_ORIGINS`: daftar origin frontend yang diizinkan untuk CSRF, contoh `http://localhost:4200`.
- `NR_SESSION_IDLE_MINUTES` (default 30), `NR_SESSION_ABSOLUTE_HOURS` (default 12).
- `NR_COOKIE_SECURE` (default `true`; development di `http://localhost` tetap bisa karena browser memperlakukan localhost sebagai secure context).

**Critical test scenarios**:
- Happy path: CLI buat admin, login, `me`, buat user operator dengan batas kantor, login sebagai operator, logout, verifies **AC-IAM-01**, **AC-IAM-10**.
- Failure case: 5 password salah lalu password benar, tunggu 15 menit (clock tiruan), login berhasil; sesi idle 31 menit ditolak, verifies **AC-IAM-03**, **AC-IAM-04**.
- Failure case: login saat resolver melempar error tetap berhasil dengan snapshot `unavailable`; ubah registry lalu snapshot sesi tetap sama, verifies **AC-IAM-12**.
- Auth/permission: viewer memanggil `POST /api/network-registry/connections` langsung, 403; request mutasi tanpa header CSRF, 403; user terbatas kantor A membuka detail kantor B, 404, verifies **AC-IAM-05**, **AC-IAM-06**, **AC-IAM-07**.
- Security: pencarian log, audit, dan response untuk password dan token setelah semua skenario di atas, tidak ada yang ditemukan, verifies **AC-IAM-13**.

## Build plan

1. (T1) Plugin backend `request-context` (correlation id) dan `auth` (`derive` sesi, macro `permission`, cek CSRF), satisfies **AC-IAM-05**, **AC-IAM-06**
2. (T1) Service login, logout, me dengan argon2id, lockout, hash dummy, cookie, satisfies **AC-IAM-01**, **AC-IAM-02**, **AC-IAM-03**, **AC-IAM-04**
3. (T1) CLI `scripts/iam-create-admin.ts` (prompt tanpa echo atau `--password-stdin`), satisfies **AC-IAM-10**
4. (T1) Rate limit login per IP dan email, satisfies **AC-IAM-14**
5. (T1) Audit untuk login dan logout lewat helper audit spec 0004, satisfies **AC-IAM-13**
6. (T4) Endpoint user dan role, validasi `SCOPE_RESTRICTED_ROLE` dan `LAST_ADMIN`, reset password dan `must_change_password`, satisfies **AC-IAM-08**, **AC-IAM-09**, **AC-IAM-13**, **AC-IAM-15**
7. (T4) Filter batas kantor di semua service yang terikat kantor, satisfies **AC-IAM-07**
8. (T5) Service token: CLI buat dan cabut, verifikasi header `Authorization`, rate limit per token, satisfies **AC-IAM-11**
9. (T5) Snapshot `network_context` di login memakai resolver dan modul ingress, satisfies **AC-IAM-12**
10. (T4) Test integration keamanan: permission per route, CSRF, lockout, batas kantor, pencarian secret di log, satisfies **AC-IAM-02**, **AC-IAM-05**, **AC-IAM-06**, **AC-IAM-07**, **AC-IAM-13**

## Consequences

**Positive**:
- Tidak ada layanan identitas eksternal untuk dioperasikan; semua kontrol akses bisa diuji di integration test.
- Batas kantor dan permission diperiksa di satu tempat (konteks auth), jadi service tidak bisa lupa scope tanpa gagal test.

**Negative / tradeoffs**:
- Auth ditulis sendiri: session fixation, timing, lockout, dan CSRF menjadi tanggung jawab tim. Review keamanan independen wajib sebelum GA.
- Lockout per akun bisa dipakai orang lain untuk mengunci akun admin selama 15 menit; mitigasi hanya rate limit per IP.
- Tanpa MFA, password admin yang bocor cukup untuk mengambil alih rotasi credential jaringan.
- Rate limit in process tidak konsisten antar replica; dengan N replica, batas efektif menjadi N kali lipat.

**Neutral**:
- Role tidak bisa diubah dari UI; menambah role berarti menambah seed dan deploy.

## Follow-up

- [ ] MFA TOTP untuk role admin (ditunda atas keputusan Anda) sebelum atau segera setelah GA.
- [ ] Jika nanti ada IdP perusahaan, evaluasi OIDC sebagai pengganti login password lewat spec supersede.
- [ ] Rate limit terdistribusi jika backend dijalankan lebih dari satu replica di produksi.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
