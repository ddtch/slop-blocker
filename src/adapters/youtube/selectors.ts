// All YouTube-specific DOM knowledge lives here, so a breakage is a one-file fix.
// See NOTES.md in this directory before editing.

export const LAST_VERIFIED = '2026-09-03';
export const VERIFIED_AGAINST = 'written from public documentation; NOT yet confirmed on a live page';

/** The watch-page player; also the element the shroud covers. */
export const PLAYER = ['#movie_player', 'ytd-player #container', '.html5-video-player'];

export const VIDEO = ['video.html5-main-video', 'video'];

/**
 * Containers that may hold the synthetic-content disclosure.
 *
 * These must be the disclosure UI only. Adding '#description' here would make
 * any video that merely talks about AI labelling block itself.
 */
export const DISCLOSURE_CONTAINERS = [
  'ytd-watch-metadata ytd-metadata-row-container-renderer',
  'ytd-metadata-row-container-renderer',
  '#middle-row',
  'ytd-info-panel-content-renderer',
  '#how-this-was-made',
  '.ytp-generated-content-label',
  '.ytp-synthetic-content-label',
];

/** Text used for keyword scoring (title and description). */
export const TITLE = ['ytd-watch-metadata h1 yt-formatted-string', 'ytd-watch-metadata h1', 'h1.title'];
export const DESCRIPTION = ['#description-inline-expander', '#description', '#info-container'];

/**
 * Channel identity, most specific first — `creatorOf` takes the first match, so
 * the order is the priority.
 *
 * The first four are the watch page's owner block. The next three are the
 * Shorts channel bar, which shares none of that markup: on a Short the owner
 * lives in the reel's own header, so with only the watch-page selectors the
 * popup offered "Block this video" and no way to block the channel.
 *
 * The last entry is a deliberate catch-all for any link to a handle. It is last
 * because on a watch page it would otherwise match a commenter before the
 * uploader; by the time it is reached, the specific selectors have all missed.
 */
export const CHANNEL_LINK = [
  'ytd-video-owner-renderer a[href]',
  '#owner a[href]',
  'ytd-channel-name a[href]',
  '#upload-info a[href]',
  'ytd-reel-player-header-renderer a[href]',
  'yt-reel-channel-bar-view-model a[href]',
  '[class*="ReelChannelBar"] a[href]',
  'a[href^="/@"]',
];

/** The channel name in a channel page's header, for display only. */
export const CHANNEL_PAGE_NAME = [
  'ytd-channel-name #text',
  '#channel-header #channel-name #text',
  'yt-dynamic-text-view-model h1',
  '#channel-header h1',
];

/** Shorts: each reel is its own item with its own video and metadata. */
export const SHORTS_ITEM = ['ytd-reel-video-renderer', 'ytd-shorts-player-controls'];
export const SHORTS_LINK = ['a[href*="/shorts/"]'];
export const SHORTS_TEXT = [
  '#overlay .caption',
  'yt-shorts-video-title-view-model',
  '.reel-video-in-sequence-new',
  '[class*="ShortsVideoTitle"]',
];

/** Reads the channel handle or id out of a YouTube URL path. */
export function parseChannelHref(href: string): { handle?: string; id?: string } | null {
  try {
    const { pathname } = new URL(href, 'https://www.youtube.com');
    const handle = /^\/@([^/]+)/.exec(pathname);
    if (handle?.[1]) return { handle: handle[1] };
    const channel = /^\/channel\/([^/]+)/.exec(pathname);
    if (channel?.[1]) return { id: channel[1] };
    const user = /^\/(?:c|user)\/([^/]+)/.exec(pathname);
    if (user?.[1]) return { handle: user[1] };
    return null;
  } catch {
    return null;
  }
}

/**
 * True when the path is a watch/shorts/embed/live page rather than a feed.
 * Kept here so the adapter never hard-codes a YouTube path shape of its own.
 */
export function isVideoPath(pathname: string): boolean {
  return (
    pathname.startsWith('/watch') ||
    pathname.startsWith('/shorts/') ||
    pathname.startsWith('/embed/') ||
    pathname.startsWith('/live/')
  );
}

/** The video id for a watch or shorts URL. */
export function parseVideoId(href: string): string | null {
  try {
    const url = new URL(href, 'https://www.youtube.com');
    const fromQuery = url.searchParams.get('v');
    if (fromQuery) return fromQuery;
    const shorts = /^\/shorts\/([^/?#]+)/.exec(url.pathname);
    if (shorts?.[1]) return shorts[1];
    const embed = /^\/embed\/([^/?#]+)/.exec(url.pathname);
    if (embed?.[1]) return embed[1];
    return null;
  } catch {
    return null;
  }
}
