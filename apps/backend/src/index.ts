import { createApp } from './app.ts';

// Port development sesuai spec 0001: backend 127.0.0.1:3000.
const HOSTNAME = '127.0.0.1';
const PORT = 3000;

const app = createApp().listen({ hostname: HOSTNAME, port: PORT });

console.log(
  JSON.stringify({
    level: 'info',
    msg: 'backend listening',
    url: `http://${HOSTNAME}:${PORT}/api`,
  }),
);

const shutdown = async (signal: NodeJS.Signals) => {
  console.log(JSON.stringify({ level: 'info', msg: 'backend shutting down', signal }));
  await app.stop();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
