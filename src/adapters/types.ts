import type { CreatorRef, ItemRef, MediaType, PageContext, PageSubject } from '../types';

/** A platform's own AI disclosure, found on a specific media item. */
export interface PlatformLabel {
  /** Platform key used for reason text and disclosure lookups, e.g. "youtube". */
  platform: string;
  /** The disclosure text as rendered, shown to the user. */
  label: string;
}

/**
 * One unit of media the engine can block. Adapters do all site-specific DOM
 * work here so the engine stays platform-agnostic.
 */
export interface MediaCandidate {
  /** The media element itself; blurred as a fallback layer when blocked. */
  element: HTMLElement;
  mediaType: MediaType;
  /**
   * Identifies this media across re-renders within the page. A media URL or a
   * platform id is ideal; a DOM path is the last resort.
   */
  key: string;
  mediaUrl?: string;
  /** URL whose bytes are worth scanning for provenance metadata. */
  provenanceUrl?: string;
  /** Caption/title/alt text used for keyword scoring; capped by the adapter. */
  text: string;
  creator?: CreatorRef;
  /** The platform's identity for this exact video or post, when there is one. */
  itemRef?: ItemRef;
  platformLabel?: PlatformLabel;
  /** Video to pause when this candidate is blocked. */
  video?: HTMLVideoElement;
}

export interface SiteAdapter {
  id: string;
  matches(hostname: string): boolean;
  /** Platform key for disclosure-string lookups; undefined for the generic adapter. */
  platform?: string;
  candidates(root: ParentNode, ctx: PageContext): MediaCandidate[];
  /**
   * Who and what this page is about, independent of anything detected on it.
   *
   * The popup's quick actions need an author to block on a channel page where
   * nothing fired — that is the whole point of them — so this reads the URL and
   * the page chrome rather than the media. Returns null when the page is not
   * about one identifiable author or item (a feed, a search results page).
   */
  subject?(root: ParentNode, ctx: PageContext): PageSubject | null;
  /** Subscribe to in-page navigation; returns an unsubscribe function. */
  onNavigate?(callback: () => void): () => void;
  /** One-time setup, e.g. listening for main-world messages. */
  init?(ctx: PageContext, onSignal: () => void): void;
}

/** Shared helper: first matching element for a list of selectors. */
export function queryFirst(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const found = root.querySelector<HTMLElement>(selector);
      if (found) return found;
    } catch {
      // Invalid selector for this browser; skip it.
    }
  }
  return null;
}

/** Shared helper: all elements matching any of the selectors, de-duplicated. */
export function queryAll(root: ParentNode, selectors: string[]): HTMLElement[] {
  const results = new Set<HTMLElement>();
  for (const selector of selectors) {
    try {
      for (const element of root.querySelectorAll<HTMLElement>(selector)) results.add(element);
    } catch {
      // Invalid selector; skip it.
    }
  }
  return [...results];
}

const MAX_TEXT = 600;

/** Trimmed, collapsed, length-capped text for keyword scoring. */
export function textOf(...parts: Array<string | null | undefined>): string {
  return parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/**
 * Makes candidate keys unique within a page.
 *
 * Keys are usually a media URL, which is stable across re-renders — but the
 * same image can legitimately appear several times on one page (a thumbnail
 * reused in a list, a placeholder shared by several posts). Without this, those
 * copies collapse into a single detection, so only one of them gets covered.
 *
 * The first occurrence keeps the plain key so the common case stays stable;
 * later ones are qualified with their DOM path.
 */
export function disambiguateKeys(candidates: MediaCandidate[]): MediaCandidate[] {
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!seen.has(candidate.key)) {
      seen.add(candidate.key);
      continue;
    }
    candidate.key = `${candidate.key}|${domPath(candidate.element)}`;
  }
  return candidates;
}

/** A DOM path, used as a detection key when nothing more stable exists. */
export function domPath(element: Element): string {
  const segments: string[] = [];
  let node: Element | null = element;
  let depth = 0;
  while (node && depth++ < 12) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const index = [...parent.children].indexOf(node);
    segments.unshift(`${node.tagName.toLowerCase()}:${index}`);
    node = parent;
  }
  return segments.join('/');
}
