import { afterEach, describe, expect, test } from 'bun:test';

// Menjalankan entry backend sebagai proses nyata: bind 127.0.0.1:3000 (konvensi
// port development spec 0001), log JSON per baris, dan shutdown bersih saat sinyal.
const ENTRY = `${import.meta.dir}/index.ts`;
const BASE_URL = 'http://127.0.0.1:3000';
const TEST_TIMEOUT_MS = 10_000;
const STARTUP_TIMEOUT_MS = 5_000;

type LogLine = Record<string, unknown>;

const request = (path: string) => fetch(`${BASE_URL}${path}`);

const isListening = () => request('/api').then(
  () => true,
  () => false,
);

const portInUse = await isListening();
if (portInUse) {
  console.warn(`index.test.ts dilewati: ${BASE_URL} sudah dipakai (dev:backend masih jalan?)`);
}

const spawnBackend = () => {
  const proc = Bun.spawn([process.execPath, ENTRY], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let stdout = '';
  const drained = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout) stdout += decoder.decode(chunk, { stream: true });
  })();

  return {
    proc,
    drained,
    stdout: () => stdout,
    logs: () =>
      stdout
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as LogLine),
  };
};

type Backend = ReturnType<typeof spawnBackend>;

const stopAndCollect = async (backend: Backend) => {
  const exitCode = await backend.proc.exited;
  await backend.drained;
  return exitCode;
};

const startBackend = async (): Promise<Backend> => {
  const backend = spawnBackend();
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline && backend.proc.exitCode === null) {
    if (await isListening()) return backend;
    await Bun.sleep(25);
  }
  backend.proc.kill('SIGKILL');
  await stopAndCollect(backend);
  const stderr = await new Response(backend.proc.stderr).text();
  throw new Error(`backend did not listen on ${BASE_URL}\nstdout:\n${backend.stdout()}\nstderr:\n${stderr}`);
};

describe.skipIf(portInUse)('backend entry (index.ts)', () => {
  let running: Backend | undefined;

  afterEach(async () => {
    if (running && running.proc.exitCode === null) {
      running.proc.kill('SIGKILL');
      await stopAndCollect(running);
    }
    running = undefined;
  });

  test(
    'listens on 127.0.0.1:3000 and answers /api requests with the Elysia app',
    async () => {
      running = await startBackend();

      const res = await request('/api/does-not-exist');

      expect(res.status).toBe(404);
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'announces the /api base URL in an info startup log',
    async () => {
      running = await startBackend();

      const startup = running.logs().find((line) => line.url !== undefined);

      expect(startup).toMatchObject({ level: 'info', url: `${BASE_URL}/api` });
    },
    TEST_TIMEOUT_MS,
  );

  test(
    'writes every stdout line as a JSON log entry with a level',
    async () => {
      running = await startBackend();
      running.proc.kill('SIGTERM');
      await stopAndCollect(running);

      const logs = running.logs();

      expect(logs.length).toBeGreaterThan(0);
      for (const line of logs) expect(typeof line.level).toBe('string');
    },
    TEST_TIMEOUT_MS,
  );

  test.each(['SIGTERM', 'SIGINT'] as const)(
    'shuts down cleanly with exit code 0 and logs the signal on %s',
    async (signal) => {
      running = await startBackend();

      running.proc.kill(signal);
      const exitCode = await stopAndCollect(running);

      expect(exitCode).toBe(0);
      expect(running.logs()).toContainEqual(expect.objectContaining({ signal }));
    },
    TEST_TIMEOUT_MS,
  );
});
