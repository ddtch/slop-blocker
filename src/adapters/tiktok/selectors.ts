// TikTok DOM knowledge. See NOTES.md before editing.

export const LAST_VERIFIED = '2026-09-03';
export const VERIFIED_AGAINST = 'written from public documentation; NOT yet confirmed on a live page';

export const ITEM = [
  'div[data-e2e="recommend-list-item-container"]',
  'div[data-e2e="feed-video"]',
  'div[data-e2e="search_top-item"]',
  'article',
];

export const MEDIA = ['video', 'img[src*="tiktokcdn"]'];

/**
 * The AI-generated badge only. The caption is excluded on purpose — TikTok
 * captions frequently discuss AI without the post being AI-generated.
 */
export const BADGE = [
  '[data-e2e="video-ai-label"]',
  '[data-e2e="aigc-label"]',
  '[aria-label*="AI-generated" i]',
  '[aria-label*="AIGC" i]',
  '[class*="AIGCLabel"]',
  '[class*="AigcLabel"]',
];

export const AUTHOR_LINK = ['a[href^="/@"]', '[data-e2e="video-author-uniqueid"]'];

export const CAPTION = ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="search-card-desc"]'];

export const PERMALINK = ['a[href*="/video/"]'];

export function parseAuthorHref(href: string): { handle?: string } | null {
  const match = /^\/?@([^/?#]+)/.exec(href.replace(/^https?:\/\/[^/]+/, ''));
  return match?.[1] ? { handle: match[1] } : null;
}
