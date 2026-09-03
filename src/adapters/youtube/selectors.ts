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

/** Channel identity for the watch page. */
export const CHANNEL_LINK = [
  'ytd-video-owner-renderer a[href]',
  '#owner a[href]',
  'ytd-channel-name a[href]',
  '#upload-info a[href]',
];

/** Shorts: each reel is its own item with its own video and metadata. */
export const SHORTS_ITEM = ['ytd-reel-video-renderer', 'ytd-shorts-player-controls'];
export const SHORTS_LINK = ['a[href*="/shorts/"]'];
export const SHORTS_TEXT = ['#overlay .caption', 'yt-shorts-video-title-view-model', '.reel-video-in-sequence-new'];

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
