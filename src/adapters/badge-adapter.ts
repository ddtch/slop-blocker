// Factory for adapters on platforms whose only AI signal is a rendered badge
// next to a feed item (TikTok, Instagram/Facebook), plus post-level identity so
// the creator list and keyword scoring can work per post rather than per image.

import { normalizeMediaUrl } from '../core/hash';
import type { CreatorRef, ItemRef, MediaType, PageContext, PageSubject } from '../types';
import { disclosureStrings, findDisclosure } from './disclosure';
import {
  disambiguateKeys,
  domPath,
  queryAll,
  queryFirst,
  textOf,
  type MediaCandidate,
  type SiteAdapter,
} from './types';

export interface BadgeAdapterConfig {
  id: string;
  platform: string;
  hostPattern: RegExp;
  /** Feed item / post containers. */
  item: string[];
  /** Media inside an item; videos win over images when both are present. */
  media: string[];
  /**
   * Disclosure badge containers. These must NOT include the caption: captions
   * are creator free text, where "AI-generated" is often just a topic.
   */
  badge: string[];
  authorLink: string[];
  caption: string[];
  /** Item permalinks, used for a stable detection key. */
  permalink?: string[];
  /** Parses a profile URL into a creator identity. */
  parseAuthorHref(href: string): { handle?: string; id?: string } | null;
  /**
   * Parses the *current page's* path into the author and item it is about, for
   * the popup's quick actions. Distinct from `parseAuthorHref`, which reads
   * links found inside a feed item.
   */
  parseSubjectPath?(pathname: string): { handle?: string; itemId?: string } | null;
  /** In-page navigation events worth a rescan. */
  navigateEvents?: string[];
}

const MIN_RENDERED_PX = 96;

function isBigEnough(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return true; // not laid out yet; let it through
  return rect.width >= MIN_RENDERED_PX && rect.height >= MIN_RENDERED_PX;
}

function pickMedia(item: ParentNode, selectors: string[]): HTMLElement | null {
  const found = queryAll(item, selectors).filter(isBigEnough);
  return found.find((element) => element instanceof HTMLVideoElement) ?? found[0] ?? null;
}

function mediaSource(element: HTMLElement): string {
  if (element instanceof HTMLVideoElement) {
    return element.currentSrc || element.src || element.querySelector('source')?.src || '';
  }
  if (element instanceof HTMLImageElement) return element.currentSrc || element.src;
  return '';
}

export function createBadgeAdapter(config: BadgeAdapterConfig): SiteAdapter {
  const adapter: SiteAdapter = {
    id: config.id,
    platform: config.platform,
    matches: (hostname) => config.hostPattern.test(hostname),

    candidates(root: ParentNode, ctx: PageContext): MediaCandidate[] {
      const strings = disclosureStrings(config.platform, ctx);
      const items = queryAll(root, config.item);
      const candidates: MediaCandidate[] = [];

      for (const item of items) {
        const candidate = buildCandidate(item, config, strings);
        if (candidate) candidates.push(candidate);
      }

      // Nothing matched: either the page is not a feed, or the container names
      // changed again. Fall back to whatever media fills the viewport and the
      // nearest ancestor that looks like its post. Without this, a renamed
      // container means the whole site is silently uncovered.
      if (candidates.length === 0) {
        const container = dominantPost(root, config);
        if (container) {
          const candidate = buildCandidate(container, config, strings);
          if (candidate) candidates.push(candidate);
        }
      }

      return disambiguateKeys(candidates);
    },
  };

  if (config.parseSubjectPath) {
    const parseSubjectPath = config.parseSubjectPath;
    adapter.subject = (root, ctx) => {
      let pathname: string;
      try {
        pathname = new URL(ctx.href).pathname;
      } catch {
        return null;
      }
      const parsed = parseSubjectPath(pathname);
      const subject: PageSubject = { platform: config.platform };
      if (parsed?.handle) subject.creator = { platform: config.platform, handle: parsed.handle };
      if (parsed?.itemId) subject.item = { platform: config.platform, id: parsed.itemId };

      // The URL pinned the post but not who made it — Instagram's /p/<code>
      // carries no username. The page is about that one post, so any author
      // link on it is the right one.
      if (subject.item && !subject.creator) {
        const creator = creatorOf(root, config);
        if (creator) subject.creator = creator;
      }

      // The URL said nothing at all. TikTok's For You feed is served from
      // tiktok.com with no path, but it is not a feed in the sense that
      // matters: one video fills the screen with its author printed on it, so
      // there is exactly one thing to act on. Work out which post that is and
      // read it. `dominantPost` returns nothing unless one really dominates,
      // so a scrolling list of posts still names nobody.
      if (!subject.creator && !subject.item) {
        const container = dominantPost(root, config);
        if (container) {
          const creator = creatorOf(container, config);
          if (creator) subject.creator = creator;

          const permalink = config.permalink
            ? queryFirst(container, config.permalink)?.getAttribute('href')
            : null;
          const itemId = permalink ? itemIdFromPermalink(permalink, config) : null;
          if (itemId) subject.item = { platform: config.platform, id: itemId };
        }
      }

      return subject.creator || subject.item ? subject : null;
    };
  }

  if (config.navigateEvents?.length) {
    const events = config.navigateEvents;
    adapter.onNavigate = (callback) => {
      const handler = () => callback();
      for (const name of events) window.addEventListener(name, handler, true);
      return () => {
        for (const name of events) window.removeEventListener(name, handler, true);
      };
    };
  }

  return adapter;
}

