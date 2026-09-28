# Network Registry

Registry koneksi provider jaringan (V1: UniFi): memetakan site ke kantor, mengumpulkan observasi IP lewat polling dan heartbeat, menyimpan history, dan memberi konteks jaringan ke aplikasi lain. Kebutuhan produk ada di `PRD.md`.

## Stack

- **Language / Runtime**: TypeScript 6.0.3 di Bun 1.4.2; Node.js 24 hanya untuk Angular CLI dan build frontend
- **Framework**: Elysia 1.4.30 (validasi `t`, `@elysia/openapi`) untuk backend; Angular 22.2.0 dengan `@ojiepermana/angular` 22.1.14 dan Tailwind CSS 4 untuk frontend
- **Database**: PostgreSQL 18 lewat `Bun.SQL`, SQL langsung tanpa ORM, migration SQL berurutan di `database/migrations/`
- **Key dependencies**: `ipaddr.js` (parser IP), `@angular/localize` (i18n `id` dan `en`), Vitest lewat Angular CLI, Playwright, k6
- **Package manager**: Bun, satu `package.json` di root (tanpa manifest per app), versi dipin exact (`bunfig.toml`); dependency baru hanya lewat keputusan yang tercatat di spec

## Build approach

Tracer Bullet (satu benang tipis lewat semua lapisan dulu, lalu ditebalkan per slice).

## Commands

```bash
bun install                                         # install
bun run dev:backend                                 # backend watch di 127.0.0.1:3000
bun run dev:frontend                                # ng serve di :4200, proxy /api ke backend
bun run typecheck                                   # tsc backend, packages, dan frontend
bun test --path-ignore-patterns='apps/frontend/**'  # bun:test untuk backend, packages, scripts
bun run test:frontend                               # Vitest lewat ng test
bun run build:backend && bun run build:frontend     # build ke dist/
```

## Specs

Disimpan di `docs/specs/NNNN-judul/index.md` (keputusan) plus `rationale.md` (alasan). Spec 0001 memuat stack, batas folder, konvensi lintas lapisan, dan daftar script root yang direncanakan. Status build ada di `docs/scope/scope.md`.

## Rules

- Clean Architecture: `domain` (tipe kanonik, policy murni) dan `application` (service) ada di `packages/registry-core/src/`; infrastructure adalah `repositories/`, `providers/<vendor>/`, `packages/db`, `packages/platform`; presentation adalah `apps/backend/src/routes` dan `apps/frontend`.
- Dependensi hanya mengarah ke dalam. `domain` tidak mengimpor Elysia, `Bun.SQL`, HTTP, atau `providers/`; `application` tidak mengimpor `providers/*` (dijaga test arsitektur, AC-DOM-01). Infrastructure mengimplementasikan port yang didefinisikan di dalam (`ProviderAdapter`, interface repository). Batas spec 0001: `packages/*` tidak mengimpor `apps/*`, frontend hanya memakai SDK hasil generate, kode vendor hanya di `providers/<vendor>/`, import antar folder lewat alias `@nr/*`.
- Service application adalah orkestrator tipis; aturan bisnis ada di `domain`. Route Elysia hanya berisi validasi `t`, macro `permission`, lalu memanggil service: tanpa SQL, dan tanpa tipe baris database di response.
- TypeScript strict di semua app, termasuk `strict` dan `strictTemplates` di frontend. Tanpa `any` (pakai `unknown` lalu narrowing); `switch` pada union ditutup dengan cek `never`.
- Penamaan: nama file huruf kecil dengan tanda hubung; backend dan packages memakai akhiran `.routes.ts`, `.service.ts`, `.repository.ts`; Angular mengikuti style guide Angular seperti scaffold (`app.ts`, tanpa akhiran `.component`) plus `<fitur>.routes.ts` dan `<fitur>-api.ts`; tipe PascalCase, nilai camelCase, kode error `SCREAMING_SNAKE_CASE`. Named export saja, tanpa `export default`. TSDoc singkat pada setiap export `packages/*/src/index.ts` dan setiap method service application.
- Konvensi lintas lapisan spec 0001 wajib: error RFC 9457 dengan `code` stabil, env divalidasi saat startup (`packages/platform/config`), waktu `timestamptz` UTC, ID `uuidv7()` dari database, enum sebagai `text` plus `CHECK`, pagination cursor, `X-Request-Id` di log dan audit, secret tidak pernah masuk log atau response.
- Frontend: komponen UI dari `@ojiepermana/angular`; state dengan `signal`, `computed`, `resource`; komponen presentational tidak memanggil API; semua teks ditandai i18n dengan id eksplisit (`@@nr.<area>.<kunci>`); baseline WCAG AA (keyboard, label, fokus kembali setelah dialog, `aria-live`, AC-FE-11).
- Test: setiap perubahan membawa unit test di samping kode (`*.test.ts` untuk bun:test, `*.spec.ts` untuk frontend). Domain dan application dites tanpa I/O memakai fake port, bukan mock infrastructure. Perubahan SQL atau lintas modul juga membawa test di `tests/integration` dengan PostgreSQL 18 nyata. Playwright dan k6 menyusul di slice speknya.
- Bahasa: docs, spec, `AGENTS.md`, dan komentar kode dalam bahasa Indonesia; identifier, nama test, pesan log, kode error, dan pesan commit dalam bahasa Inggris. Commit memakai Conventional Commits dengan scope area (`feat(resolver): ...`).

## Tooling

Dipilih lewat /audit, dipasang oleh `/develop tooling`:
- Format: Prettier (`singleQuote: true`, `printWidth: 100`, `trailingComma: "all"`, `semi: true`, parser `angular` untuk `*.html`); script `format` dan `format:check`.
- Lint: ESLint flat config, `typescript-eslint` `strictTypeChecked` plus `stylisticTypeChecked`, `angular-eslint` recommended plus aturan aksesibilitas template; script `lint`.
- Types: nyalakan `strict` dan `strictTemplates` di `apps/frontend/tsconfig.json` (scaffold belum memilikinya); `bun run typecheck` harus bersih.
- Pre commit: Husky plus `lint-staged` (Prettier dan ESLint pada file staged), lalu `bun run typecheck`.
- CI: GitHub Actions saat push dan PR menjalankan `format:check`, `lint`, `typecheck`, bun test, `test:frontend`, dan `tests/integration` dengan service PostgreSQL 18, dirangkum script root `ci`. Gate spec lain (`api:check`, i18n, e2e) ditambahkan saat speknya dibangun.

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone

## Agent skills

- [elysiajs](~/.agents/skills/elysiajs/): `elysiajs/skills`, route, plugin, macro, validasi `t`, dan OpenAPI Elysia untuk `apps/backend`
- [angular-developer](~/.agents/skills/angular-developer/): `angular/skills`, komponen, signal, routing, forms, test, dan aksesibilitas untuk `apps/frontend`

Declined: PostgreSQL, Bun, Playwright, k6 (skill dan MCP, spec 0001), Vitest, Angular testing, Tailwind CSS 4, GitHub Actions, Dockerfile (skill, /audit)
MCP servers: ESLint `@eslint/mcp` (recommended), GitHub `github-mcp-server` (recommended)

## Context files

<!-- Nested AGENTS.md files are listed here as they are created -->

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
