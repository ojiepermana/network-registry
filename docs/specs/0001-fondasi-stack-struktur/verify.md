# Verify: Fondasi stack dan struktur · spec 0001 · updated 2026-09-28
_Spec 0001 adalah spec keputusan tanpa acceptance criteria. Langkah di bawah diturunkan dari `## Proposed stack`, `## Struktur repository`, `## Konvensi lintas lapisan`, dan "Done when" fitur 1 di scope. `/check verify` menjalankannya; `/test` mengunci yang tahan lama._

## Commands
- [x] `bun --version` → `1.4.2`, sama dengan `packageManager` di `package.json` → Proposed stack: Runtime
- [x] `node --version` → `v24.x` (sesuai `.nvmrc`), dipakai Angular CLI → Proposed stack: Tooling Angular
- [x] `bun install --frozen-lockfile` → sukses tanpa mengubah `bun.lock` → Proposed stack: satu manifest
- [x] `find . -name package.json -not -path '*/node_modules/*'` → hanya `./package.json` → Aturan batas: tanpa `package.json` per app
- [x] Buka `package.json` → `elysia` `1.4.30`, `@angular/*` `22.2.0`, `typescript` `6.0.3` (dalam rentang peer Angular 22.2.0 `>=6.0 <6.1`), `@types/bun` `1.4.2`; semua versi tanpa `^` atau `~` → Proposed stack: Backend, Frontend, Bahasa
- [x] `bun run typecheck` → keluar 0 (backend, packages, dan frontend app plus spec) → Done when: `typecheck` lulus
- [x] `bun run build:backend` → menghasilkan `dist/backend/index.js` → Done when: build lulus
- [x] `bun run build:frontend` → menghasilkan `dist/frontend/browser/` tanpa error → Done when: build lulus
- [x] `bun run test:frontend` → Vitest lewat Angular CLI, 2 test lulus → Proposed stack: Test (Vitest)
- [x] `bun run dev:backend`, lalu `curl -i http://127.0.0.1:3000/api/probe` → Elysia menjawab `404 NOT_FOUND` (wajar sampai route health spec 0007 ada); `lsof -iTCP:3000 -sTCP:LISTEN` → hanya `127.0.0.1`, bukan `0.0.0.0` → Konvensi: Port development
- [x] Hentikan `dev:backend` dengan Ctrl+C → log `backend shutting down` lalu proses keluar bersih → Struktur: `index.ts` (shutdown)
- [x] Dengan backend tetap jalan, `bun run dev:frontend`, buka `http://localhost:4200/` → judul tab dan heading `Network Registry` → Done when: `dev:frontend` jalan
- [x] `curl -i http://localhost:4200/api/probe` → `404 NOT_FOUND` dari Elysia (bukan `index.html` Angular), artinya proxy `/api` meneruskan ke `127.0.0.1:3000` → Konvensi: frontend 4200 dengan proxy `/api`
- [x] Buat sementara `packages/platform/src/index.ts` berisi satu export, impor lewat `@nr/platform` dari file di `scripts/`, lalu jalankan dengan `bun run`, `bun run typecheck`, dan `bun build` → ketiganya berhasil; hapus lagi file sementaranya → Aturan batas: path alias `@nr/*`

## Struktur
- [x] Folder ada: `apps/backend/src`, `apps/frontend/src`, `packages/{platform,db,registry-core,contracts}/src`, `database/{migrations,seeds}`, `scripts`, `tests/integration` → Struktur repository
- [x] Belum ada `apps/collector`, `apps/worker`, `docker-compose.yml`, `database/migrate.ts`: masing masing dibuat oleh tugas build spec 0006, 0009, dan 0002 → Struktur repository (install tepat waktu)

## Acceptance-criteria coverage
- Spec 0001 tidak punya `AC-N`. Setiap bagian "Done when" fitur 1 (`dev:backend`, `dev:frontend`, `typecheck`, build, struktur folder) punya minimal satu langkah di atas, begitu juga setiap baris stack yang dipasang di scaffold ini (runtime, bahasa, backend, frontend inti, Vitest) dan setiap konvensi yang berlaku sekarang (port, proxy, path alias, satu manifest). Baris stack lain diverifikasi oleh spec lapisannya saat dipasang.
