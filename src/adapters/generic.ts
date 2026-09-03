// Fallback adapter for every site without a dedicated one.
//
// It has no platform disclosure to read, so it relies on provenance metadata
// (C2PA / IPTC), the keyword scorer, and the domain blocklist.

import { normalizeMediaUrl } from '../core/hash';
import type { PageContext } from '../types';
import { disambiguateKeys, domPath, textOf, type MediaCandidate, type SiteAdapter } from './types';

/** Below this rendered size an image is an icon, avatar or tracking pixel. */
const MIN_RENDERED_PX = 96;

/** Extensions whose bytes we can usefully scan for provenance metadata. */
const SCANNABLE = /\.(jpe?g|png|webp|avif|gif|mp4|m4v|mov)(\?|#|$)/i;

function isScannable(url: string): boolean {
  if (/^data:/i.test(url)) return true;
  if (!/^https?:/i.test(url)) return false;
  // Streaming manifests and blob URLs have no file-level metadata to read.
  if (/\.(m3u8|mpd)(\?|#|$)/i.test(url)) return false;
  return SCANNABLE.test(url);
}

function renderedSize(element: HTMLElement): { width: number; height: number } {
  const rect = element.getBoundingClientRect();
  if (rect.width || rect.height) return { width: rect.width, height: rect.height };
  // Not laid out yet (lazy images): fall back to intrinsic size.
  if (element instanceof HTMLImageElement) {
    return { width: element.naturalWidth, height: element.naturalHeight };
  }
  return { width: 0, height: 0 };
}

function nearbyText(element: HTMLElement): string {
  const figure = element.closest('figure');
  const figcaption = figure?.querySelector('figcaption')?.textContent;
  return textOf(
    element.getAttribute('alt'),
    element.getAttribute('title'),
    element.getAttribute('aria-label'),
    figcaption,
  );
}

function imageCandidate(image: HTMLImageElement): MediaCandidate | null {
  const source = image.currentSrc || image.src;
  if (!source) return null;

  const { width, height } = renderedSize(image);
  if (width < MIN_RENDERED_PX || height < MIN_RENDERED_PX) return null;

  const mediaUrl = normalizeMediaUrl(source);
  const candidate: MediaCandidate = {
    element: image,
    mediaType: 'image',
    key: mediaUrl || domPath(image),
    mediaUrl,
    text: nearbyText(image),
  };
  if (isScannable(source)) candidate.provenanceUrl = source;
  return candidate;
}

function videoCandidate(video: HTMLVideoElement): MediaCandidate | null {
  const source = video.currentSrc || video.src || video.querySelector('source')?.src || '';
  const { width, height } = renderedSize(video);
  if (width < MIN_RENDERED_PX || height < MIN_RENDERED_PX) return null;

  const mediaUrl = source ? normalizeMediaUrl(source) : '';
  const candidate: MediaCandidate = {
    element: video,
    mediaType: 'video',
    key: mediaUrl || domPath(video),
    text: nearbyText(video),
    video,
  };
  if (mediaUrl) candidate.mediaUrl = mediaUrl;
  if (source && isScannable(source)) candidate.provenanceUrl = source;
  return candidate;
}

export const genericAdapter: SiteAdapter = {
  id: 'generic',
  matches: () => true,

  candidates(root: ParentNode, _ctx: PageContext): MediaCandidate[] {
    const candidates: MediaCandidate[] = [];

    for (const image of root.querySelectorAll('img')) {
      const candidate = imageCandidate(image);
      if (candidate) candidates.push(candidate);
    }
    for (const video of root.querySelectorAll('video')) {
      const candidate = videoCandidate(video);
      if (candidate) candidates.push(candidate);
    }

    return disambiguateKeys(candidates);
  },
};
