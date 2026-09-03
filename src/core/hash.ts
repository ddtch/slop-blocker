/** FNV-1a 32-bit, rendered base36. Used only for stable local ids, never security. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Page URL without hash or trailing slash noise, so ids survive in-page navigation. */
export function pageKey(href: string): string {
  try {
    const url = new URL(href);
    url.hash = '';
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Stable detection id. `elementKey` must identify the same media across
 * re-renders (a media URL, a video id, or a DOM path as last resort).
 */
export function detectionId(href: string, elementKey: string): string {
  return fnv1a(`${pageKey(href)}|${elementKey}`);
}

/**
 * Media URLs often carry cache-busting or size query parameters that change
 * between renders. Strip them so provenance results and reveals stay cached.
 */
export function normalizeMediaUrl(raw: string): string {
  try {
    const url = new URL(raw, typeof location !== 'undefined' ? location.href : undefined);
    url.hash = '';
    url.search = '';
    return url.toString();
  } catch {
    return raw;
  }
}
