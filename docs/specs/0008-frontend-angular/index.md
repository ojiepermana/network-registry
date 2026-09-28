# 0008. Frontend Angular: layout, i18n, dan halaman

**Date**: 2026-09-28
**Status**: Proposed

## Summary

Spec ini menetapkan aplikasi admin Angular 22.2 di `apps/frontend`. Seluruh shell memakai default layout wrapper `LayoutWrapperDefault` dari `@ojiepermana/angular/theme/layout/wrapper` dengan sidebar vertical, dan semua komponen UI diambil dari `@ojiepermana/angular`. Antarmuka tersedia dalam bahasa Indonesia dan Inggris lewat Angular i18n. Spec ini merinci tujuh halaman PRD (PAGE-NR-001 sampai 007) ditambah login, kantor, user, dan settings, lengkap dengan state loading, empty, error, forbidden, stale, dan unsupported, serta aturan label supaya hasil IP tidak pernah terbaca sebagai bukti lokasi.

## Requirements

**User stories**:
- As a network administrator, I want satu dashboard yang langsung menunjukkan site belum terpetakan, source stale, konflik IP, dan sync gagal so that saya tahu apa yang perlu dibereskan.
- As a platform administrator, I want menambah dan menguji connection UniFi dari UI tanpa pernah melihat API key lagi so that secret tidak bocor lewat layar.
- As an auditor, I want menelusuri history IP dan alasan hasil resolve so that saya bisa menjelaskan konteks sebuah login tanpa membaca secret.
- As a user berbahasa Inggris, I want antarmuka dalam bahasa Inggris so that saya tidak perlu menerjemahkan istilah.

**Acceptance criteria** (AC PRD yang menjadi kontrak spec ini, plus ID lokal `AC-FE-*`):
- **AC-NR-021**: UI menampilkan `matched` sebagai kandidat berbasis IP, bukan lokasi atau perangkat terverifikasi.
- **AC-NR-041**: Semua halaman PAGE-NR-001 sampai 007: fungsi, filter, pagination, keyboard, serta state loading, empty, error, unsupported, stale, dan forbidden terpenuhi; label network tidak menyesatkan.
- **AC-FE-01**: Shell memakai `LayoutWrapperDefault` dengan `layout-type="vertical"` dan `nav-type="sidebar"`; halaman login memakai wrapper yang sama dengan `layout-type="empty"`. Tidak ada komponen layout, header, atau sidebar buatan sendiri.
- **AC-FE-02**: Item navigasi hanya muncul untuk permission yang dimiliki user; route dijaga guard permission, dan akses langsung ke URL tanpa permission menampilkan state forbidden.
- **AC-FE-03**: Build menghasilkan locale `id` (source) dan `en`; tidak ada teks antarmuka yang tidak ditandai i18n (dicek `ng extract-i18n` tanpa pesan baru yang belum diterjemahkan di CI).
- **AC-FE-04**: Semua waktu tampil absolut (zona waktu kantor jika konteksnya kantor, selain itu Asia/Jakarta) dan relatif, dengan waktu UTC di tooltip.
- **AC-FE-05**: Form connection tidak pernah memuat ulang API key; field secret bertipe password, kosong saat edit, dan rotate lewat dialog terpisah dengan konfirmasi dampak.
- **AC-FE-06**: Secret heartbeat ditampilkan sekali di dialog dengan tombol salin dan centang "sudah saya simpan"; setelah ditutup, tidak ada cara menampilkannya lagi; tidak disimpan di browser storage.
- **AC-FE-07**: Sync now menampilkan run id dan memantau status setiap 3 detik sampai status akhir atau 5 menit, lalu menampilkan hasil termasuk `partial` dan issue per site.
- **AC-FE-08**: Semua daftar memakai pagination cursor dari server (Next dan Previous); filter dan sort dikirim ke server, tidak diproses di klien.
- **AC-FE-09**: Error menampilkan pesan dari `code` yang diterjemahkan dan `correlationId` yang bisa disalin.
- **AC-FE-10**: Semua aksi sensitif (disable connection, rotate, remap, unbind, revoke credential, quarantine source, ubah routing assertion, nonaktifkan user) memakai dialog konfirmasi yang menjelaskan dampaknya.
- **AC-FE-11**: Semua komponen interaktif bisa dipakai dengan keyboard, punya label, dan dialog mengembalikan fokus; status async diumumkan lewat `aria-live`.
- **AC-FE-12**: Frontend hanya memanggil backend lewat SDK di `apps/frontend/sdk/`; tidak ada panggilan ke host UniFi dan tidak ada DTO HTTP yang ditulis manual.

