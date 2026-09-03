// YouTube adapter: reads the "altered or synthetic content" disclosure and
// exposes the watch/shorts player so the engine can pause and cover it.
//
// Two independent paths, because either can break on its own:
//   1. the player response captured by the main-world script (fast, pre-playback)
//   2. the rendered disclosure UI in the DOM (works even if the JSON shape changes)

import type { CreatorRef, ItemRef, PageContext, PageSubject } from '../../types';
import { disclosureStrings } from '../disclosure';
import { findDisclosure } from '../disclosure';
import { queryAll, queryFirst, textOf, domPath, type MediaCandidate, type SiteAdapter } from '../types';
import {
  CHANNEL_LINK,
  CHANNEL_PAGE_NAME,
  DESCRIPTION,
  DISCLOSURE_CONTAINERS,
  PLAYER,
  SHORTS_ITEM,
  SHORTS_LINK,
  SHORTS_TEXT,
  TITLE,
  VIDEO,
  isVideoPath,
  parseChannelHref,
  parseVideoId,
} from './selectors';

const PLATFORM = 'youtube';
const SIGNAL_EVENT = 'slopblocker:yt';

interface PlayerHit {
  path: string;
  value: string | boolean;
  strict: boolean;
}

interface PlayerSignal {
  videoId: string | null;
  hits: PlayerHit[];
}

let lastSignal: PlayerSignal | null = null;

/**
 * Turns the main-world summary into a disclosure label.
 *
 * A strict key (one whose name mentions synthetic/altered/AI-generated) only
 * exists when there is something to disclose, so its presence is enough. A
 * loose "disclosure" key must additionally match a known disclosure string,
 * because YouTube uses that word for paid promotion too.
 */
function labelFromSignal(signal: PlayerSignal | null, ctx: PageContext): string | null {
  if (!signal?.hits?.length) return null;
  const strings = disclosureStrings(PLATFORM, ctx);

  for (const hit of signal.hits) {
    if (!hit.strict) continue;
    if (typeof hit.value === 'string' && hit.value.trim()) return hit.value.trim();
    if (hit.value === true) return strings[0] ?? 'Altered or synthetic content';
  }

  const lowered = strings.map((value) => [value, value.toLowerCase()] as const);
  for (const hit of signal.hits) {
    if (typeof hit.value !== 'string') continue;
    const haystack = hit.value.toLowerCase();
    for (const [original, needle] of lowered) {
      if (needle && haystack.includes(needle)) return original;
    }
  }
  return null;
}

function labelFromDom(root: ParentNode, ctx: PageContext): string | null {
  const containers = queryAll(root, DISCLOSURE_CONTAINERS);
  return findDisclosure(containers, disclosureStrings(PLATFORM, ctx));
}

function creatorFrom(root: ParentNode): CreatorRef | undefined {
  for (const link of queryAll(root, CHANNEL_LINK)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const parsed = parseChannelHref(href);
    if (!parsed) continue;
    const creator: CreatorRef = { platform: PLATFORM };
    if (parsed.id) creator.id = parsed.id;
    if (parsed.handle) creator.handle = parsed.handle;
    const name = link.textContent?.trim();
    if (name) creator.name = name;
    return creator;
  }
  return undefined;
}

function watchCandidate(root: ParentNode, ctx: PageContext): MediaCandidate | null {
  const player = queryFirst(root, PLAYER);
  if (!player) return null;

  const videoId = parseVideoId(ctx.href);
  const video = queryFirst(player, VIDEO) ?? queryFirst(root, VIDEO);

  // Only trust the JSON signal when it describes the video we are looking at.
  const signalMatches = !lastSignal?.videoId || !videoId || lastSignal.videoId === videoId;
  const label = (signalMatches ? labelFromSignal(lastSignal, ctx) : null) ?? labelFromDom(root, ctx);

  const candidate: MediaCandidate = {
    element: player,
    mediaType: 'video',
    key: videoId ? `yt:${videoId}` : domPath(player),
    text: textOf(queryFirst(root, TITLE)?.textContent, queryFirst(root, DESCRIPTION)?.textContent),
  };
  if (videoId) {
    candidate.mediaUrl = `https://www.youtube.com/watch?v=${videoId}`;
    candidate.itemRef = { platform: PLATFORM, id: videoId };
  }
  if (video instanceof HTMLVideoElement) candidate.video = video;
  const creator = creatorFrom(root);
  if (creator) candidate.creator = creator;
  if (label) candidate.platformLabel = { platform: PLATFORM, label };
  return candidate;
}

