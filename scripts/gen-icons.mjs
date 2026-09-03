// Generates the extension's PNG icons from scratch (no image dependencies).
//
// The mark is a four-point sparkle — the symbol every platform now uses for
// "AI" — struck through by a slash, on a dark rounded square. A plain
// prohibition ring was the obvious first choice and the wrong one: it is what
// every blocker in the category already uses, so it says "blocker" without
// saying what is blocked. The sparkle says it in one glyph, and survives being
// scaled to 16px because it is one convex-cornered shape and one bar.
//
// The slash is separated from the sparkle by a gap painted back to the
// background, so at small sizes the two shapes stay readable as two shapes
// instead of merging into a blob. Run: npm run icons
//
// PNGs are written by hand: raw RGBA scanlines, zlib-deflated, wrapped in the
// three mandatory chunks (IHDR / IDAT / IEND) with CRC32 per chunk.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'icons');

const BG = [11, 11, 15];
/** The mark: one colour, so the shape does the work at every size. */
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

/**
 * A zlib stream of uncompressed ("stored") deflate blocks.
 *
 * Not `zlib.deflateSync`, deliberately. Its output is not byte-identical across
 * zlib versions — Node builds differ, and some link zlib-ng — so a compressed
 * icon changes bytes depending on who ran `npm run icons`. That breaks the
 * committed-icon check in CI, and worse, it breaks the reproducible package
 * hash in `scripts/pack.mjs`, since these files end up inside it. Stored blocks
 * are defined by the format rather than by an implementation's choices, so this
 * produces the same bytes everywhere. The icons grow to their raw size, which
 * for four small squares is worth the guarantee.
 */
function zlibStored(data) {
  const MAX_BLOCK = 0xffff;
  const parts = [Buffer.from([0x78, 0x01])]; // CMF/FLG for deflate, 32K window

  for (let offset = 0; offset < data.length || offset === 0; offset += MAX_BLOCK) {
    const slice = data.subarray(offset, offset + MAX_BLOCK);
    const final = offset + MAX_BLOCK >= data.length ? 1 : 0;
    const header = Buffer.alloc(5);
    header[0] = final; // BFINAL, BTYPE=00 (stored)
    header.writeUInt16LE(slice.length, 1);
    header.writeUInt16LE(~slice.length & 0xffff, 3);
    parts.push(header, Buffer.from(slice));
    if (final) break;
  }

  // Adler-32 of the uncompressed data, as the zlib trailer.
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(((b << 16) | a) >>> 0, 0);
  parts.push(trailer);

  return Buffer.concat(parts);
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
    chunk('IDAT', zlibStored(pixels)),
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
  const cornerRadius = size * 0.22;

  // Sparkle: an astroid, |x|^p + |y|^p <= r^p. p below 1 pulls the edges
  // inward, which is what turns a diamond into a four-point star; 0.72 is
  // pointy enough to read as a sparkle and fat enough to survive 16px.
  // Optical sizing. A 16px tile has about 12 usable pixels across, which is
  // not enough to hold a four-point star AND a strike through it — the two
  // shapes collapse into a pair of parallel bars. So the small icons drop the
  // strike and keep the sparkle's silhouette, which is the part that
  // identifies us; the large ones carry the full struck-through mark.
  const small = size <= 32;
  const sparkleRadius = size * (small ? 0.44 : 0.38);
  const sparkleExponent = small ? 0.7 : 0.76;
  // The strike is a knockout back to the background rather than a third
  // colour: two colours is all a toolbar icon needs, and cutting the sparkle
  // rather than covering it keeps the silhouette of a struck-through mark.
  const cutHalfWidth = small ? 0 : size * 0.055;

  const insideCard = (x, y) => {
    const dx = Math.max(cornerRadius - x, x - (size - cornerRadius), 0);
    const dy = Math.max(cornerRadius - y, y - (size - cornerRadius), 0);
    return dx * dx + dy * dy <= cornerRadius * cornerRadius;
  };

  const insideSparkle = (x, y) => {
    const dx = Math.abs(x - center) / sparkleRadius;
    const dy = Math.abs(y - center) / sparkleRadius;
    return dx ** sparkleExponent + dy ** sparkleExponent <= 1;
  };

  /** The anti-diagonal band through the centre, cut out of the sparkle. */
  const insideCut = (x, y) =>
    cutHalfWidth > 0 && Math.abs(x - center + (y - center)) / Math.SQRT2 <= cutHalfWidth;

  const pixels = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    pixels[offset++] = 0; // PNG filter type: none
    for (let x = 0; x < size; x++) {
      let rgb = BG;
      rgb = blend(rgb, MARK, coverage(x, y, insideSparkle));
      rgb = blend(rgb, BG, coverage(x, y, insideCut));

      pixels[offset++] = rgb[0];
      pixels[offset++] = rgb[1];
      pixels[offset++] = rgb[2];
      pixels[offset++] = Math.round(255 * coverage(x, y, insideCard));
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