## Decision

**Chosen option**: Option 1: Standalone components dengan signals, satu shell `LayoutWrapperDefault`, data lewat SDK hasil generate, i18n build time.

Aplikasi terdiri dari area fitur lazy loaded di dalam satu shell wrapper, dengan state halaman berbasis signals dan adaptor API tipis di atas SDK.

**Implementation skills**: `angular-developer` (`~/.claude/skills/angular-developer/`) · `angular-new-app` (`~/.claude/skills/angular-new-app/`) · `frontend-design` (`~/.claude/skills/frontend-design/`) untuk arah visual di dalam batas library.

## Feature design

### Struktur

```text
apps/frontend/
├── angular.json          # i18n: sourceLocale id, locales.en → src/locale/messages.en.xlf
├── sdk.config.json
├── sdk/                  # hasil generate, jangan diedit
├── proxy.conf.json       # /api → http://127.0.0.1:3000
└── src/
    ├── locale/messages.en.xlf
    └── app/
        ├── app.config.ts # provideRouter, provideHttpClient(withInterceptors), provideApiConfiguration('')
        ├── app.routes.ts
        ├── core/
        │   ├── session/      # SessionStore (signal me, permissions, officeScope), authGuard, permissionGuard
        │   ├── http/         # interceptor X-Requested-With, X-Request-Id, 401 ke login, 403 ke forbidden
        │   ├── errors/       # pemetaan code ke pesan i18n
        │   └── time/         # pipe waktu absolut dan relatif
        ├── shell/            # konfigurasi LayoutWrapperDefault: navigasi, brand, user, logout
        ├── shared/           # komposisi kecil: state-view (loading/empty/error/forbidden), cursor-pager, confirm-dialog, capability-badge, freshness-badge, resolver-result
        └── features/
            ├── auth/             # login, change-password
            ├── dashboard/        # PAGE-NR-001
            ├── connections/      # PAGE-NR-002
            ├── site-mapping/     # PAGE-NR-003
            ├── sites/            # daftar site dan PAGE-NR-004
            ├── ip-history/       # PAGE-NR-005
            ├── diagnostics/      # PAGE-NR-006
            ├── sync-audit/       # PAGE-NR-007
            ├── offices/          # master kantor
            ├── users/            # kelola user
            └── settings/         # settings registry
```

Setiap fitur punya `<fitur>.routes.ts`, `<fitur>-api.ts` (adaptor SDK), dan komponen halaman. Komponen presentational menerima input dan tidak memanggil API (INT-NR-011). State halaman memakai `signal`, `computed`, dan `resource` atau `httpResource`; tidak ada library state global.

### Shell dan navigasi

`App` merender `<LayoutWrapperDefault>` dengan `[data]="navigation()"`, `[brand]`, `[user]`, `layout-type` dari data route (`'vertical'` default, `'empty'` untuk login), `nav-type="sidebar"`, `(logout)="session.logout()"`, dan `<router-outlet />` di dalamnya. Label wrapper (`skip-link-label`, `mobile-nav-label`, `close-mobile-nav-label`) ditandai i18n. Sebelum implementasi, periksa export publik versi library yang terpasang dan jangan menyalin kode internal library.

Navigasi (`shell/navigation.ts`, `NavigationItem[]` dari `@ojiepermana/angular/navigation`, disaring permission):

| Grup | Item | Route | Permission |
|---|---|---|---|
| Network Registry | Dashboard | `/network-registry` | `nr.view` |
| | Connections | `/network-registry/connections` | `nr.view` tanpa batas kantor |
| | Site Mapping | `/network-registry/site-mapping` | `nr.view` |
| | Sites | `/network-registry/sites` | `nr.view` |
| | IP History | `/network-registry/ip-history` | `nr.view` |
| | Diagnostics | `/network-registry/diagnostics` | `nr.resolve.diagnose` |
| | Sync & Audit | `/network-registry/sync-audit` | `nr.view` tanpa batas kantor atau `nr.audit.read` |
| | Settings | `/network-registry/settings` | `nr.settings.manage` |
| Master | Kantor | `/offices` | `nr.view` |
| Akses | Users | `/users` | `iam.users.manage` |

