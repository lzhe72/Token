import path from 'node:path';
import fs from 'node:fs';
import { LocalServer } from './server';

const directory = path.resolve(process.env.TOKEN_SERVER_DATA_DIR || path.join(process.cwd(), '.token-server'));
const port = Number(process.env.TOKEN_SERVER_PORT || '47839');
const host = process.env.TOKEN_SERVER_HOST || '127.0.0.1';
if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error('服务端口无效');
const tls = process.env.TOKEN_SERVER_TLS_CERT && process.env.TOKEN_SERVER_TLS_KEY
  ? { cert: fs.readFileSync(process.env.TOKEN_SERVER_TLS_CERT), key: fs.readFileSync(process.env.TOKEN_SERVER_TLS_KEY) }
  : undefined;
const server = new LocalServer(directory, tls);
server.start(port, host).then(actualPort => {
  process.stdout.write(`Token server listening on ${host}:${actualPort}\n`);
}).catch(error => {
  process.stderr.write(`Token server failed: ${String(error)}\n`);
  process.exitCode = 1;
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => { void server.stop().finally(() => process.exit(0)); });
}

const parent = Number(process.env.TOKEN_SERVER_PARENT_PID);
if (Number.isSafeInteger(parent) && parent > 1) {
  setInterval(() => {
    try { process.kill(parent, 0); }
    catch { void server.stop().finally(() => process.exit(0)); }
  }, 1000).unref();
}
