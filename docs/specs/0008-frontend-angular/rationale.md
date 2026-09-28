# 0008. Rationale: frontend Angular

## Context

REQ-NR-009 dan INT-NR-011 meminta tujuh halaman dengan state lengkap (loading, empty, error, forbidden, stale, unsupported), pagination dan filter di server, akses keyboard, waktu absolut dan relatif, serta pemakaian ulang layout, navigasi, tabel, form, dialog, dan toast project. Anda menetapkan `@ojiepermana/angular` sebagai library komponen dan default layout wrapper sebagai layout, sidebar vertical, serta antarmuka dua bahasa (Indonesia dan Inggris) dengan Angular i18n.

Risiko khas domain ini adalah UI yang membuat hasil IP terbaca sebagai kepastian (ikon centang hijau "kantor terverifikasi"), dan secret yang muncul kembali lewat form edit. Kontrak API berasal dari SDK hasil generate (spec 0007), dan dua halaman utama (connections dan site detail) memuat aksi sensitif.

## Options considered

### Option 1: Standalone components, signals, shell `LayoutWrapperDefault`, i18n build time

**Pros**:
- Shell lengkap (sidebar, drawer mobile, skip link, logout) dari library.
- Angular i18n resmi, terjemahan diekstrak dan dicek di CI.

**Cons**:
- Dua artefak build per locale dan reload saat ganti bahasa.

### Option 2: Shell dirakit manual dari `Layout`, `LayoutVertical`, `LayoutNavigation`

**Pros**:
- Kontrol penuh atas susunan shell.

**Cons**:
- Mengulang pekerjaan wrapper (drawer mobile, landmark navigasi, skip link) dan bertentangan dengan keputusan memakai default layout wrapper.

### Option 3: i18n runtime (library terjemahan runtime)

**Pros**:
- Satu build, ganti bahasa tanpa reload.

**Cons**:
- Dependency tambahan di luar Angular resmi; Anda memilih Angular i18n.

## Rationale

Option 1 dipilih karena `LayoutWrapperDefault` sudah memenuhi kebutuhan shell yang PRD minta dipakai ulang: navigasi berbasis data, drawer mobile, landmark, skip link yang bisa dilokalkan, dan satu output logout. Wrapper menerima `NavigationItem[]` biasa, sehingga penyaringan menu per permission cukup dengan `computed` di `shell/`. Memakai wrapper yang sama dengan `layout-type="empty"` untuk login menjaga satu root layout di seluruh aplikasi.

Signals dan `resource` cukup untuk state halaman yang lokal; tidak ada kebutuhan state global selain sesi. Aturan label resolver ditulis eksplisit di spec karena ini satu satunya tempat di mana AC-NR-021 bisa gagal tanpa ada bug di backend. Angular i18n build time sesuai pilihan Anda; biayanya dua build dan reload saat ganti bahasa, yang wajar untuk tool admin.

## References

**Project sources**:
- `PRD.md` REQ-NR-009 (halaman dan state), INT-NR-011 (reuse, smart dan presentational, label), AC-NR-021, AC-NR-041.
- Source `@ojiepermana/angular`: `packages/angular/theme/layout/README.md` bagian `LayoutWrapperDefault`, `theme/layout/wrapper/shared/identity.ts` (`BrandIdentity`, `UserIdentity`), `navigation/types/navigation.types.ts` (`NavigationItem`).
- Spec [0007](../0007-api-openapi-kontrak/index.md) SDK dan endpoint.
- Skill terpasang `angular-developer`, `angular-new-app`, `frontend-design`.

**Practices & standards**:
- Smart dan presentational component; state lokal dengan signals.
- WCAG untuk fokus dialog, label form, dan pengumuman status async.

**Links** (diverifikasi saat desain):
- npm registry @ojiepermana/angular (22.1.14, entry point `./theme/layout/wrapper` tersedia): https://registry.npmjs.org/@ojiepermana/angular
- npm registry @angular/core (22.2.0): https://registry.npmjs.org/@angular/core