Brand: `name` dan `title` "Network Registry", ikon Material symbol `lan`. User: `displayName` dan `email` dari `SessionStore`.

### i18n

- `@angular/localize`, source locale `id`, terjemahan `en` di `src/locale/messages.en.xlf`. Semua teks memakai atribut `i18n` atau `$localize` dengan id eksplisit (`@@nr.connections.title`).
- Build menghasilkan `dist/frontend/browser/id/` dan `/en/` dengan base href masing masing. Server statis mengarahkan `/` ke locale dari `iam.users.locale` setelah login, atau `Accept-Language` sebelum login, default `id`.
- Ganti bahasa di menu user memanggil `PATCH /api/auth/me` (`locale`, spec 0003), lalu pindah ke base href locale lain.
- Kode status domain (`matched`, `stale`, `egress_public`) ditampilkan sebagai label terjemahan dengan kode asli di tooltip.
- `ng serve` development berjalan satu locale sekaligus (`--configuration=id` atau `en`).

### Halaman

Semua halaman memakai komponen `shared/state-view` untuk state loading (skeleton), empty (komponen `empty` library), error (alert dengan correlation id), forbidden, serta badge `freshness-badge` (fresh, stale, disabled, never) dan `capability-badge` (supported, unsupported, unverified dengan reason di tooltip).

| Halaman | Isi wajib | Aksi dan validasi | Endpoint |
|---|---|---|---|
| Login | Email, password, pesan generik gagal, info terkunci tidak dibedakan | Validasi form, `autocomplete` benar | `POST /auth/login` |
| Ganti password | Password lama dan baru, aturan panjang | Wajib saat `mustChangePassword` | `POST /auth/password` |
| PAGE-NR-001 Dashboard | Kartu: connection per status, site mapped dan unmapped, source fresh dan stale, konflik IP current, sync gagal 24 jam; daftar 10 perubahan terbaru | Setiap kartu menuju daftar terfilter; tidak ada kata "uptime" atau "online kantor" | `GET /network-registry/dashboard` |
| PAGE-NR-002 Connections | Tabel: nama, provider dan mode, status, capability ringkas, mapped count, last attempt, last success, error ringkas | Tambah dan edit (dialog form: nama, provider hanya UniFi aktif dan lainnya "planned" nonaktif, access mode, API key, interval), test, sync now, disable atau enable, rotate; konfirmasi untuk disable dan rotate | connections, test, sync, rotate-credential, providers |
| PAGE-NR-003 Site Mapping | Tabel external site: nama, host, connection, kantor terikat, status mapping, konflik | Bind, unbind, remap dengan combobox kantor yang dibatasi scope; konflik `MAPPING_CONFLICT` atau `VERSION_CONFLICT` menampilkan data terbaru; teks "remap tidak mengubah history" | external-sites, binding, offices |
| Sites | Tabel kantor dengan jumlah binding, source, freshness, IP current | Filter freshness, cari | `GET /network-registry/sites` |
| PAGE-NR-004 Site Detail | Tab Overview (ringkasan, binding, IP current dengan role dan basis, coverage IPv6, capability tidak didukung), Gateways & WAN (unknown ditulis "tidak diketahui", bukan kosong), IP History (periode kantor ini), Sources (source heartbeat dan provider, last heartbeat, route label, routing assertion, credential) | Buat source, buat credential (tampil sekali), rotate, revoke, disable, quarantine, ubah routing assertion dengan catatan wajib, panduan deployment collector | sites/:officeId, sources, credentials, ip-history |
| PAGE-NR-005 IP History | Tabel periode: IP, family, kantor, source atau WAN, first seen, last seen, expires, jendela deteksi, status, reason, basis | Filter rentang waktu, IP, kantor, source; drill down ke evidence (drawer); teks "waktu teramati, bukan waktu pasti perubahan" | ip-history, observations |
| PAGE-NR-006 Diagnostics | Form IP dan waktu historis opsional; hasil: status, kandidat, kandidat tersamar, reason, freshness, evidence | Validasi alamat di klien dengan pesan yang sama dengan server; field `at` hanya tampil dengan `nr.resolve.historical`; peringatan shared egress selalu tampil untuk `matched` | diagnostics/resolve |
| PAGE-NR-007 Sync & Audit | Tab Sync runs (status, trigger, actor, mulai, durasi, counts, issue, correlation id) dan Audit (aksi, actor, target, hasil, waktu, before dan after tersanitasi) | Detail run, retry dan cancel berizin, salin correlation id | sync-runs, audit-logs |
| Kantor | Tabel kode, nama, timezone, aktif | Buat dan edit dengan combobox timezone IANA, nonaktifkan dengan konfirmasi | org/offices |
| Users | Tabel email, nama, role, batas kantor, aktif, login terakhir | Buat, edit role dan kantor, reset password, nonaktifkan; pesan `SCOPE_RESTRICTED_ROLE` dan `LAST_ADMIN` | iam/users, iam/roles |
| Settings | Nilai dan batas settings | Simpan dengan validasi batas | network-registry/settings |

