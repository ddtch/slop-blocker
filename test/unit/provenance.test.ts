import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { extractMetadataRegions, scanProvenance } from '../../src/core/provenance';
import { readRepoBytes } from '../helpers/paths';

function fixture(name: string): Uint8Array {
  return readRepoBytes(`test/fixtures/media/${name}`);
}

describe('scanProvenance on generated fixtures', () => {
  it('reads an IPTC digitalSourceType of trainedAlgorithmicMedia', () => {
    const scan = scanProvenance(fixture('ai-xmp.png'));
    expect(scan.verdict).toBe('ai');
    expect(scan.source).toBe('iptc-metadata');
    expect(scan.detail).toContain('Firefly');
  });

  it('reads a C2PA manifest declaring an AI creation action', () => {
    const scan = scanProvenance(fixture('ai-c2pa.png'));
    expect(scan.verdict).toBe('ai');
    expect(scan.source).toBe('c2pa');
    expect(scan.hasManifest).toBe(true);
  });

  it('reports a known AI tool without an AI action as "generator", not proof', () => {
    const scan = scanProvenance(fixture('generator-c2pa.png'));
    expect(scan.verdict).toBe('generator');
    expect(scan.detail).toBe('Adobe Firefly');
  });

  it('calls camera-captured provenance clean', () => {
    const scan = scanProvenance(fixture('provenance-clean.png'));
    expect(scan.verdict).toBe('clean');
    expect(scan.hasManifest).toBe(true);
  });

  it('reports no manifest when there is none', () => {
    const scan = scanProvenance(fixture('no-metadata.png'));
    expect(scan.verdict).toBe('none');
    expect(scan.hasManifest).toBe(false);
  });

  it('handles empty input', () => {
    expect(scanProvenance(new Uint8Array()).verdict).toBe('none');
  });
});

describe('metadata region extraction', () => {
  it('never includes PNG pixel data', () => {
    const bytes = fixture('ai-xmp.png');
    const { regions } = extractMetadataRegions(bytes);
    expect(regions.length).toBeGreaterThan(0);
    expect(regions.some((region) => region.label === 'png:IDAT')).toBe(false);
    expect(regions.some((region) => region.label === 'png:iTXt')).toBe(true);
  });

  it('ignores markers that only appear in pixel data', () => {
    // The literal marker string, deflated into IDAT rather than a text chunk.
    const marker = 'trainedAlgorithmicMedia';
    const payload = Buffer.concat([Buffer.from([0]), Buffer.from(marker.repeat(40), 'latin1')]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;

    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(payload)),
      chunk('IEND', Buffer.alloc(0)),
    ]);

    expect(scanProvenance(new Uint8Array(png)).verdict).toBe('none');
  });
});

describe('JPEG containers', () => {
  it('reads C2PA out of an APP11 segment', () => {
    const payload = Buffer.from(
      'jumb c2pa jumd c2pa.claim claim_generator Midjourney 7 c2pa.actions ' +
        'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
      'latin1',
    );
    const jpeg = jpegWithApp(0xeb, payload);

    const scan = scanProvenance(new Uint8Array(jpeg));
    expect(scan.verdict).toBe('ai');
    expect(scan.source).toBe('c2pa');
    expect(scan.detail).toContain('Midjourney');
  });

  it('stops at the start of scan data', () => {
    const jpeg = jpegWithApp(0xe1, Buffer.from('<x:xmpmeta>nothing here</x:xmpmeta>', 'latin1'));
    const { regions } = extractMetadataRegions(new Uint8Array(jpeg));
    expect(regions).toHaveLength(1);
    expect(regions[0]?.label).toBe('jpeg:app1');
  });
});

describe('truncated reads', () => {
  it('asks for a full fetch when a manifest is present but cut short', () => {
    const bytes = fixture('provenance-clean.png');
    const scan = scanProvenance(bytes, { truncated: true });
    expect(scan.truncatedWithManifest).toBe(true);
  });

  it('does not ask for a full fetch when there is no manifest', () => {
    const scan = scanProvenance(fixture('no-metadata.png'), { truncated: true });
    expect(scan.truncatedWithManifest).toBe(false);
  });
});

// --- helpers ---------------------------------------------------------------

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/** Minimal JPEG: SOI, one APPn segment, SOS, then bytes we must not scan. */
function jpegWithApp(marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, marker]),
    length,
    payload,
    Buffer.from([0xff, 0xda]),
    Buffer.from('trainedAlgorithmicMedia-must-be-ignored-after-sos', 'latin1'),
    Buffer.from([0xff, 0xd9]),
  ]);
}
