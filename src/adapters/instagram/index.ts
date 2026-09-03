import { createBadgeAdapter } from '../badge-adapter';
import { AUTHOR_LINK, BADGE, CAPTION, ITEM, MEDIA, PERMALINK, parseAuthorHref } from './selectors';

/**
 * Instagram. Meta detects C2PA Content Credentials embedded by Firefly,
 * Photoshop generative fill, DALL·E and Canva, and renders an "AI info" tag —
 * so the badge appears without creator self-disclosure.
 *
 * Facebook shares the label but not the markup, and is not covered here; see
 * NOTES.md.
 */
export const instagramAdapter = createBadgeAdapter({
  id: 'instagram',
  platform: 'instagram',
  hostPattern: /(^|\.)instagram\.com$/i,
  item: ITEM,
  media: MEDIA,
  badge: BADGE,
  authorLink: AUTHOR_LINK,
  caption: CAPTION,
  permalink: PERMALINK,
  parseAuthorHref,
});