function shortsCandidates(root: ParentNode, ctx: PageContext): MediaCandidate[] {
  const candidates: MediaCandidate[] = [];

  for (const item of queryAll(root, SHORTS_ITEM)) {
    const video = queryFirst(item, VIDEO);
    if (!(video instanceof HTMLVideoElement)) continue;

    const href = queryFirst(item, SHORTS_LINK)?.getAttribute('href') ?? '';
    const videoId = parseVideoId(href) ?? parseVideoId(ctx.href);
    const signalMatches = Boolean(videoId) && lastSignal?.videoId === videoId;
    const label = (signalMatches ? labelFromSignal(lastSignal, ctx) : null) ?? labelFromDom(item, ctx);

    const candidate: MediaCandidate = {
      element: item,
      mediaType: 'video',
      key: videoId ? `yt:${videoId}` : domPath(item),
      text: textOf(...queryAll(item, SHORTS_TEXT).map((element) => element.textContent)),
      video,
    };
    if (videoId) {
      candidate.mediaUrl = `https://www.youtube.com/shorts/${videoId}`;
      candidate.itemRef = { platform: PLATFORM, id: videoId };
    }
    const creator = creatorFrom(item);
    if (creator) candidate.creator = creator;
    if (label) candidate.platformLabel = { platform: PLATFORM, label };
    candidates.push(candidate);
  }

  return candidates;
}

/**
 * What the popup's quick actions act on.
 *
 * Read from the URL first and the DOM only for display names, because this has
 * to work on a channel page where nothing was detected and possibly before the
 * page has finished rendering.
 */
function subject(root: ParentNode, ctx: PageContext): PageSubject | null {
  const { pathname } = new URL(ctx.href, 'https://www.youtube.com');
  const result: PageSubject = { platform: PLATFORM };

  if (isVideoPath(pathname)) {
    const videoId = parseVideoId(ctx.href);
    if (videoId) {
      const item: ItemRef = { platform: PLATFORM, id: videoId };
      const title = queryFirst(root, TITLE)?.textContent?.trim();
      if (title) item.title = title;
      result.item = item;
    }
    const creator = creatorFrom(root);
    if (creator) result.creator = creator;
    return result.item || result.creator ? result : null;
  }

  // A channel page — /@handle, /channel/UC…, /c/name, /user/name — and every
  // tab under it (/videos, /streams, /playlists), which share the prefix.
  const parsed = parseChannelHref(pathname);
  if (parsed) {
    const creator: CreatorRef = { platform: PLATFORM };
    if (parsed.id) creator.id = parsed.id;
    if (parsed.handle) creator.handle = parsed.handle;
    const name = queryFirst(root, CHANNEL_PAGE_NAME)?.textContent?.trim();
    if (name) creator.name = name;
    result.creator = creator;
    return result;
  }

  // Home, search, subscriptions: no single subject to act on.
  return null;
}

export const youtubeAdapter: SiteAdapter = {
  id: 'youtube',
  platform: PLATFORM,
  matches: (hostname) => /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(hostname),

  init(_ctx, onSignal) {
    window.addEventListener(SIGNAL_EVENT, (event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail !== 'string') return;
      try {
        lastSignal = JSON.parse(detail) as PlayerSignal;
        onSignal();
      } catch {
        // Malformed payload; the DOM fallback still applies.
      }
    });
  },

  onNavigate(callback) {
    const events = ['yt-navigate-finish', 'yt-page-data-updated'];
    const handler = () => callback();
    for (const name of events) window.addEventListener(name, handler, true);
    return () => {
      for (const name of events) window.removeEventListener(name, handler, true);
    };
  },

  subject,

  candidates(root: ParentNode, ctx: PageContext): MediaCandidate[] {
    const path = new URL(ctx.href, 'https://www.youtube.com').pathname;

    if (path.startsWith('/shorts/')) return shortsCandidates(root, ctx);

    if (path.startsWith('/watch') || path.startsWith('/embed/') || path.startsWith('/live/')) {
      const candidate = watchCandidate(root, ctx);
      return candidate ? [candidate] : [];
    }

    // Feed and channel pages: badging thumbnails is milestone M2 (SPEC.md §3.2).
    return [];
  },
};
