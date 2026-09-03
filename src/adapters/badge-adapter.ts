// Factory for adapters on platforms whose only AI signal is a rendered badge
// next to a feed item (TikTok, Instagram/Facebook), plus post-level identity so
// the creator list and keyword scoring can work per post rather than per image.

import { normalizeMediaUrl } from '../core/hash';
import type { CreatorRef, MediaType, PageContext } from '../types';
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
      const candidates: MediaCandidate[] = [];

      for (const item of queryAll(root, config.item)) {
        const media = pickMedia(item, config.media);
        if (!media) continue;

        const source = mediaSource(media);
        const permalink = config.permalink
          ? queryFirst(item, config.permalink)?.getAttribute('href')
          : null;

        const mediaType: MediaType = media instanceof HTMLVideoElement ? 'video' : 'post';
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

        candidates.push(candidate);
      }

      return disambiguateKeys(candidates);
    },
  };

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
