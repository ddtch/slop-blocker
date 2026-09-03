// Instagram DOM knowledge. See NOTES.md before editing.

export const LAST_VERIFIED = '2026-09-03';
export const VERIFIED_AGAINST = 'written from public documentation; NOT yet confirmed on a live page';

export const ITEM = ['article', 'div[data-media-type]'];

export const MEDIA = ['video', 'img[srcset]', 'img[decoding]'];

/** Meta's "AI info" affordance in the post chrome. Never the caption. */
export const BADGE = [
  'a[href*="ai_info"]',
  '[aria-label*="AI info" i]',
  '[aria-label*="Made with AI" i]',
  '[aria-label*="AI-generated" i]',
];

export const AUTHOR_LINK = ['header a[href^="/"]', 'a[role="link"][href^="/"]'];

export const CAPTION = ['h1', 'div[data-testid="post-comment-root"]'];

export const PERMALINK = ['a[href*="/p/"]', 'a[href*="/reel/"]'];

/** URL path segments that are Instagram features, not usernames. */
const RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'stories',
  'direct',
  'accounts',
  'about',
  'legal',
  'privacy',
  'terms',
  'ai_info',
]);

export function parseAuthorHref(href: string): { handle?: string } | null {
  const path = href.replace(/^https?:\/\/[^/]+/, '');
  const match = /^\/([^/?#]+)\/?$/.exec(path);
  const handle = match?.[1];
  if (!handle || RESERVED.has(handle.toLowerCase())) return null;
  return { handle };
}
