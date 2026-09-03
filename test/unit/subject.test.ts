// @vitest-environment jsdom
//
// What the popup's quick actions act on. These run without any detection at
// all — the point of the feature is to block a channel we have no signal on.

import { beforeEach, describe, expect, it } from 'vitest';

import { youtubeAdapter } from '../../src/adapters/youtube';
import { tiktokAdapter } from '../../src/adapters/tiktok';
import { xAdapter } from '../../src/adapters/x';
import { instagramAdapter } from '../../src/adapters/instagram';
import type { SiteAdapter } from '../../src/adapters/types';
import { makeContext } from '../helpers/context';

function subjectOf(adapter: SiteAdapter, href: string) {
  const ctx = makeContext({ href, hostname: new URL(href).hostname });
  return adapter.subject?.(document, ctx) ?? null;
}

/** jsdom lays nothing out, so viewport geometry has to be stated. */
function fillViewport(element: HTMLElement, share = 0.9): void {
  const height = window.innerHeight * share;
  const top = (window.innerHeight - height) / 2;
  element.getBoundingClientRect = () =>
    ({ width: 400, height, top, bottom: top + height, left: 0, right: 400 }) as DOMRect;
}

/** A short item near the top: visible, but not what the page is about. */
function smallItem(element: HTMLElement, top: number): void {
  element.getBoundingClientRect = () =>
    ({ width: 400, height: 120, top, bottom: top + 120, left: 0, right: 400 }) as DOMRect;
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
});

describe('YouTube', () => {
  it('reads the channel from a handle URL, with no page content at all', () => {
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/@slopchannel');
    expect(subject?.creator).toEqual({ platform: 'youtube', handle: 'slopchannel' });
    expect(subject?.item).toBeUndefined();
  });

  it('reads a channel id URL', () => {
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/channel/UCabc123');
    expect(subject?.creator).toEqual({ platform: 'youtube', id: 'UCabc123' });
  });

  it('still resolves the channel on a sub-tab of the channel page', () => {
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/@slopchannel/videos');
    expect(subject?.creator?.handle).toBe('slopchannel');
  });

  it('picks up the display name from the channel header when it has rendered', () => {
    document.body.innerHTML = '<ytd-channel-name><span id="text">Slop Channel</span></ytd-channel-name>';
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/@slopchannel');
    expect(subject?.creator?.name).toBe('Slop Channel');
  });

  it('reads both the video and its channel on a watch page', () => {
    document.body.innerHTML = `
      <ytd-watch-metadata><h1><yt-formatted-string>Cats, but rendered</yt-formatted-string></h1></ytd-watch-metadata>
      <ytd-video-owner-renderer><a href="/@slopchannel">Slop Channel</a></ytd-video-owner-renderer>
    `;
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(subject?.item).toEqual({
      platform: 'youtube',
      id: 'dQw4w9WgXcQ',
      title: 'Cats, but rendered',
    });
    expect(subject?.creator?.handle).toBe('slopchannel');
  });

  it('reads a Shorts URL as an item', () => {
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/shorts/xyz789');
    expect(subject?.item?.id).toBe('xyz789');
  });

  // Reported from a live Short: the popup offered "Block this video" and no way
  // to block the channel, because the Shorts channel bar shares none of the
  // watch page's owner markup.
  it('finds the channel on a Short, whose owner is not in the watch-page markup', () => {
    document.body.innerHTML = `
      <ytd-reel-video-renderer>
        <video></video>
        <yt-reel-channel-bar-view-model>
          <a href="/@albertatech">@albertatech</a>
        </yt-reel-channel-bar-view-model>
      </ytd-reel-video-renderer>
    `;
    const subject = subjectOf(youtubeAdapter, 'https://www.youtube.com/shorts/Ah_LMYqd2CE');
    expect(subject?.creator?.handle).toBe('albertatech');
    expect(subject?.item?.id).toBe('Ah_LMYqd2CE');
  });

  it('finds the channel on a Short through an unfamiliar wrapper', () => {
    // The catch-all handle link, for when the channel-bar element is renamed
    // again — which is the failure this whole selector list exists to survive.
    document.body.innerHTML = '<div class="some-new-name"><a href="/@albertatech">Alberta Tech</a></div>';
    expect(subjectOf(youtubeAdapter, 'https://www.youtube.com/shorts/abc')?.creator?.handle).toBe(
      'albertatech',
    );
  });

  // The catch-all must not outrank the owner block on a watch page, or the
  // first commenter would become the "author" of the video.
  it('prefers the video owner over any other handle link on a watch page', () => {
    document.body.innerHTML = `
      <ytd-video-owner-renderer><a href="/@therealuploader">The Real Uploader</a></ytd-video-owner-renderer>
      <ytd-comments><a href="/@somecommenter">Some Commenter</a></ytd-comments>
    `;
    expect(subjectOf(youtubeAdapter, 'https://www.youtube.com/watch?v=abc')?.creator?.handle).toBe(
      'therealuploader',
    );
  });

  // A feed is not about one thing, so offering "block this channel" there would
  // be a lie about which channel it means.
  it('returns nothing on the home feed, search and subscriptions', () => {
    expect(subjectOf(youtubeAdapter, 'https://www.youtube.com/')).toBeNull();
    expect(subjectOf(youtubeAdapter, 'https://www.youtube.com/results?search_query=ai')).toBeNull();
    expect(subjectOf(youtubeAdapter, 'https://www.youtube.com/feed/subscriptions')).toBeNull();
  });
});

