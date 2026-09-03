// Loads the built extension into a real (headless) Chrome and checks that it
// actually blocks things on the local fixture page.
//
// Two things this had to work around:
//
//   * `--dump-dom` snapshots the page before detection can finish — scans are
//     debounced and provenance reads are async — so it always saw zero
//     overlays. We drive Chrome over the DevTools Protocol and wait instead.
//   * `--load-extension` no longer loads anything on stable Chrome (disabled in
//     M137; this silently produced a browser with no extension in it). The
//     supported path is `--enable-unsafe-extension-debugging` plus the CDP
//     `Extensions.loadUnpacked` command.
//
// Uses only Node built-ins (Node 22+ ships a WebSocket client).
//
// Usage: node scripts/smoke.mjs [--keep-open]

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { extname, join } from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE_DIR = join(ROOT, 'test', 'fixtures');
const DIST = join(ROOT, 'dist');
const SETTLE_MS = 7000;

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
};

/**
 * What the fixture page is built to produce. Five items must be covered — the
 * two AI-declared images, the generator-only image, and the two keyword
 * disclosures — and the deliberately ambiguous one must get a chip instead.
 */
const EXPECTED = { block: 5, chip: 1 };

async function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not present or not executable; try the next one.
    }
  }
  throw new Error(`no Chrome binary found; looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

/** Serves test/fixtures, so the extension sees a normal http origin. */
function startServer() {
  const server = createServer(async (request, response) => {
    const relative =
      decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') ||
      'provenance.html';
    const file = join(FIXTURE_DIR, relative);
    // Path traversal guard: everything must resolve inside the fixture directory.
    if (!file.startsWith(FIXTURE_DIR)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function getJson(url, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
    } catch {
      // Chrome's debugging endpoint is not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`DevTools endpoint never became ready: ${url}`);
}

/** Minimal CDP client over the native WebSocket. */
class Cdp {
  #socket;
  #nextId = 0;
  #pending = new Map();

  static async connect(wsUrl) {
    const client = new Cdp();
    client.#socket = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      client.#socket.addEventListener('open', resolve, { once: true });
      client.#socket.addEventListener('error', () => reject(new Error(`CDP connect failed: ${wsUrl}`)), {
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

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? 'evaluation failed');
    }
    return response.result.value;
  }

  close() {
    this.#socket.close();
  }
}

/**
 * Runs inside the page. Overlay hosts live in the page's DOM (their contents
 * are in a closed shadow root), so counting them from the main world works even
 * though the content script itself runs in an isolated world.
 */
const PROBE = `JSON.stringify((() => {
  const hosts = [...document.querySelectorAll('[data-slop-blocker]')];
  const byMode = {};
  for (const host of hosts) {
    const mode = host.getAttribute('data-slop-blocker');
    byMode[mode] = (byMode[mode] ?? 0) + 1;
  }
  const blurred = [...document.querySelectorAll('img, video')]
    .filter((element) => (element.style.filter || '').includes('blur'))
    .map((element) => (element.currentSrc || element.src || '').split('/').pop());
  return { byMode, blurred };
})())`;

async function main() {
  const keepOpen = process.argv.includes('--keep-open');
  const chrome = await findChrome();
  const { server, port } = await startServer();
  const profile = await mkdtemp(join(tmpdir(), 'slop-smoke-'));
  const pageUrl = `http://127.0.0.1:${port}/provenance.html`;

  console.log(`[smoke] chrome:  ${chrome}`);
  console.log(`[smoke] fixture: ${pageUrl}`);

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      // Required for Extensions.loadUnpacked below.
      '--enable-unsafe-extension-debugging',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let chromeStderr = '';
  child.stderr.on('data', (chunk) => {
    chromeStderr += chunk.toString();
  });

  // With port 0 Chrome picks a port and writes it into the profile directory.
  const portFile = join(profile, 'DevToolsActivePort');
  let debugPort = null;
  for (let attempt = 0; attempt < 60 && debugPort === null; attempt++) {
    try {
      debugPort = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!debugPort) throw new Error('Chrome never reported a debugging port');

  let exitCode = 0;
  try {
    const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
    const browser = await Cdp.connect(version.webSocketDebuggerUrl);

    const { id } = await browser.send('Extensions.loadUnpacked', { path: DIST });
    console.log(`[smoke] loaded extension ${id}`);

    await browser.send('Target.createTarget', { url: pageUrl });
    // Detection is debounced and provenance reads are network-bound; wait it out.
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const workerRunning = targets.some(
      (target) => target.type === 'service_worker' && target.url.includes(id),
    );
    const page = targets.find(
      (target) => target.type === 'page' && target.url.includes('provenance'),
    );
    if (!page) throw new Error('fixture page target not found');

    const cdp = await Cdp.connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const result = JSON.parse(await cdp.evaluate(PROBE));

    console.log(`[smoke] service worker running: ${workerRunning}`);
    console.log(`[smoke] overlays: ${JSON.stringify(result.byMode)}`);
    console.log(`[smoke] blurred:  ${result.blurred.join(', ') || '(none)'}`);

    const problems = [];
    if (!workerRunning) problems.push('the extension service worker is not running');
    for (const [mode, expected] of Object.entries(EXPECTED)) {
      const actual = result.byMode[mode] ?? 0;
      if (actual !== expected) problems.push(`expected ${expected} "${mode}" overlays, saw ${actual}`);
    }
    if (problems.length) throw new Error(problems.join('; '));

    console.log('\n[smoke] PASS');
    if (!keepOpen) {
      cdp.close();
      browser.close();
    }
  } catch (error) {
    exitCode = 1;
    console.error(`\n[smoke] FAIL: ${error.message}`);
    const relevant = chromeStderr
      .split('\n')
      .filter((line) => /extension|manifest|service worker/i.test(line))
      .slice(0, 15);
    if (relevant.length) console.error(`[smoke] chrome said:\n${relevant.join('\n')}`);
  } finally {
    if (!keepOpen) {
      child.kill('SIGTERM');
      server.close();
    } else {
      console.log(`[smoke] left running; devtools on http://127.0.0.1:${debugPort}`);
    }
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[smoke] crashed: ${error.stack}`);
  process.exit(1);
});
