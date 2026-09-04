// Screenshots docs/index.html at a few widths, so the landing page gets looked
// at the same way everything else here does: in a real browser, not imagined.
//
// Usage: node scripts/landing-shot.mjs [outDir]

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { extname, join } from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DOCS = join(ROOT, 'docs');
const OUT = process.argv[2] ?? join(tmpdir(), 'slop-landing');

const SHOTS = [
  { file: 'landing-desktop.png', width: 1280, height: 900, full: true },
  { file: 'landing-mobile.png', width: 390, height: 844, full: true },
];

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.png': 'image/png',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
};

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* next */
    }
  }
  throw new Error('no Chrome binary found');
}

function startServer() {
  const server = createServer(async (request, response) => {
    const rel =
      decodeURIComponent(new URL(request.url, 'http://x').pathname).replace(/^\/+/, '') ||
      'index.html';
    const file = join(DOCS, rel);
    if (!file.startsWith(DOCS)) return void response.writeHead(403).end();
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })),
  );
}

async function getJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`DevTools never became ready: ${url}`);
}

class Cdp {
  #socket;
  #nextId = 0;
  #pending = new Map();

  static async connect(wsUrl) {
    const client = new Cdp();
    client.#socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      client.#socket.addEventListener('open', resolve, { once: true });
      client.#socket.addEventListener('error', () => reject(new Error('CDP connect failed')), {
        once: true,
      });
    });
    client.#socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      const waiter = message.id && client.#pending.get(message.id);
      if (!waiter) return;
      client.#pending.delete(message.id);
      waiter(message);
    });
    return client;
  }

  async send(method, params = {}) {
    const id = ++this.#nextId;
    const message = await new Promise((resolve) => {
      this.#pending.set(id, resolve);
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
    if (message.error) throw new Error(`${method}: ${message.error.message}`);
    return message.result;
  }

  close() {
    this.#socket.close();
  }
}

async function main() {
  const chrome = await findChrome();
  const { server, port } = await startServer();
  const profile = await mkdtemp(join(tmpdir(), 'slop-landing-'));
  await mkdir(OUT, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const portFile = join(profile, 'DevToolsActivePort');
  let debugPort = null;
  for (let i = 0; i < 60 && debugPort === null; i++) {
    try {
      debugPort = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!debugPort) throw new Error('Chrome never reported a debugging port');

  let exitCode = 0;
  try {
    const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
    const browser = await Cdp.connect(version.webSocketDebuggerUrl);
    await browser.send('Target.createTarget', { url: `http://127.0.0.1:${port}/index.html` });

    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
    if (!page) throw new Error('page target not found');
    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');

    for (const shot of SHOTS) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: 1,
        mobile: shot.width < 600,
      });
      await new Promise((r) => setTimeout(r, 900));
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: shot.full,
      });
      const out = join(OUT, shot.file);
      await writeFile(out, Buffer.from(data, 'base64'));
      console.log(`[landing] ${out}`);
    }

    // Anything the page failed to load shows up as a console error.
    const broken = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify([...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src))`,
      returnByValue: true,
    });
    console.log(`[landing] broken images: ${broken.result.value}`);
  } catch (error) {
    exitCode = 1;
    console.error(`[landing] FAIL: ${error.message}`);
  } finally {
    child.kill('SIGTERM');
    server.close();
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[landing] crashed: ${error.stack}`);
  process.exit(1);
});
