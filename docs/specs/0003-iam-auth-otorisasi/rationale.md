# 0003. Rationale: identitas, sesi, dan otorisasi

## Context

REQ-NR-010 meminta tujuh hak terpisah (view, manage connections, manage mapping, execute sync, manage collector credentials, resolve diagnostics, read audit), ditegakkan di backend, dan memakai ulang auth serta scope project. Project ini belum punya auth sama sekali. Tanpa auth, AC keamanan PRD (AC-NR-024, AC-NR-025, AC-NR-035) tidak bisa lulus, jadi auth harus ada sejak slice tracer pertama.

Aplikasi ini adalah tool admin internal yang memegang API key UniFi dan secret heartbeat. Pengguna sedikit (administrator platform, jaringan, auditor). Tidak ada IdP perusahaan yang disebut. Anda memilih satu organisasi tanpa tenant, dengan pembatasan opsional per kantor, role dari seed, dan pengelolaan user di UI. REQ-NR-013 butuh consumer nyata untuk snapshot konteks jaringan; satu satunya alur login yang ada adalah login admin aplikasi ini.

## Options considered

### Option 1: Session auth sendiri dengan Bun.password dan sesi di PostgreSQL

**Pros**:
- Tanpa layanan eksternal; memakai `Bun.password` native dan pola `Bun.SQL`.
- Sesi opaque bisa dicabut seketika (logout, ganti password, nonaktifkan user).

**Cons**:
- Semua kontrol keamanan (lockout, CSRF, timing) ditulis dan dirawat sendiri.
- Tanpa MFA di V1.

### Option 2: OIDC ke IdP eksternal

**Pros**:
- SSO dan MFA dari IdP; tidak menyimpan password.

**Cons**:
- Butuh IdP yang berjalan dan dikonfigurasi; tidak ada yang disebut untuk project ini.

### Option 3: Library auth yang di host sendiri (misalnya Better Auth)

**Pros**:
- Fitur lengkap (MFA, passkey) siap pakai.

**Cons**:
- Membawa adapter database dan tabel sendiri di luar pola `Bun.SQL` dan schema `iam` yang sudah diputuskan.

### Option 4: JWT stateless

**Pros**:
- Tidak ada lookup sesi per request.

**Cons**:
- Tidak bisa dicabut seketika tanpa daftar hitam, yang pada akhirnya adalah tabel sesi juga.

## Rationale

Anda memilih Option 1. Ini termasuk pola "reinventing auth" yang biasanya saya peringatkan, jadi saya catat alasannya dan batasnya. Untuk tool admin internal dengan sedikit user, tanpa IdP, dan tanpa login publik atau registrasi, cakupan auth yang perlu ditulis kecil: login password, sesi opaque, logout. Bagian paling berisiko (hash password) memakai `Bun.password` argon2id bawaan, bukan kode sendiri. Sesi opaque di database dipilih di atas JWT karena REQ-NR-010 dan AC-NR-032 menuntut pencabutan seketika. Syarat yang saya tetapkan: review keamanan independen sebelum GA dan MFA sebagai follow up, karena akun admin memegang rotasi credential jaringan.

RBAC dengan permission tetap di kode memetakan tujuh hak PRD satu banding satu tanpa policy engine. Role dari seed cocok dengan pilihan Anda untuk tidak mengelola role di UI. Permission yang tidak terikat kantor (connection, settings, user, kantor) hanya bisa dipegang user tanpa batas kantor, karena memberi hak kelola connection ke user yang dibatasi satu kantor akan membuka semua site connection itu. Snapshot `network_context` di login admin memberi REQ-NR-013 consumer nyata sejak V1 tanpa membuat aturan login baru.

## References

**Project sources**:
- `PRD.md` REQ-NR-010 (tujuh hak, enforcement backend), REQ-NR-013 (snapshot konteks sesi), BR-NR-015 (matched bukan keputusan otorisasi), AC-NR-023, AC-NR-024, AC-NR-028, AC-NR-035.
- Spec [0002](../0002-database-schema-migration/index.md): tabel `iam`.
- Skill terpasang `elysiajs`.

**Practices & standards**:
- Sesi opaque dengan hash token di server; cookie `__Host-` httpOnly Secure SameSite=Strict.
- Kebijakan password panjang minimum tanpa aturan komposisi (pedoman identitas digital NIST SP 800-63B).
- Verifikasi hash dummy untuk menyamakan waktu respons pada user yang tidak ada.

**Links**: none verified.
