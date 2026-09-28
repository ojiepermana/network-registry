import { Elysia } from 'elysia';

// Komposisi Elysia tanpa listen, dipakai oleh index.ts, export OpenAPI, dan test.
// Plugin dan route ditambahkan per spec 0007.
export const createApp = () => new Elysia({ name: 'network-registry', prefix: '/api' });

export type App = ReturnType<typeof createApp>;