Aturan label hasil resolver (`shared/resolver-result`):
- `matched`: judul "Satu kandidat kantor berdasarkan IP" (en: "One office candidate by IP"), warna netral atau info, bukan hijau sukses; selalu dengan catatan "Bukan bukti lokasi, perangkat, atau identitas. IP bisa dipakai bersama."
- `ambiguous`: daftar kandidat, tidak ada kandidat yang disorot sebagai utama.
- `stale`, `unknown`, `unavailable`: dibedakan jelas; `unavailable` menyebut gangguan sistem, bukan "tidak ditemukan".
- Tidak ada label "kantor terverifikasi" atau ikon centang di mana pun untuk hasil IP (INT-NR-011).

### Komponen library yang dipakai

Dari `@ojiepermana/angular/component/*`: `table`, `pagination`, `button`, `dialog`, `alert-dialog`, `sheet` (drawer evidence), `form`, `input`, `label`, `select`, `combobox`, `checkbox`, `switch`, `date-picker`, `badge`, `tabs`, `card`, `alert`, `toast`, `skeleton`, `empty`, `tooltip`, `dropdown-menu`, `timeline` (urutan periode di site detail). Komposisi di `shared/` membungkus komponen ini, tidak membuat ulang komponen dasar.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| Navigasi | item yang tampil | `SessionStore.permissions` dan `officeScope` dari `GET /auth/me` |
| Semua waktu | zona waktu | `office.timezone` dari response jika halaman dalam konteks kantor; selain itu `Asia/Jakarta` |
| Semua waktu | waktu relatif | Selisih dari jam klien, diperbarui setiap 30 detik |
| Locale | bahasa aktif | Base href build; preferensi dari `iam.users.locale` |
| Error | pesan | `code` di problem body dipetakan ke pesan i18n di `core/errors`; tidak ada pesan backend mentah |
| Error | correlation id | `correlationId` problem body |
| Sync now | status | Polling `GET /sync-runs/:id` |
| Capability badge | status dan reason | `capabilityReport` connection |
| Freshness badge | status | Field freshness dari response site atau source (dihitung server, spec 0004) |
| Kandidat tersamar | jumlah | `maskedCandidateCount` hasil resolver |
| Combobox kantor | pilihan | `GET /org/offices` yang sudah difilter scope di server |
| Secret heartbeat | token | Response `POST /sources/:id/credentials`, hanya di memori komponen dialog |

**Key invariants**:
- Tidak ada secret, token, atau API key di `localStorage`, `sessionStorage`, URL, atau log konsol.
- Guard UI hanya kenyamanan; setiap aksi tetap diperiksa backend (spec 0003).
- Semua permintaan data lewat SDK; tidak ada `fetch` atau `HttpClient` langsung ke URL yang ditulis tangan.

**Security model**:
- Cookie sesi httpOnly tidak bisa dibaca JavaScript; interceptor hanya menambah header CSRF dan correlation id.
- CSP produksi: `default-src 'self'`, tanpa `unsafe-eval`; font dan ikon di bundel lokal.
- Tampilan kandidat mengikuti proyeksi server; frontend tidak pernah menerima data kandidat tersamar.

**Configuration required**:
- Tidak ada env frontend khusus; URL API relatif (`provideApiConfiguration('')`) dan proxy dev ke `127.0.0.1:3000`.

