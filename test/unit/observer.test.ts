// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.tiktok.com/foryou" }
//
// When the engine is asked to rescan, and — the reason this file exists — how a
// same-document navigation is noticed at all.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { observe, type Observer } from '../../src/content/observer';
import { genericAdapter } from '../../src/adapters/generic';

let observer: Observer | null = null;
let scans = 0;
let navigations: string[] = [];

function start(): void {
  scans = 0;
  navigations = [];
  observer = observe(
    genericAdapter,
    () => {
      scans++;
    },
    (href) => {
      navigations.push(href);
    },
  );
}

/** Long enough for the mutation debounce (250 ms) plus the idle callback. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 700));

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState(null, '', '/foryou');
  start();
});

afterEach(() => {
  observer?.stop();
  observer = null;
  vi.restoreAllMocks();
});

describe('observer', () => {
  it('scans after a DOM mutation', async () => {
    document.body.appendChild(document.createElement('div'));
    await settle();
    expect(scans).toBeGreaterThan(0);
    expect(navigations).toEqual([]);
  });

  /*
   * The bug this guards: TikTok, Instagram and X move between a feed and a post
   * with history.pushState, which fires neither popstate nor hashchange, and a
   * content script cannot patch pushState because the page calls its own
   * binding in another world. The quick actions were therefore computed from
   * the URL the tab was opened at — a feed, which is about nobody — so no
   * buttons appeared on the video the user was actually watching.
   */
  it('notices a pushState navigation on the next mutation', async () => {
    history.pushState(null, '', '/@jrdahussla/video/7678123');
    document.body.appendChild(document.createElement('div'));
    await settle();

    expect(navigations).toEqual(['https://www.tiktok.com/@jrdahussla/video/7678123']);
  });

  it('reports a navigation once, then goes back to scanning', async () => {
    history.pushState(null, '', '/@someone/video/1');
    document.body.appendChild(document.createElement('div'));
    await settle();

    document.body.appendChild(document.createElement('div'));
    await settle();

    expect(navigations).toHaveLength(1);
    expect(scans).toBeGreaterThan(0);
  });

  it('still handles popstate', async () => {
    history.pushState(null, '', '/@someone/video/1');
    window.dispatchEvent(new Event('popstate'));
    await settle();
    expect(navigations).toEqual(['https://www.tiktok.com/@someone/video/1']);
  });

  it('stops observing after stop()', async () => {
    observer?.stop();
    history.pushState(null, '', '/@someone/video/2');
    document.body.appendChild(document.createElement('div'));
    await settle();

    expect(scans).toBe(0);
    expect(navigations).toEqual([]);
  });
});