describe('TikTok', () => {
  it('reads a profile', () => {
    const subject = subjectOf(tiktokAdapter, 'https://www.tiktok.com/@slopmaker');
    expect(subject?.creator?.handle).toBe('slopmaker');
    expect(subject?.item).toBeUndefined();
  });

  it('reads a video, keeping the author in the item id so it stays unique', () => {
    const subject = subjectOf(tiktokAdapter, 'https://www.tiktok.com/@slopmaker/video/7412345');
    expect(subject?.creator?.handle).toBe('slopmaker');
    expect(subject?.item?.id).toBe('slopmaker/video/7412345');
  });

  /*
   * Reported from a live page. TikTok's For You feed is served from
   * tiktok.com with no path at all, but it is not a feed in the sense that
   * matters here: one video fills the screen with its author printed on it, so
   * there is exactly one thing to act on. Reading only the URL meant the popup
   * offered nothing on the page where people spend all their time.
   */
  it('names the video filling the screen on the pathless For You feed', () => {
    document.body.innerHTML = `
      <div class="whatever-tiktok-calls-it-today">
        <video></video>
        <a href="/@glitterclitter">glitterclitter</a>
        <a href="/@glitterclitter/video/7412345">link</a>
      </div>
    `;
    fillViewport(document.querySelector('video') as HTMLElement);

    const subject = subjectOf(tiktokAdapter, 'https://www.tiktok.com/');
    expect(subject?.creator?.handle).toBe('glitterclitter');
    expect(subject?.item?.id).toBe('glitterclitter/video/7412345');
  });

  it('names the author even when the post carries no permalink', () => {
    document.body.innerHTML = '<div><video></video><a href="/@someone">someone</a></div>';
    fillViewport(document.querySelector('video') as HTMLElement);

    const subject = subjectOf(tiktokAdapter, 'https://www.tiktok.com/');
    expect(subject?.creator?.handle).toBe('someone');
    expect(subject?.item).toBeUndefined();
  });

  // The guard on the above: in a scrolling list of many posts, picking one of
  // them would be a guess about which the user meant.
  it('names nobody when no single post dominates the viewport', () => {
    document.body.innerHTML = `
      <div><video></video><a href="/@one">one</a></div>
      <div><video></video><a href="/@two">two</a></div>
    `;
    const videos = [...document.querySelectorAll('video')] as HTMLElement[];
    smallItem(videos[0]!, 100);
    smallItem(videos[1]!, 300);

    expect(subjectOf(tiktokAdapter, 'https://www.tiktok.com/')).toBeNull();
  });

  it('names nobody on an empty feed', () => {
    expect(subjectOf(tiktokAdapter, 'https://www.tiktok.com/foryou')).toBeNull();
  });

  it('still prefers the URL when it names the author', () => {
    // A video page that also happens to show some other account's link first.
    document.body.innerHTML = '<div><video></video><a href="/@notthisone">x</a></div>';
    fillViewport(document.querySelector('video') as HTMLElement);

    const subject = subjectOf(tiktokAdapter, 'https://www.tiktok.com/@realauthor/video/99');
    expect(subject?.creator?.handle).toBe('realauthor');
    expect(subject?.item?.id).toBe('realauthor/video/99');
  });
});

describe('X', () => {
  it('reads a profile and a status', () => {
    expect(subjectOf(xAdapter, 'https://x.com/someone')?.creator?.handle).toBe('someone');
    const post = subjectOf(xAdapter, 'https://x.com/someone/status/123');
    expect(post?.item?.id).toBe('someone/status/123');
  });

  it('does not mistake a reserved path for a username', () => {
    expect(subjectOf(xAdapter, 'https://x.com/home')).toBeNull();
    expect(subjectOf(xAdapter, 'https://x.com/i/bookmarks')).toBeNull();
  });
});

describe('Instagram', () => {
  it('reads a profile', () => {
    expect(subjectOf(instagramAdapter, 'https://www.instagram.com/someone/')?.creator?.handle).toBe(
      'someone',
    );
  });

  // Instagram post URLs do not carry the username, so the author has to come
  // out of the post chrome.
  it('reads a post id, and falls back to the post header for the author', () => {
    document.body.innerHTML = '<article><header><a href="/someone/">someone</a></header></article>';
    const subject = subjectOf(instagramAdapter, 'https://www.instagram.com/p/CabcDEF/');
    expect(subject?.item?.id).toBe('CabcDEF');
    expect(subject?.creator?.handle).toBe('someone');
  });

  it('does not mistake /explore/ for a username', () => {
    expect(subjectOf(instagramAdapter, 'https://www.instagram.com/explore/')).toBeNull();
  });
});
