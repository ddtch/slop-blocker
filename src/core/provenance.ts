// Reads AI-generation declarations out of media bytes: C2PA Content Credentials
// and IPTC/XMP `digitalSourceType`.
//
// This is a *declaration detector*, not a validator. We answer "does this file
// say it was made by AI", not "is this signature cryptographically valid" — the
// latter needs the C2PA WASM toolkit and buys us nothing for blocking decisions.
// See README ADR-2.
//
// Both markers are searched only inside container metadata (PNG ancillary
// chunks, JPEG APPn segments, WebP/ISOBMFF non-media boxes). Scanning whole
// files would let compressed pixel data produce coincidental matches.

export type ProvenanceKind = 'ai' | 'generator' | 'clean' | 'none';

export interface ProvenanceScan {
  verdict: ProvenanceKind;
  source?: 'c2pa' | 'iptc-metadata';
  /** Generator name for the reason line, e.g. "Adobe Firefly". */
  detail?: string;
  /** A provenance manifest of some kind is present. */
  hasManifest: boolean;
  /** Manifest present but the byte range we read was cut short — refetch fully. */
  truncatedWithManifest: boolean;
}

export interface MetadataRegion {
  start: number;
  end: number;
  label: string;
}

const MAX_REGION_BYTES = 256 * 1024;
const MAX_TOTAL_REGION_BYTES = 768 * 1024;
const MAX_BOXES = 512;

const decoder = new TextDecoder('latin1');

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return decoder.decode(bytes.subarray(offset, offset + length));
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
  );
}

function u32le(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset + 3]! << 24) | (bytes[offset + 2]! << 16) | (bytes[offset + 1]! << 8) | bytes[offset]!) >>> 0
  );
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, i) => bytes[i] === byte);
}

class RegionCollector {
  readonly regions: MetadataRegion[] = [];
  private total = 0;
  /** True when a box/segment claimed to extend past the bytes we hold. */
  truncated = false;

  add(start: number, declaredEnd: number, label: string, length: number): void {
    if (declaredEnd > length) {
      this.truncated = true;
      declaredEnd = length;
    }
    if (declaredEnd <= start) return;
    if (this.total >= MAX_TOTAL_REGION_BYTES) return;

    const end = Math.min(declaredEnd, start + MAX_REGION_BYTES, start + (MAX_TOTAL_REGION_BYTES - this.total));
    this.regions.push({ start, end, label });
    this.total += end - start;
  }
}

function walkPng(bytes: Uint8Array, out: RegionCollector): void {
  let offset = 8;
  let boxes = 0;
  while (offset + 8 <= bytes.length && boxes++ < MAX_BOXES) {
    const length = u32be(bytes, offset);
    const type = ascii(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    if (type === 'IEND') return;
    // Pixel data can be enormous and never carries provenance metadata.
    if (type !== 'IDAT') out.add(dataStart, dataStart + length, `png:${type}`, bytes.length);
    const next = dataStart + length + 4; // + CRC
    if (next <= offset) return;
    if (next > bytes.length) {
      out.truncated = true;
      return;
    }
    offset = next;
  }
}

function walkJpeg(bytes: Uint8Array, out: RegionCollector): void {
  let offset = 2;
  let boxes = 0;
  while (offset + 4 <= bytes.length && boxes++ < MAX_BOXES) {
    if (bytes[offset] !== 0xff) return;
    const marker = bytes[offset + 1]!;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return; // start of scan / end of image
    const segmentLength = u16be(bytes, offset + 2);
    if (segmentLength < 2) return;
    const dataStart = offset + 4;
    // APPn segments carry Exif, XMP and C2PA (APP11/JUMBF); COM is a comment.
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      out.add(dataStart, dataStart + segmentLength - 2, `jpeg:app${marker - 0xe0}`, bytes.length);
    }
    const next = dataStart + segmentLength - 2;
    if (next <= offset) return;
    if (next > bytes.length) {
      out.truncated = true;
      return;
    }
    offset = next;
  }
}

