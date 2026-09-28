import { describe, expect, test } from 'bun:test';
import { createApp } from './app.ts';

// Kontrak app.ts (spec 0001 dan 0007): semua route di bawah /api, dan app bisa
// dibuat tanpa listen supaya export OpenAPI dan test tidak membuka port.
describe('createApp', () => {
  test('serves routes added to the app under the /api prefix', async () => {
    const app = createApp().get('/probe', () => 'ok');

    const res = await app.handle(new Request('http://localhost/api/probe'));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  test('does not serve a route outside the /api prefix', async () => {
    const app = createApp().get('/probe', () => 'ok');

    const res = await app.handle(new Request('http://localhost/probe'));

    expect(res.status).toBe(404);
  });

  test('answers an unknown /api path with 404', async () => {
    const app = createApp();

    const res = await app.handle(new Request('http://localhost/api/does-not-exist'));

    expect(res.status).toBe(404);
  });

  test('builds the app without starting a server', () => {
    const app = createApp();

    expect(app.server).toBeNull();
  });

  test('returns a fresh app on every call so routes do not leak between instances', async () => {
    createApp().get('/only-in-first', () => 'first');
    const second = createApp();

    const res = await second.handle(new Request('http://localhost/api/only-in-first'));

    expect(res.status).toBe(404);
  });
});
