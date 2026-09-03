// Generates the extension's PNG icons from scratch (no image dependencies).
//
// Draws a "no entry" mark — a ring with a diagonal slash — on a dark rounded
// square, at every size the manifest asks for. Run: npm run icons
//
// PNGs are written by hand: raw RGBA scanlines, zlib-deflated, wrapped in the
// three mandatory chunks (IHDR / IDAT / IEND) with CRC32 per chunk.

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'icons');

const BG = [11, 11, 15];
const MARK = [255, 59, 48];

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage of a pixel by the shape, sampled on a 3x3 grid for cheap anti-aliasing. */
function coverage(x, y, test) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      if (test(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3)) hits++;
    }
  }
  return hits / 9;
}

function blend(base, over, alpha) {
  return base.map((channel, i) => Math.round(channel * (1 - alpha) + over[i] * alpha));
}

function render(size) {
  const center = size / 2;
  const outer = size * 0.36;
  const inner = size * 0.26;
  const slopeHalfWidth = size * 0.05;
  const cornerRadius = size * 0.22;

  const insideCard = (x, y) => {
    const dx = Math.max(cornerRadius - x, x - (size - cornerRadius), 0);
    const dy = Math.max(cornerRadius - y, y - (size - cornerRadius), 0);
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  };

  const insideRing = (x, y) => {
    const d = Math.hypot(x - center, y - center);
    return d <= outer && d >= inner;
  };

  // Diagonal bar, clipped to the ring's outer circle.
  const insideSlash = (x, y) => {
    if (Math.hypot(x - center, y - center) > outer) return false;
    const distanceToDiagonal = Math.abs(x - center + (y - center)) / Math.SQRT2;
    return distanceToDiagonal <= slopeHalfWidth;
  };

  const pixels = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    pixels[offset++] = 0; // PNG filter type: none
    for (let x = 0; x < size; x++) {
      const cardAlpha = coverage(x, y, insideCard);
      const markAlpha = Math.min(1, coverage(x, y, insideRing) + coverage(x, y, insideSlash));
      const rgb = blend(BG, MARK, markAlpha);
      pixels[offset++] = rgb[0];
      pixels[offset++] = rgb[1];
      pixels[offset++] = rgb[2];
      pixels[offset++] = Math.round(255 * cardAlpha);
    }
  }
  return png(size, pixels);
}

await mkdir(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  await writeFile(file, render(size));
  console.log(`[icons] wrote ${path.relative(process.cwd(), file)}`);
}