function walkWebp(bytes: Uint8Array, out: RegionCollector): void {
  let offset = 12;
  let boxes = 0;
  const mediaChunks = new Set(['VP8 ', 'VP8L', 'VP8X', 'ANMF', 'ALPH']);
  while (offset + 8 <= bytes.length && boxes++ < MAX_BOXES) {
    const type = ascii(bytes, offset, 4);
    const size = u32le(bytes, offset + 4);
    const dataStart = offset + 8;
    if (!mediaChunks.has(type)) out.add(dataStart, dataStart + size, `webp:${type}`, bytes.length);
    const next = dataStart + size + (size & 1); // chunks are padded to even sizes
    if (next <= offset) return;
    if (next > bytes.length) {
      out.truncated = true;
      return;
    }
    offset = next;
  }
}

function walkIsobmff(bytes: Uint8Array, out: RegionCollector): void {
  let offset = 0;
  let boxes = 0;
  while (offset + 8 <= bytes.length && boxes++ < MAX_BOXES) {
    let size = u32be(bytes, offset);
    let headerSize = 8;
    const type = ascii(bytes, offset + 4, 4);
    if (size === 1) {
      // 64-bit size; ignore the high word (we never handle >4 GiB prefixes).
      if (offset + 16 > bytes.length) {
        out.truncated = true;
        return;
      }
      size = u32be(bytes, offset + 12);
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - offset; // box extends to end of file
    }
    if (size < headerSize) return;
    const dataStart = offset + headerSize;
    // 'mdat' is the media payload; C2PA lives in a top-level 'uuid' box.
    if (type !== 'mdat') out.add(dataStart, offset + size, `mp4:${type}`, bytes.length);
    const next = offset + size;
    if (next <= offset) return;
    if (next > bytes.length) {
      out.truncated = true;
      return;
    }
    offset = next;
  }
}

/** Last resort for unknown containers: locate XMP packets by their delimiters. */
function walkGeneric(bytes: Uint8Array, out: RegionCollector): void {
  const haystack = decoder.decode(bytes.subarray(0, Math.min(bytes.length, MAX_TOTAL_REGION_BYTES)));
  for (const needle of ['<?xpacket', '<x:xmpmeta']) {
    let from = 0;
    for (let found = 0; found < 4; found++) {
      const index = haystack.indexOf(needle, from);
      if (index < 0) break;
      out.add(index, Math.min(index + 64 * 1024, bytes.length), 'generic:xmp', bytes.length);
      from = index + needle.length;
    }
  }
}

export function extractMetadataRegions(bytes: Uint8Array): {
  regions: MetadataRegion[];
  truncated: boolean;
} {
  const out = new RegionCollector();
  try {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      walkPng(bytes, out);
    } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
      walkJpeg(bytes, out);
    } else if (bytes.length > 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
      walkWebp(bytes, out);
    } else if (bytes.length > 8 && ascii(bytes, 4, 4) === 'ftyp') {
      walkIsobmff(bytes, out);
    } else {
      walkGeneric(bytes, out);
    }
  } catch {
    // Malformed container: fall back to whatever regions we collected.
  }
  return { regions: out.regions, truncated: out.truncated };
}

// The IPTC digital source type for generative AI. `compositeWith...` contains
// this substring, so one search covers both vocabulary terms.
const AI_MARKER = 'trainedalgorithmicmedia';
const COMPOSITE_MARKER = 'compositewithtrainedalgorithmicmedia';

const C2PA_MARKERS = [
  'c2pa.claim',
  'c2pa.assertions',
  'c2pa.actions',
  'claim_generator',
  'c2pa.hash',
  'urn:c2pa',
  'jumbf',
];

const XMP_MARKERS = ['<x:xmpmeta', '<?xpacket', 'ns.adobe.com/xap/1.0/', 'digitalsourcetype'];

/**
 * Keys whose *values* name the producing tool. Generator names are matched only
 * in a window after one of these, so base64 blobs inside XMP thumbnails cannot
 * fake a match with a short needle like "veo".
 */
const TOOL_KEYS = [
  'claim_generator',
  'claim_generator_info',
  'creatortool',
  'softwareagent',
  'tiff:software',
  'software',
  'digitalsourcetype',
  'generator',
  'parameters',
];

