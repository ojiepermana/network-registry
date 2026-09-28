# 0006. Rationale: heartbeat, trusted ingress, dan reference collector

## Context

Alamat WAN yang dilaporkan router tidak selalu sama dengan IP keluar yang dilihat server (NAT berlapis, CGNAT, VPN, multi WAN). PRD meminta jalur pelengkap: collector di kantor mengirim heartbeat, backend mencatat IP sumber request. Jalur ini hanya berharga jika IP sumber benar; header seperti `X-Forwarded-For` bisa dipalsukan oleh siapa pun di luar batas proxy tepercaya, dan topologi ingress produksi belum diketahui (OQ-NR-004).

Heartbeat berjalan tanpa credential UniFi, dengan secret per source yang bisa dirotasi dan dicabut. Body request tidak boleh dipercaya untuk kantor, scope, atau IP. Collector harus sederhana (tanpa installer lintas OS atau auto update) tetapi punya timeout, retry, idempotency, dan log yang tidak membocorkan secret. Anda memilih collector berupa binary Bun plus image Docker di `apps/collector`, dan konfigurasi ingress eksplisit karena jalur produksi belum pasti.

## Options considered

### Option 1: Bearer credential per source, ingress dikonfigurasi eksplisit dengan default socket peer

**Pros**:
- Default aman tanpa konfigurasi: tidak ada header yang dipercaya.
- Mendukung proxy sendiri, `Forwarded`, dan Cloudflare lewat konfigurasi yang sama.

**Cons**:
- Deployment di belakang proxy wajib mengisi konfigurasi, atau semua heartbeat tidak berguna.

### Option 2: Selalu percaya `X-Forwarded-For` elemen pertama

**Pros**:
- Tanpa konfigurasi.

**Cons**:
- Dilarang PRD (INT-NR-009); siapa pun bisa menetapkan IP kantor.

### Option 3: Mutual TLS dengan sertifikat per collector

**Pros**:
- Identitas collector lebih kuat dan tidak berupa secret yang bisa disalin dari log.

**Cons**:
- Butuh PKI, penerbitan dan pencabutan sertifikat, dan terminasi TLS yang meneruskan identitas klien melewati proxy; berat untuk V1.

### Option 4: Collector skrip shell dengan curl dan timer

**Pros**:
- Sangat ringan.

**Cons**:
- Idempotency, retry dengan `eventId` sama, dan redaksi log sulit dijaga; Anda memilih binary Bun.

## Rationale

Option 1 dipilih karena memenuhi INT-NR-009 tanpa bergantung pada keputusan topologi yang belum ada. Membaca rantai dari kanan dan melewati hanya hop tepercaya adalah satu satunya cara yang benar untuk header forwarding, karena hop paling kiri dikendalikan klien. Status `unresolved` yang tidak eligible memastikan kesalahan konfigurasi menghasilkan "tidak tahu", bukan kepastian palsu.

Credential bearer 256 bit dengan hash SHA-256 cukup untuk secret acak berentropi tinggi (tidak butuh hash lambat seperti password), dan pola key id plus secret memungkinkan lookup tanpa memindai tabel. Rotasi dengan dua credential aktif sementara menghindari jeda observasi saat penggantian. mTLS dicatat sebagai peningkatan masa depan jika risiko credential tersalin menjadi nyata. Binary Bun memberi collector satu artefak tanpa runtime terpisah di host kantor, dan berbagi schema heartbeat dengan backend lewat `packages/contracts` sehingga kontrak tidak melenceng.

## References

**Project sources**:
- `PRD.md` REQ-NR-007, INT-NR-006 (idempotency heartbeat), INT-NR-009 (trust boundary ingress), BR-NR-010, BR-NR-013, VAL-NR-006.
- `PRD.md` S04 (MDN `X-Forwarded-For`) sebagai dasar aturan pembacaan header.
- Spec [0004](../0004-domain-ingestion-resolver/index.md) `IngestionService`; spec [0003](../0003-iam-auth-otorisasi/index.md) pemakaian IP sesi.

**Practices & standards**:
- RFC 7239 header `Forwarded`.
- Pembacaan rantai proxy dari kanan dengan daftar proxy tepercaya.
- Perbandingan secret constant time.

**Links** (diverifikasi saat desain):
- Bun (runtime dan `bun build --compile`): https://bun.com