**Critical test scenarios**:
- Happy path E2E (Playwright, fake provider): login, buat kantor, buat connection, test, sync now sampai selesai, bind site, lihat site detail dan history, diagnostics resolve `matched` dengan catatan shared egress, verifies **AC-NR-041**, **AC-NR-021**, **AC-FE-07**.
- State: setiap halaman dengan response kosong, error 503, 403, capability unverified, source stale (Vitest dengan SDK tiruan), verifies **AC-NR-041**, **AC-FE-09**.
- Auth/permission: login sebagai viewer, menu mutasi tidak ada, buka URL settings langsung, state forbidden, panggilan API manual tetap 403, verifies **AC-FE-02**.
- Secret: buat credential, tutup dialog, cari token di storage dan DOM; buka edit connection, field API key kosong, verifies **AC-FE-05**, **AC-FE-06**.
- i18n: build `en`, jalankan E2E singkat dalam bahasa Inggris; `extract-i18n` tanpa pesan baru yang belum diterjemahkan, verifies **AC-FE-03**.
- Aksesibilitas: navigasi keyboard penuh di connections dan site mapping; pemeriksaan axe di Playwright untuk semua halaman, verifies **AC-FE-11**.

## Build plan

1. (T1) Scaffold Angular 22.2 di `apps/frontend` (standalone, Vitest, i18n `id` dan `en`, Tailwind 4 sesuai library), `proxy.conf.json`, `sdk.config.json`, satisfies **AC-FE-03**, **AC-FE-12**
2. (T1) `core/session`, guard, interceptor, `core/errors`, `core/time`, satisfies **AC-FE-02**, **AC-FE-04**, **AC-FE-09**
3. (T1) Shell `LayoutWrapperDefault` vertical dan empty, navigasi berbasis permission, logout, satisfies **AC-FE-01**, **AC-FE-02**
4. (T1) `shared/`: state-view, cursor-pager, confirm-dialog, capability-badge, freshness-badge, resolver-result, satisfies **AC-NR-021**, **AC-FE-08**, **AC-FE-10**
5. (T1) Halaman login, Connections (daftar dan buat), Diagnostics, satisfies **AC-NR-021**, **AC-FE-05**, **AC-NR-041**
6. (T2) Connections lengkap: test, sync now dengan polling, rotate, disable, capability, satisfies **AC-FE-05**, **AC-FE-07**, **AC-FE-10**
7. (T3) Tab Sources di Site Detail: source, credential sekali tampil, revoke, quarantine, routing assertion, panduan collector, satisfies **AC-FE-06**, **AC-FE-10**
8. (T4) Dashboard, Site Mapping, Sites, Site Detail, IP History dengan drawer evidence, Sync & Audit, Kantor, Users, ganti password, satisfies **AC-NR-041**, **AC-FE-08**, **AC-FE-10**
9. (T5) Settings dan pilihan bahasa, satisfies **AC-FE-03**
10. (T4) Test Vitest per halaman untuk semua state dan E2E Playwright alur utama serta peran viewer, satisfies **AC-NR-041**, **AC-FE-02**, **AC-FE-11**
11. (T7) Terjemahan `en` lengkap, audit aksesibilitas axe, pencarian secret di bundle, satisfies **AC-FE-03**, **AC-FE-11**, **AC-FE-12**

## Consequences

**Positive**:
- Shell, navigasi, drawer mobile, dan skip link datang dari library; tim fokus ke halaman domain.
- SDK yang digenerate membuat perubahan kontrak langsung terlihat sebagai error typecheck.

**Negative / tradeoffs**:
- Angular i18n build time berarti dua artefak build, dan ganti bahasa memuat ulang aplikasi; setiap teks baru wajib diterjemahkan sebelum CI lulus.
- Pagination cursor tanpa total membuat tabel tidak bisa menampilkan "halaman 3 dari 10".
- Polling status sync menambah request selama run berjalan; cukup untuk V1 tanpa WebSocket.

**Neutral**:
- `@ojiepermana/angular` 22.1.14 dipakai sampai 22.2.x terbit; API wrapper harus dicek ulang saat naik versi.

## Follow-up

- [ ] Putuskan cara menyajikan dua locale di produksi (server statis dengan redirect `Accept-Language`) bersama keputusan hosting di spec 0001.

## Rationale

Reasoning and options: see [rationale.md](rationale.md).
