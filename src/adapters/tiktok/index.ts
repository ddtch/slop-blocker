import { createBadgeAdapter } from '../badge-adapter';
import { AUTHOR_LINK, BADGE, CAPTION, ITEM, MEDIA, PERMALINK, parseAuthorHref } from './selectors';

/**
 * TikTok auto-labels AI content from C2PA Content Credentials, so its badge is
 * present even when the creator did not self-disclose — the most reliable
 * platform signal we have after YouTube's.
 */
export const tiktokAdapter = createBadgeAdapter({
  id: 'tiktok',
  platform: 'tiktok',
  hostPattern: /(^|\.)tiktok\.com$/i,
  item: ITEM,
  media: MEDIA,
  badge: BADGE,
  authorLink: AUTHOR_LINK,
  caption: CAPTION,
  permalink: PERMALINK,
  parseAuthorHref,
});
