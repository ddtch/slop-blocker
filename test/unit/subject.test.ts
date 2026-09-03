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

beforeEach(() => {
  document.body.innerHTML = '';
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

  it('returns nothing on the feed', () => {
    expect(subjectOf(tiktokAdapter, 'https://www.tiktok.com/foryou')).toBeNull();
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