/** Share of the viewport's height this element actually occupies. */
function visibleShare(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  const viewport = window.innerHeight;
  if (!viewport || !rect.height || !rect.width) return 0;
  const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
  if (visible <= 0) return 0;
  // It also has to be what you are looking at, not a tall sidebar beside it.
  const centre = viewport / 2;
  if (rect.top > centre || rect.bottom < centre) return 0;
  return visible / viewport;
}

/**
 * Minimum share of the viewport before we call one item "the" item.
 *
 * This is what separates a full-screen player — TikTok's For You, a Reel — from
 * a scrolling list of posts, where naming any single one of them would be a
 * guess about which the user meant.
 */
const DOMINANT_SHARE = 0.5;
/** How far up from the media to look for the post it belongs to. */
const MAX_CONTAINER_DEPTH = 12;
/**
 * Cap on media elements measured per scan. `getBoundingClientRect` forces
 * layout, this runs on every scan of a feed, and a page with a thousand
 * thumbnails has no dominant one anyway.
 */
const MAX_MEASURED = 50;

/**
 * The post that fills the viewport, found without knowing the page's container
 * names: take the media element that dominates the screen, then walk up to the
 * nearest ancestor that also holds a link to an author profile.
 *
 * Deliberately structural. Every selector in a `BadgeAdapterConfig` is an
 * obfuscated class or a `data-e2e` attribute that the platform rewrites without
 * warning; "the video you are looking at, and the box around it that names who
 * made it" is a description of the page that stays true across redesigns.
 */
function dominantPost(root: ParentNode, config: BadgeAdapterConfig): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestShare = DOMINANT_SHARE;

  const media = queryAll(root, config.media);
  if (media.length > MAX_MEASURED) return null;

  for (const element of media) {
    const share = visibleShare(element);
    if (share > bestShare) {
      best = element;
      bestShare = share;
    }
  }
  if (!best) return null;

  let node: HTMLElement | null = best;
  for (let depth = 0; node && depth < MAX_CONTAINER_DEPTH; depth++) {
    if (creatorOf(node, config)) return node;
    node = node.parentElement;
  }
  // No author anywhere above it; the media alone is still worth a candidate.
  return best;
}

/**
 * A stable id for one post, taken from its permalink path.
 *
 * The path rather than the full URL, so the same post found via a relative
 * href in a feed and an absolute one on its own page produce the same id.
 */
function itemIdFromPermalink(permalink: string, config: BadgeAdapterConfig): string | null {
  let pathname: string;
  try {
    pathname = new URL(permalink, `https://${config.platform}.invalid`).pathname;
  } catch {
    return null;
  }
  const parsed = config.parseSubjectPath?.(pathname);
  return parsed?.itemId ?? null;
}

/** Turns one post container into a candidate, or null when it holds no media. */
function buildCandidate(
  item: HTMLElement,
  config: BadgeAdapterConfig,
  strings: string[],
): MediaCandidate | null {
  const media = pickMedia(item, config.media);
  if (!media) return null;

  const source = mediaSource(media);
  const permalink = config.permalink
    ? queryFirst(item, config.permalink)?.getAttribute('href')
    : null;

  const mediaType: MediaType = media instanceof HTMLVideoElement ? 'video' : 'post';
  const itemId = permalink ? itemIdFromPermalink(permalink, config) : null;
  const key = permalink
    ? `${config.platform}:${permalink}`
    : source
      ? normalizeMediaUrl(source)
      : domPath(item);

  const candidate: MediaCandidate = {
    element: media,
    mediaType,
    key,
    text: textOf(...queryAll(item, config.caption).map((element) => element.textContent)),
  };

  if (source) {
    candidate.mediaUrl = normalizeMediaUrl(source);
    // Feed videos are streamed in fragments, so only images are worth a byte scan.
    if (media instanceof HTMLImageElement && /^https?:/i.test(source)) {
      candidate.provenanceUrl = source;
    }
  }
  if (media instanceof HTMLVideoElement) candidate.video = media;

  const label = findDisclosure(queryAll(item, config.badge), strings);
  if (label) candidate.platformLabel = { platform: config.platform, label };

  const creator = creatorOf(item, config);
  if (creator) candidate.creator = creator;
  if (itemId) candidate.itemRef = { platform: config.platform, id: itemId };

  return candidate;
}

function creatorOf(item: ParentNode, config: BadgeAdapterConfig): CreatorRef | undefined {
  for (const link of queryAll(item, config.authorLink)) {
    const href = link.getAttribute('href');
    if (!href) continue;
    const parsed = config.parseAuthorHref(href);
    if (!parsed || (!parsed.handle && !parsed.id)) continue;

    const creator: CreatorRef = { platform: config.platform };
    if (parsed.handle) creator.handle = parsed.handle;
    if (parsed.id) creator.id = parsed.id;
    const name = link.textContent?.trim();
    if (name) creator.name = name;
    return creator;
  }
  return undefined;
}
