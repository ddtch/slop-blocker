// Fetches media bytes and asks the pure scanner whether they declare AI generation.
//
// Runs in the service worker for two reasons: host permissions let it read
// cross-origin bytes that a content script could not, and the byte budget below
// is easier to enforce in one place. See SPEC.md §2.1 for the budget rules.

import type { ProvenanceVerdict } from '../proto';
import { scanProvenance } from '../core/provenance';

/** First probe: C2PA/XMP metadata sits near the start of every container we support. */
const PROBE_BYTES = 256 * 1024;
/** Second pass, only when the probe found a manifest it could not finish reading. */
const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_CONCURRENT = 3;
const CACHE_LIMIT = 2000;
const ERROR_TTL_MS = 5 * 60 * 1000;
const CACHE_KEY = 'provenanceCache';

interface CacheEntry extends ProvenanceVerdict {
  at: number;
}

let cache: Map<string, CacheEntry> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const inFlight = new Map<string, Promise<ProvenanceVerdict>>();
let active = 0;
const waiting: Array<() => void> = [];

async function getCache(): Promise<Map<string, CacheEntry>> {
  if (cache) return cache;
  try {
    const stored = await chrome.storage.session.get(CACHE_KEY);
    const entries = (stored[CACHE_KEY] ?? []) as Array<[string, CacheEntry]>;
    cache = new Map(Array.isArray(entries) ? entries : []);
  } catch {
    cache = new Map();
  }
  return cache;
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistCache();
  }, 2000);
}

async function persistCache(): Promise<void> {
  if (!cache) return;
  // Map iteration is insertion-ordered, so dropping from the front is LRU-ish.
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    cache.delete(oldest.value);
  }
  try {
    await chrome.storage.session.set({ [CACHE_KEY]: [...cache.entries()] });
  } catch {
    // Session quota exceeded; the in-memory cache still works for this worker.
  }
}

function isFetchable(url: string): boolean {
  return /^(https?:|data:)/i.test(url);
}

/** Runs `task` once a concurrency slot frees up. */
async function withSlot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await task();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

interface ReadResult {
  bytes: Uint8Array;
  /** True when we stopped reading before the end of the body. */
  truncated: boolean;
}

/** Reads at most `cap` bytes, then cancels the stream so we never buffer a whole video. */
async function readCapped(response: Response, cap: number): Promise<ReadResult> {
  const body = response.body;
  if (!body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { bytes: buffer.subarray(0, cap), truncated: buffer.length > cap };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.length;
      if (total >= cap) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = new Uint8Array(Math.min(total, cap));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= bytes.length) break;
    const slice = chunk.subarray(0, bytes.length - offset);
    bytes.set(slice, offset);
    offset += slice.length;
  }
  return { bytes, truncated };
}

/**
 * Whether a 206 response left part of the file unread.
 *
 * A file smaller than the requested range still comes back as 206, with
 * `Content-Range: bytes 0-4711/4712`. Treating that as truncated would send us
 * back for a second, full read of a file we already hold in full — which is the
 * common case for AI images, since they are usually well under the probe size.
 */
function rangeLeftBytesUnread(response: Response): boolean {
  const header = response.headers.get('Content-Range');
  if (!header) return true; // no way to tell; assume there is more
  const match = /bytes\s+(\d+)-(\d+)\/(\d+|\*)/i.exec(header);
  if (!match) return true;
  const end = Number(match[2]);
  const total = match[3] === '*' ? Number.NaN : Number(match[3]);
  if (!Number.isFinite(total)) return true;
  return end + 1 < total;
}

async function fetchRange(url: string, cap: number, useRangeHeader: boolean): Promise<ReadResult | null> {
  const init: RequestInit = {
    credentials: 'omit',
    redirect: 'follow',
    // Prefer the copy the page already downloaded.
    cache: 'force-cache',
  };
  if (useRangeHeader) init.headers = { Range: `bytes=0-${cap - 1}` };

  const response = await fetch(url, init);
  if (!response.ok) return null;

  const result = await readCapped(response, cap);
  if (response.status === 206 && rangeLeftBytesUnread(response)) result.truncated = true;
  return result;
}

async function scanUrl(url: string): Promise<ProvenanceVerdict> {
  if (!isFetchable(url)) return { verdict: 'none' };

  try {
    const probe = await fetchRange(url, PROBE_BYTES, true);
    if (!probe) return { verdict: 'error' };

    let scan = scanProvenance(probe.bytes, { truncated: probe.truncated });

    // The manifest was there but ran past our probe window: read the whole file once.
    if (scan.truncatedWithManifest) {
      const full = await fetchRange(url, MAX_FULL_BYTES, false);
      if (full) scan = scanProvenance(full.bytes, { truncated: full.truncated });
    }

    const verdict: ProvenanceVerdict = { verdict: scan.verdict };
    if (scan.source) verdict.source = scan.source;
    if (scan.detail) verdict.detail = scan.detail;
    return verdict;
  } catch {
    return { verdict: 'error' };
  }
}

export async function checkUrls(urls: string[]): Promise<Record<string, ProvenanceVerdict>> {
  const store = await getCache();
  const results: Record<string, ProvenanceVerdict> = {};
  const pending: Array<Promise<void>> = [];

  for (const url of new Set(urls)) {
    const cached = store.get(url);
    const isStale = cached?.verdict === 'error' && Date.now() - cached.at > ERROR_TTL_MS;
    if (cached && !isStale) {
      results[url] = { verdict: cached.verdict, source: cached.source, detail: cached.detail };
      continue;
    }

    let task = inFlight.get(url);
    if (!task) {
      task = withSlot(() => scanUrl(url)).then((verdict) => {
        store.set(url, { ...verdict, at: Date.now() });
        schedulePersist();
        inFlight.delete(url);
        return verdict;
      });
      inFlight.set(url, task);
    }

    pending.push(
      task.then((verdict) => {
        results[url] = verdict;
      }),
    );
  }

  await Promise.all(pending);
  return results;
}

/** Called on navigation: nothing queued for a gone page is worth finishing. */
export function dropQueue(): void {
  waiting.length = 0;
}
