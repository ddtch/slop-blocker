// @vitest-environment jsdom
//
// End-to-end through the real pieces: YouTube adapter -> signal providers ->
// confidence policy -> overlay -> video pause -> reported detections. Only the
// messaging boundary to the service worker is faked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Engine } from '../../src/content/engine';
import { youtubeAdapter } from '../../src/adapters/youtube';
import { detectionId } from '../../src/core/hash';
import type { Detection } from '../../src/types';
import { makeContext } from '../helpers/context';

const WATCH_URL = 'https://www.youtube.com/watch?v=abc123';

let sent: Array<{ t: string; [key: string]: unknown }> = [];

function mockMessaging(): void {
  sent = [];
  const runtime = (globalThis as unknown as { chrome: { runtime: Record<string, unknown> } }).chrome
    .runtime;
  runtime.sendMessage = vi.fn(async (msg: { t: string }) => {
    sent.push(msg as { t: string });
    if (msg.t === 'provenance/check') return { results: {} };
    return { ok: true };
  });
}

function reportedDetections(): Detection[] {
  return sent
    .filter((msg) => msg.t === 'detections/report')
    .flatMap((msg) => (msg.detections as Detection[]) ?? []);
}

/** jsdom media elements do not implement playback; stand in for it. */
function stubVideo(video: HTMLVideoElement, playing: boolean): { pause: ReturnType<typeof vi.fn> } {
  let paused = !playing;
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
  const pause = vi.fn(() => {
    paused = true;
  });
  video.pause = pause as unknown as HTMLVideoElement['pause'];
  video.play = (() => Promise.resolve()) as HTMLVideoElement['play'];
  return { pause };
}

function renderWatchPage({ disclosed, title }: { disclosed: boolean; title: string }): void {
  document.body.innerHTML = `
    <div id="movie_player"><video></video></div>
    <ytd-watch-metadata>
      <h1><yt-formatted-string>${title}</yt-formatted-string></h1>
    </ytd-watch-metadata>
    ${
      disclosed
        ? '<ytd-metadata-row-container-renderer>Altered or synthetic content</ytd-metadata-row-container-renderer>'
        : ''
    }
    <ytd-video-owner-renderer><a href="/@slopchannel">Slop Channel</a></ytd-video-owner-renderer>
  `;
}

function blockOverlays(): Element[] {
  return [...document.querySelectorAll('[data-slop-blocker="block"]')];
}

function chipOverlays(): Element[] {
  return [...document.querySelectorAll('[data-slop-blocker="chip"]')];
}

const flushReports = () => new Promise((resolve) => setTimeout(resolve, 400));

let engine: Engine | null = null;

beforeEach(() => {
  mockMessaging();
  document.body.innerHTML = '';
});

afterEach(() => {
  engine?.destroy();
  engine = null;
});

describe('a disclosed YouTube video', () => {
  it('is covered, paused, and reported as confirmed', async () => {
    renderWatchPage({ disclosed: true, title: 'A quiet walk in the woods' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(1);
    expect(pause).toHaveBeenCalledTimes(1);

    // The blur is the fallback layer in case the page removes our overlay.
    const player = document.querySelector('#movie_player') as HTMLElement;
    expect(player.style.filter).toContain('blur');

    await flushReports();
    const [detection] = reportedDetections();
    expect(detection?.confidence).toBe('confirmed');
    expect(detection?.source).toContain('platform-label');
    expect(detection?.reason).toContain('Altered or synthetic content');
    expect(detection?.blocked).toBe(true);
    expect(detection?.pausedVideo).toBe(true);
    expect(detection?.creator).toMatchObject({ platform: 'youtube', handle: 'slopchannel' });
  });

  it('undoes exactly one auto-resume, then leaves playback alone', async () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();
    expect(pause).toHaveBeenCalledTimes(1);

    // YouTube resuming on its own must be undone once...
    video.dispatchEvent(new Event('play'));
    expect(pause).toHaveBeenCalledTimes(2);

    // ...but we must not keep fighting after that.
    video.dispatchEvent(new Event('play'));
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it('does not pause when the user turned auto-pause off', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);

    const ctx = makeContext({ href: WATCH_URL });
    ctx.settings.autoPauseVideos = false;
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(1);
    expect(pause).not.toHaveBeenCalled();
  });

  it('scanning repeatedly does not create a second overlay', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();
    engine.scan();
    engine.scan();

    expect(blockOverlays()).toHaveLength(1);
  });
});

