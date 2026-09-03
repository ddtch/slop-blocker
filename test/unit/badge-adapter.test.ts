// @vitest-environment jsdom
//
// The fallback that keeps a platform covered when it renames its containers.
//
// Every selector in a badge adapter is an obfuscated class name or a `data-e2e`
// attribute that the platform rewrites without warning, and when they all miss
// the adapter produces no candidates and the site goes silently uncovered — no
// error, no empty state, just "nothing detected here" on a page full of labelled
// AI content. That is what a live TikTok page looked like.

import { beforeEach, describe, expect, it } from 'vitest';

import { tiktokAdapter } from '../../src/adapters/tiktok';
import { makeContext } from '../helpers/context';

const FEED_URL = 'https://www.tiktok.com/';

function candidates(href = FEED_URL) {
  const ctx = makeContext({ href, hostname: 'www.tiktok.com' });
  return tiktokAdapter.candidates(document, ctx);
}

function fillViewport(element: HTMLElement, share = 0.9): void {
  const height = window.innerHeight * share;
  const top = (window.innerHeight - height) / 2;
  element.getBoundingClientRect = () =>
    ({ width: 400, height, top, bottom: top + height, left: 0, right: 400 }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

describe('badge adapter fallback', () => {
  it('finds nothing when nothing fills the screen', () => {
    document.body.innerHTML = '<div><video></video></div>';
    expect(candidates()).toHaveLength(0);
  });

  it('treats the video filling the screen as a candidate, whatever it is wrapped in', () => {
    document.body.innerHTML = `
      <div class="DivSomeNameTikTokWillChange">
        <video></video>
        <a href="/@glitterclitter">glitterclitter</a>
      </div>
    `;
    fillViewport(document.querySelector('video') as HTMLElement);

    const found = candidates();
    expect(found).toHaveLength(1);
    expect(found[0]?.creator?.handle).toBe('glitterclitter');
    expect(found[0]?.video).toBeInstanceOf(HTMLVideoElement);
  });

  // The payoff: this is the page from the bug report, where TikTok's own badge
  // was plainly visible and we reported "nothing detected here".
  it('reads the AI badge out of the fallback container', () => {
    document.body.innerHTML = `
      <div class="DivSomeNameTikTokWillChange">
        <video></video>
        <a href="/@jrdahussla">JR Da Hussla</a>
        <div class="SomeBadgeName" aria-label="Contains AI-generated media"></div>
      </div>
    `;
    fillViewport(document.querySelector('video') as HTMLElement);

    expect(candidates()[0]?.platformLabel).toEqual({
      platform: 'tiktok',
      label: 'Contains AI-generated media',
    });
  });

  it('does not double up when a known container matches', () => {
    document.body.innerHTML = `
      <div data-e2e="feed-video">
        <video></video>
        <a href="/@someone">someone</a>
      </div>
    `;
    fillViewport(document.querySelector('video') as HTMLElement);
    expect(candidates()).toHaveLength(1);
  });

  it('gives up rather than measuring a page full of media', () => {
    const posts = Array.from(
      { length: 60 },
      () => '<div><video></video><a href="/@someone">someone</a></div>',
    ).join('');
    document.body.innerHTML = posts;
    // Even with one of them filling the screen, the page is a grid, not a feed
    // of one — and measuring every element on every scan is not worth it.
    fillViewport(document.querySelector('video') as HTMLElement);
    expect(candidates()).toHaveLength(0);
  });

  // The caption must never be searched for disclosure strings, fallback or not:
  // "AI-generated" in a caption is usually the topic, not a disclosure.
  it('does not treat a caption mentioning AI as a platform label', () => {
    document.body.innerHTML = `
      <div class="DivSomeNameTikTokWillChange">
        <video></video>
        <a href="/@someone">someone</a>
        <div data-e2e="video-desc">why everything is AI-generated now</div>
      </div>
    `;
    fillViewport(document.querySelector('video') as HTMLElement);

    const found = candidates();
    expect(found[0]?.platformLabel).toBeUndefined();
    expect(found[0]?.text).toContain('AI-generated');
  });
});
