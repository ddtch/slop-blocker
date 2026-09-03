// Packages dist/ into the zip the Chrome Web Store takes, reproducibly, and
// prints its SHA-256.
//
// The point of the reproducibility is the hash. Everything this extension
// claims about itself — no server, no telemetry, metadata reads capped and sent
// without credentials — is unverifiable in a minified bundle downloaded from a
// store. Publishing a hash that anyone can reproduce from a tagged commit turns
// those claims into something a reader can check.
//
// Reproducible here means: entries sorted by path, a fixed timestamp, no OS or
// filesystem metadata, and every entry *stored* rather than deflated. That last
// one is the load-bearing choice: `zlib.deflate` is not byte-identical across
// zlib versions (Node builds differ, and some link zlib-ng), so a compressed
// archive would hash differently depending on who built it — which is exactly
// the guarantee this script exists to provide. Storing costs a few dozen KB in
// an archive the store recompresses on its own anyway. Same commit in, same
// bytes out, on any machine.
//
// Written by hand because Node has no zip writer and this is not worth a
// dependency in a project whose whole pitch is that you can read all of it.
//
// Usage: node scripts/pack.mjs

import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path, { join, relative } from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const DIST = join(ROOT, 'dist');

/**
 * MS-DOS timestamp for 1980-01-01 00:00:00, the earliest the format can hold.
 * A fixed value is the whole reason this build is reproducible.
 */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

function localHeader(entry) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28); // extra field length
  return Buffer.concat([header, entry.name]);
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attributes
  // External attributes deliberately zeroed: file modes differ per machine and
  // would break reproducibility for nothing. Chrome does not read them.
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.name]);
}

async function main() {
  let files;
  try {
    files = await walk(DIST);
  } catch {
    throw new Error('dist/ not found — run `npm run build` first');
  }
  if (files.length === 0) throw new Error('dist/ is empty');

  // Sorted by byte order of the archive path, so the layout never depends on
  // the order the filesystem happened to hand directory entries back in.
  const paths = files.map((file) => relative(DIST, file).split(path.sep).join('/')).sort();

  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const name of paths) {
    const contents = await readFile(join(DIST, name.split('/').join(path.sep)));

    const entry = {
      name: Buffer.from(name, 'utf8'),
      method: 0, // stored; see the note at the top
      compressed: contents,
      size: contents.length,
      crc: crc32(contents),
      offset,
    };
    entries.push(entry);

    const header = localHeader(entry);
    chunks.push(header, entry.compressed);
    offset += header.length + entry.compressed.length;
  }

  const central = entries.map(centralHeader);
  const centralSize = central.reduce((total, buffer) => total + buffer.length, 0);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  const zip = Buffer.concat([...chunks, ...central, end]);
  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.json'), 'utf8'));
  const out = join(ROOT, `slop-blocker-${manifest.version}.zip`);
  await writeFile(out, zip);

  const digest = createHash('sha256').update(zip).digest('hex');
  console.log(`[pack] ${relative(ROOT, out)}  ${entries.length} files  ${zip.length} bytes`);
  console.log(`[pack] sha256  ${digest}`);
}

main().catch((error) => {
  console.error(`[pack] ${error.message}`);
  process.exit(1);
});
