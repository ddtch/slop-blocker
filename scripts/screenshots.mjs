// Captures the store screenshots from the real extension in a real browser.
//
// Everything here is the actual UI: the shroud over the fixture page, the popup
// and the options page, rendered by the built `dist/`. Nothing is mocked up.
// The only cosmetic liberty is centring the popup on a backdrop, because the
// Chrome Web Store demands exactly 1280x800 and the popup is 360px wide.
//
// Shares the Chrome-launching approach with scripts/smoke.mjs; see the comment
// there for why extensions are loaded the way they are.
//
// Usage: node scripts/screenshots.mjs [--keep-open]

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { extname, join } from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const FIXTURE_DIR = join(ROOT, 'test', 'fixtures');
const DIST = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'docs', 'screenshots');

/** The Chrome Web Store accepts 1280x800 or 640x400, and nothing else. */
const WIDTH = 1280;
const HEIGHT = 800;
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

/** Centres a narrow extension page on a backdrop so it fills a 1280x800 frame. */
const CENTRE_ON_BACKDROP = `(() => {
  document.documentElement.style.cssText =
    'height:100%;display:flex;align-items:center;justify-content:center;' +
    // Without this, the body's own overflow propagates to the viewport (CSS
    // overflow propagation), the body stops being a scroll container, and the
    // sticky footer falls out of the card.
    'overflow:hidden;' +
    'background:radial-gradient(circle at 50% 0%, #23232b 0%, #0b0b0f 70%);';
  document.body.style.margin = '0';
  document.body.style.borderRadius = '14px';
  document.body.style.boxShadow = '0 24px 70px rgba(0,0,0,.65), 0 0 0 1px rgba(255,255,255,.07)';
  return true;
})()`;

function unpackedExtensionId(directory) {
  const hex = createHash('sha256').update(directory).digest('hex').slice(0, 32);
  let id = '';
  for (const digit of hex) id += String.fromCharCode(97 + parseInt(digit, 16));
  return id;
}

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

function startServer() {
  const server = createServer(async (request, response) => {
    const relative =
      decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') ||
      'demo.html';
    const file = join(FIXTURE_DIR, relative);
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
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`DevTools endpoint never became ready: ${url}`);
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

/** Waits for a target matching `predicate` and connects to it. */
async function attach(debugPort, predicate, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const targets = await getJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find(predicate);
    if (target) return { cdp: await Cdp.connect(target.webSocketDebuggerUrl), target };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('target never appeared');
}

async function capture(cdp, file, { prepare } = {}) {
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: 1,
    mobile: false,
  });
  if (prepare) await cdp.evaluate(prepare);
  // Let layout settle after the metrics override before the pixels are read.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = join(OUT_DIR, file);
  await writeFile(out, Buffer.from(data, 'base64'));
  console.log(`[shots] ${path.relative(ROOT, out)}`);
}

async function main() {
  const keepOpen = process.argv.includes('--keep-open');
  const chrome = await findChrome();
  const { server, port } = await startServer();
  const profile = await mkdtemp(join(tmpdir(), 'slop-shots-'));
  const pageUrl = `http://127.0.0.1:${port}/demo.html`;
  await mkdir(OUT_DIR, { recursive: true });

  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--window-size=${WIDTH},${HEIGHT}`,
      '--enable-unsafe-extension-debugging',
      `--load-extension=${DIST}`,
      `--disable-extensions-except=${DIST}`,
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

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

    let extensionId;
    try {
      ({ id: extensionId } = await browser.send('Extensions.loadUnpacked', { path: DIST }));
    } catch (error) {
      if (!/not available|wasn't found/i.test(error.message)) throw error;
      extensionId = unpackedExtensionId(DIST);
    }
    console.log(`[shots] extension ${extensionId}`);

    // 1. The fixture page, with the shrouds in place.
    await browser.send('Target.createTarget', { url: pageUrl });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    const page = await attach(
      debugPort,
      (target) => target.type === 'page' && target.url.includes('demo.html'),
    );
    await capture(page.cdp, '01-blocked-page.png');

    // The popup renders one tab's detections, so it needs that tab's id — which
    // only the extension can see. Ask its service worker.
    const worker = await attach(
      debugPort,
      (target) => target.type === 'service_worker' && target.url.includes(extensionId),
    );
    await worker.cdp.send('Runtime.enable');
    const tabId = await worker.cdp.evaluate(
      `chrome.tabs.query({ url: '${pageUrl}' }).then((tabs) => tabs[0]?.id ?? 0)`,
    );
    if (!tabId) throw new Error('could not resolve the fixture tab id');

    // 2. The popup, showing what was found on that tab.
    await browser.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/popup.html?tabId=${tabId}`,
    });
    const popup = await attach(
      debugPort,
      (target) => target.type === 'page' && target.url.includes('popup.html'),
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await capture(popup.cdp, '02-popup.png', { prepare: CENTRE_ON_BACKDROP });

    // 3. The options page.
    await browser.send('Target.createTarget', {
      url: `chrome-extension://${extensionId}/options.html`,
    });
    const options = await attach(
      debugPort,
      (target) => target.type === 'page' && target.url.includes('options.html'),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await capture(options.cdp, '03-options.png');

    console.log('\n[shots] done');
  } catch (error) {
    exitCode = 1;
    console.error(`\n[shots] FAIL: ${error.message}`);
  } finally {
    if (!keepOpen) {
      child.kill('SIGTERM');
      server.close();
    } else {
      console.log(`[shots] left running; devtools on http://127.0.0.1:${debugPort}`);
    }
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(`[shots] crashed: ${error.stack}`);
  process.exit(1);
});