describe('revealing', () => {
  it('removes the overlay, restores the video, and never re-blocks', async () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);
    const player = document.querySelector('#movie_player') as HTMLElement;

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();

    engine.reveal(detectionId(WATCH_URL, 'yt:abc123'));
    expect(player.style.filter).not.toContain('blur');

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(blockOverlays()).toHaveLength(0);

    // A later scan (mutation, scroll, late-rendering label) must respect it.
    pause.mockClear();
    engine.scan();
    expect(blockOverlays()).toHaveLength(0);
    expect(pause).not.toHaveBeenCalled();

    await flushReports();
    expect(reportedDetections().some((detection) => detection.revealed)).toBe(true);
  });
});

describe('false positives', () => {
  // The case from SPEC.md §11: a video *about* AI labelling says the same words
  // a disclosure does. It must not be blocked.
  it('does not block a video that merely talks about AI content', async () => {
    renderWatchPage({ disclosed: false, title: 'AI-generated slop is ruining YouTube' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(0);
    expect(chipOverlays()).toHaveLength(1);

    await flushReports();
    const [detection] = reportedDetections();
    expect(detection?.confidence).toBe('suspected');
    expect(detection?.blocked).toBe(false);
  });

  it('leaves an ordinary video completely alone', async () => {
    renderWatchPage({ disclosed: false, title: 'Repairing a 1970s radio, part four' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);

    engine = new Engine(makeContext({ href: WATCH_URL }), youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(0);
    expect(chipOverlays()).toHaveLength(0);
    expect(pause).not.toHaveBeenCalled();

    await flushReports();
    expect(reportedDetections()).toHaveLength(0);
  });
});

describe('user lists', () => {
  it('never blocks a trusted author, even with a platform disclosure', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    const video = document.querySelector('video') as HTMLVideoElement;
    const { pause } = stubVideo(video, true);

    const ctx = makeContext({ href: WATCH_URL });
    ctx.personalLists.trustCreators.push({ platform: 'youtube', handle: 'slopchannel' });
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(0);
    expect(pause).not.toHaveBeenCalled();
  });

  it('blocks an author the user marked, with no other signal present', async () => {
    renderWatchPage({ disclosed: false, title: 'Repairing a 1970s radio, part four' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    const ctx = makeContext({ href: WATCH_URL });
    ctx.personalLists.blockCreators.push({ platform: 'youtube', handle: 'slopchannel' });
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(1);

    await flushReports();
    expect(reportedDetections()[0]?.source).toContain('user-marked');
  });
});

describe('being switched off', () => {
  it('does nothing when disabled globally', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    const ctx = makeContext({ href: WATCH_URL });
    ctx.settings.enabled = false;
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(0);
  });

  it('does nothing on a site the user switched off', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    const ctx = makeContext({ href: WATCH_URL });
    ctx.settings.disabledSites = ['www.youtube.com'];
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();

    expect(blockOverlays()).toHaveLength(0);
  });

  it('clears existing overlays when switched off at runtime', () => {
    renderWatchPage({ disclosed: true, title: 'clip' });
    stubVideo(document.querySelector('video') as HTMLVideoElement, true);

    const ctx = makeContext({ href: WATCH_URL });
    engine = new Engine(ctx, youtubeAdapter);
    engine.scan();
    expect(blockOverlays()).toHaveLength(1);

    engine.updateContext({ ...ctx.settings, enabled: false }, ctx.personalLists);
    expect(blockOverlays()).toHaveLength(0);
  });
});
