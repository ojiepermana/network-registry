# 0007. Rationale: kontrak API, OpenAPI, dan SDK

## Context

INT-NR-008 memberi daftar resource semantik dan meminta project menentukan prefix, versioning, error envelope, pagination, schema, operationId, dan kode error, dengan OpenAPI sebagai kontrak dan SDK Angular dari generator yang sudah ada. Project ini tidak punya konvensi sebelumnya. Frontend dua bahasa dan tujuh halaman lebih bergantung pada kontrak yang stabil; heartbeat dan resolver internal adalah konsumen mesin yang tidak boleh ikut ke SDK browser.

Anda memilih `/api` tanpa versi, RFC 9457 problem+json, dan cursor di semua daftar. Anda juga sudah memilih validasi `t` bawaan Elysia, yang membuat schema route bisa langsung menghasilkan OpenAPI.

## Options considered

### Option 1: REST dengan OpenAPI dari route Elysia sebagai sumber kebenaran

**Pros**:
- Kontrak ditulis sekali, di tempat yang juga memvalidasi request.
- SDK dan contract test otomatis mengikuti.

**Cons**:
- Kualitas dokumen OpenAPI bergantung pada disiplin deklarasi route; butuh `api:check`.

### Option 2: OpenAPI ditulis tangan lebih dulu (design first), route mengikuti

**Pros**:
- Kontrak bisa direview sebelum kode.

**Cons**:
- Dua sumber yang harus disinkronkan; route dan dokumen mudah melenceng.

### Option 3: RPC bertipe (Eden Treaty) tanpa OpenAPI untuk frontend

**Pros**:
- Tipe end to end langsung dari Elysia tanpa generator.

**Cons**:
- PRD menjadikan OpenAPI kontrak dan meminta SDK dari generator project; Eden tidak cocok dengan pola `@ojiepermana/angular:sdk` dan HttpClient Angular.

## Rationale

Option 1 dipilih karena menghilangkan kemungkinan dua kontrak yang berbeda: schema yang memvalidasi request adalah schema yang sama di `openapi.json` dan di SDK. `api:check` menutup kelemahan utamanya dengan membuat route tanpa `operationId`, tanpa schema response, atau tanpa permission gagal di CI, yang juga mengubah AC-NR-035 dari kebiasaan menjadi aturan yang dicek mesin.

Cursor ditandatangani HMAC karena cursor berisi nilai sort dan id; tanpa tanda tangan, klien bisa menyusun cursor untuk memindai data. Data di luar batas kantor dijawab 404 agar keberadaan kantor lain tidak bocor lewat perbedaan 403 dan 404. Tanpa versi di path adalah pilihan Anda; karena konsumen utama adalah frontend sendiri yang SDK digenerate bersama, risikonya rendah, dan untuk resolver internal saya catat follow up versioning jika consumer bertambah. Metrik dilindungi token dan tanpa label dengan cardinality tinggi sesuai REQ-NR-011.

## References

**Project sources**:
- `PRD.md` INT-NR-008 (resource, error minimum, OpenAPI, SDK), VAL-NR-008 (batas filter, sort, pagination, payload, rate limit), REQ-NR-011 (metrik), AC-NR-042.
- Spec [0003](../0003-iam-auth-otorisasi/index.md), [0004](../0004-domain-ingestion-resolver/index.md), [0005](../0005-provider-unifi-sync/index.md), [0006](../0006-heartbeat-collector/index.md) untuk endpoint yang dirujuk.
- Project `foundation`: pola `api:sync` dan generator `@ojiepermana/angular:sdk` ke `apps/frontend/sdk/`.
- Skill terpasang `elysiajs`.

**Practices & standards**:
- RFC 9457 Problem Details for HTTP APIs.
- Keyset pagination dengan cursor opaque bertanda tangan.
- Format eksposisi teks Prometheus dengan label dengan cardinality rendah.

**Links** (diverifikasi saat desain):
- npm registry @elysia/openapi (1.4.16): https://registry.npmjs.org/@elysia/openapi
- npm registry elysia (1.4.30): https://registry.npmjs.org/elysia