const TOOL_WINDOW = 300;

const GENERATORS: Array<[needle: string, label: string]> = [
  ['adobe firefly', 'Adobe Firefly'],
  ['firefly', 'Adobe Firefly'],
  ['dall-e', 'DALL·E'],
  ['dall·e', 'DALL·E'],
  ['dalle', 'DALL·E'],
  ['gpt-image', 'OpenAI'],
  ['openai', 'OpenAI'],
  ['sora', 'Sora'],
  ['midjourney', 'Midjourney'],
  ['stable diffusion', 'Stable Diffusion'],
  ['stable-diffusion', 'Stable Diffusion'],
  ['stablediffusion', 'Stable Diffusion'],
  ['automatic1111', 'Stable Diffusion WebUI'],
  ['comfyui', 'ComfyUI'],
  ['invokeai', 'InvokeAI'],
  ['novelai', 'NovelAI'],
  ['made with google ai', 'Google AI'],
  ['imagen', 'Google Imagen'],
  ['google veo', 'Google Veo'],
  ['gemini', 'Google Gemini'],
  ['nano banana', 'Google Gemini'],
  ['grok', 'Grok'],
  ['flux.1', 'FLUX.1'],
  ['black forest labs', 'FLUX'],
  ['runway', 'Runway'],
  ['kling', 'Kling'],
  ['luma ai', 'Luma'],
  ['ideogram', 'Ideogram'],
  ['leonardo.ai', 'Leonardo.Ai'],
  ['recraft', 'Recraft'],
];

function toolContext(lower: string): string {
  const windows: string[] = [];
  for (const key of TOOL_KEYS) {
    let from = 0;
    for (let found = 0; found < 8; found++) {
      const index = lower.indexOf(key, from);
      if (index < 0) break;
      windows.push(lower.slice(index, index + TOOL_WINDOW));
      from = index + key.length;
    }
  }
  return windows.join('\n');
}

function findGenerator(lower: string): string | undefined {
  const context = toolContext(lower);
  if (!context) return undefined;
  for (const [needle, label] of GENERATORS) {
    if (context.includes(needle)) return label;
  }
  return undefined;
}

/**
 * @param truncated whether `bytes` is a prefix of the real file (a Range read).
 */
export function scanProvenance(bytes: Uint8Array, options: { truncated?: boolean } = {}): ProvenanceScan {
  if (bytes.length === 0) {
    return { verdict: 'none', hasManifest: false, truncatedWithManifest: false };
  }

  const { regions, truncated: boxTruncated } = extractMetadataRegions(bytes);
  const text = regions.map((region) => decoder.decode(bytes.subarray(region.start, region.end))).join('\n');
  const lower = text.toLowerCase();

  const hasC2pa = C2PA_MARKERS.some((marker) => lower.includes(marker));
  const hasXmp = XMP_MARKERS.some((marker) => lower.includes(marker));
  const hasManifest = hasC2pa || hasXmp;
  const wasTruncated = Boolean(options.truncated) || boxTruncated;

  if (lower.includes(AI_MARKER)) {
    const generator = findGenerator(lower);
    const composite = lower.includes(COMPOSITE_MARKER);
    const detail = [generator, composite ? 'composite' : undefined].filter(Boolean).join(', ');
    return {
      verdict: 'ai',
      source: hasC2pa ? 'c2pa' : 'iptc-metadata',
      detail: detail || undefined,
      hasManifest: true,
      truncatedWithManifest: false,
    };
  }

  const generator = findGenerator(lower);
  if (generator) {
    return {
      verdict: 'generator',
      source: hasC2pa ? 'c2pa' : 'iptc-metadata',
      detail: generator,
      hasManifest,
      truncatedWithManifest: wasTruncated && hasManifest,
    };
  }

  return {
    verdict: hasManifest ? 'clean' : 'none',
    hasManifest,
    // Only worth a second, full fetch if we know there is a manifest to finish reading.
    truncatedWithManifest: wasTruncated && hasManifest,
  };
}
