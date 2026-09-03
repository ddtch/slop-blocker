// @vitest-environment jsdom
//
// The generic adapter plus the provenance path: what happens on an ordinary
// website, where there is no platform label to read.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Engine } from '../../src/content/engine';
import { genericAdapter } from '../../src/adapters/generic';
import { disambiguateKeys } from '../../src/adapters/types';
import type { ProvenanceVerdict } from '../../src/proto';
import type { Detection } from '../../src/types';
import { makeContext } from '../helpers/context';

const PAGE_URL = 'https://blog.example/post';

let sent: Array<{ t: string; [key: string]: unknown }> = [];
let verdicts: Record<string, ProvenanceVerdict> = {};

function mockMessaging(): void {
  sent = [];
  const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
    .runtime;
  runtime.sendMessage = vi.fn(async (msg: { t: string; urls?: string[] }) => {
    sent.push(msg as { t: string });
    if (msg.t === 'provenance/check') {
      const results: Record<string, ProvenanceVerdict> = {};
      for (const url of msg.urls ?? []) results[url] = verdicts[url] ?? { verdict: 'none' };
      return { results };
    }
    return { ok: true };
  });
}

/** jsdom lays nothing out, so images need a size to clear the icon filter. */
function sizeImage(image: HTMLImageElement, size = 300): void {
  image.getBoundingClientRect = () =>
    ({ width: size, height: size, top: 10, left: 10, bottom: 10 + size, right: 10 + size }) as DOMRect;
}

function reported(): Detection[] {
  return sent
    .filter((msg) => msg.t === 'detections/report')
    .flatMap((msg) => (msg.detections as Detection[]) ?? []);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 400));

let engine: Engine | null = null;

beforeEach(() => {
  mockMessaging();
  verdicts = {};
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

afterEach(() => {
  engine?.destroy();
  engine = null;
});

describe('provenance on an ordinary page', () => {
  it('blocks an image whose metadata declares AI generation', async () => {
    document.body.innerHTML = '<img src="https://cdn.example/art.png" alt="a landscape">';
    const image = document.querySelector('img') as HTMLImageElement;
    sizeImage(image);
    verdicts['https://cdn.example/art.png'] = {
      verdict: 'ai',
      source: 'c2pa',
      detail: 'Adobe Firefly',
    };

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();

    // Nothing is known on the first pass; the verdict arrives asynchronously.
    expect(document.querySelectorAll('[data-slop-blocker]')).toHaveLength(0);

    await settle();
    expect(document.querySelectorAll('[data-slop-blocker="block"]')).toHaveLength(1);

    const detection = reported().at(-1);
    expect(detection?.confidence).toBe('confirmed');
    expect(detection?.source).toContain('c2pa');
    expect(detection?.reason).toContain('Adobe Firefly');
  });

  it('treats a generator-only manifest as likely, not confirmed', async () => {
    document.body.innerHTML = '<img src="https://cdn.example/tool.png" alt="a landscape">';
    sizeImage(document.querySelector('img') as HTMLImageElement);
    verdicts['https://cdn.example/tool.png'] = {
      verdict: 'generator',
      source: 'c2pa',
      detail: 'Midjourney',
    };

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();
    await settle();

    expect(reported().at(-1)?.confidence).toBe('likely');
  });

  it('leaves clean images alone', async () => {
    document.body.innerHTML = '<img src="https://cdn.example/photo.jpg" alt="a landscape">';
    sizeImage(document.querySelector('img') as HTMLImageElement);
    verdicts['https://cdn.example/photo.jpg'] = { verdict: 'clean' };

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();
    await settle();

    expect(document.querySelectorAll('[data-slop-blocker]')).toHaveLength(0);
    expect(reported()).toHaveLength(0);
  });

  it('skips images too small to be content', () => {
    document.body.innerHTML = '<img src="https://cdn.example/icon.png" alt="#aiart">';
    const image = document.querySelector('img') as HTMLImageElement;
    sizeImage(image, 24);

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();

    expect(document.querySelectorAll('[data-slop-blocker]')).toHaveLength(0);
  });

  it('does not request provenance for streaming URLs', () => {
    document.body.innerHTML = '<video src="https://cdn.example/stream.m3u8"></video>';
    const video = document.querySelector('video') as HTMLVideoElement;
    video.getBoundingClientRect = () =>
      ({ width: 640, height: 360, top: 0, left: 0, bottom: 360, right: 640 }) as DOMRect;

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();

    expect(sent.some((msg) => msg.t === 'provenance/check')).toBe(false);
  });
});

describe('duplicate media on one page', () => {
  it('covers every copy of a repeated image, not just the first', () => {
    // Same URL three times with different captions: a real pattern on feeds and
    // in galleries that reuse a placeholder.
    document.body.innerHTML = `
      <img src="https://cdn.example/same.png" alt="#aiart one">
      <img src="https://cdn.example/same.png" alt="#aiart two">
      <img src="https://cdn.example/same.png" alt="#aiart three">
    `;
    for (const image of document.querySelectorAll('img')) sizeImage(image as HTMLImageElement);

    engine = new Engine(makeContext({ href: PAGE_URL, hostname: 'blog.example' }), genericAdapter);
    engine.scan();

    expect(document.querySelectorAll('[data-slop-blocker="block"]')).toHaveLength(3);
  });

  it('keeps the first occurrence key stable and qualifies only the later ones', () => {
    const element = document.createElement('img');
    document.body.appendChild(element);
    const second = document.createElement('img');
    document.body.appendChild(second);

    const candidates = disambiguateKeys([
      { element, mediaType: 'image', key: 'https://x/y.png', text: '' },
      { element: second, mediaType: 'image', key: 'https://x/y.png', text: '' },
    ]);

    expect(candidates[0]?.key).toBe('https://x/y.png');
    expect(candidates[1]?.key).not.toBe('https://x/y.png');
    expect(candidates[1]?.key.startsWith('https://x/y.png|')).toBe(true);
  });
});

describe('the user domain blocklist', () => {
  it('covers the whole page for a blocked domain', () => {
    document.body.innerHTML = '<p>content</p>';
    const ctx = makeContext({ href: PAGE_URL, hostname: 'slop.example' });
    ctx.personalLists.blockDomains.push('slop.example');

    engine = new Engine(ctx, genericAdapter);
    engine.scan();

    expect(document.querySelectorAll('[data-slop-blocker="page"]')).toHaveLength(1);
  });

  it('does not touch other domains', () => {
    document.body.innerHTML = '<p>content</p>';
    const ctx = makeContext({ href: PAGE_URL, hostname: 'blog.example' });
    ctx.personalLists.blockDomains.push('slop.example');

    engine = new Engine(ctx, genericAdapter);
    engine.scan();

    expect(document.querySelectorAll('[data-slop-blocker]')).toHaveLength(0);
  });
});
