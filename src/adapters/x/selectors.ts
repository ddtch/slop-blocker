// X (Twitter) DOM knowledge. See NOTES.md before editing.

export const LAST_VERIFIED = '2026-09-03';
export const VERIFIED_AGAINST = 'written from public documentation; NOT yet confirmed on a live page';

export const ITEM = ['article[data-testid="tweet"]', 'article[role="article"]'];

export const MEDIA = ['video', 'img[src*="/media/"]', 'div[data-testid="tweetPhoto"] img'];

/**
 * X has no consistent platform AI label, so there is nothing to match here.
 * Detection on this site comes from provenance metadata on images, the creator
 * list, and keyword scoring. Left in place so a future label has a home.
 */
export const BADGE: string[] = [];

export const AUTHOR_LINK = ['div[data-testid="User-Name"] a[href^="/"]', 'a[role="link"][href^="/"]'];

export const CAPTION = ['div[data-testid="tweetText"]'];

export const PERMALINK = ['a[href*="/status/"]'];

/** URL path segments that are X features, not usernames. */
const RESERVED = new Set([
  'i',
  'home',
  'explore',
  'notifications',
  'messages',
  'search',
  'settings',
  'compose',
  'hashtag',
  'about',
  'tos',
  'privacy',
]);

export function parseAuthorHref(href: string): { handle?: string } | null {
  const path = href.replace(/^https?:\/\/[^/]+/, '');
  const match = /^\/([^/?#]+)/.exec(path);
  const handle = match?.[1];
  if (!handle || RESERVED.has(handle.toLowerCase())) return null;
  return { handle };
}

/**
 * The author and item an X URL is about: "/user" is a profile,
 * "/user/status/123" is one post.
 */
export function parseSubjectPath(pathname: string): {
  handle?: string;
  itemId?: string;
} | null {
  const match = /^\/([^/?#]+)(?:\/status\/([^/?#]+))?/.exec(pathname);
  const handle = match?.[1];
  if (!handle || RESERVED.has(handle.toLowerCase())) return null;
  const subject: { handle?: string; itemId?: string } = { handle };
  if (match?.[2]) subject.itemId = `${handle}/status/${match[2]}`;
  return subject;
}
