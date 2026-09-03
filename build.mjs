// Build script for the Slop Blocker MV3 extension.
//
// Bundles TypeScript entry points with esbuild and copies static assets into dist/.
// Content scripts are emitted as IIFE (MV3 does not support module content scripts);
// the service worker, popup and options pages are emitted as ESM.
//
// Usage: node build.mjs [--watch] [--dev]

import { build, context } from 'esbuild';
import { cp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const outdir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/** Entry points -> output paths (relative to dist/), with the format each needs. */
const ENTRIES = [
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/content/index.ts', out: 'content', format: 'iife' },
  { in: 'src/adapters/youtube/main-world.ts', out: 'main-world-youtube', format: 'iife' },
  { in: 'src/popup/popup.ts', out: 'popup', format: 'esm' },
  { in: 'src/options/options.ts', out: 'options', format: 'esm' },
];

/** Static files copied verbatim: [source, destination-in-dist]. */
const STATIC = [
  ['src/manifest.json', 'manifest.json'],
  ['src/popup/popup.html', 'popup.html'],
  ['src/popup/popup.css', 'popup.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
  ['_locales', '_locales'],
  ['lists', 'lists'],
  ['icons', 'icons'],
];

const shared = {
  bundle: true,
  target: ['chrome120'],
  platform: 'browser',
  logLevel: 'info',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  define: { __DEV__: JSON.stringify(dev) },
  alias: { '@': path.join(root, 'src') },
};

async function copyStatic() {
  for (const [from, to] of STATIC) {
    const src = path.join(root, from);
    if (!existsSync(src)) {
      console.warn(`[build] skipping missing static asset: ${from}`);
      continue;
    }
    await cp(src, path.join(outdir, to), { recursive: true });
  }
}

/** Fail loudly if the manifest references a file the build did not produce. */
async function verifyManifest() {
  const manifest = JSON.parse(await readFile(path.join(outdir, 'manifest.json'), 'utf8'));
  const referenced = new Set();
  const collect = (value) => {
    if (typeof value === 'string') {
      if (/\.(js|css|html|png|json)$/.test(value)) referenced.add(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(collect);
    }
  };
  collect(manifest);

  const missing = [];
  for (const file of referenced) {
    if (file.includes('*')) continue;
    if (!existsSync(path.join(outdir, file))) missing.push(file);
  }
  if (missing.length) {
    throw new Error(`manifest.json references files missing from dist/: ${missing.join(', ')}`);
  }
  console.log(`[build] manifest verified (${referenced.size} referenced files)`);
}

async function run() {
  await rm(outdir, { recursive: true, force: true });
  await mkdir(outdir, { recursive: true });

  const builds = ENTRIES.map((entry) => ({
    ...shared,
    entryPoints: [path.join(root, entry.in)],
    outfile: path.join(outdir, `${entry.out}.js`),
    format: entry.format,
  }));

  if (watch) {
    await copyStatic();
    const contexts = await Promise.all(builds.map((options) => context(options)));
    await Promise.all(contexts.map((ctx) => ctx.watch()));
    console.log('[build] watching for changes; static assets are copied once at startup');
    return;
  }

  await Promise.all(builds.map((options) => build(options)));
  await copyStatic();
  await verifyManifest();

  const files = await readdir(outdir);
  console.log(`[build] done -> dist/ (${files.length} top-level entries)`);
}

run().catch((error) => {
  console.error('[build] failed:', error.message);
  process.exit(1);
});
