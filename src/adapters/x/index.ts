import { createBadgeAdapter } from '../badge-adapter';
import { AUTHOR_LINK, BADGE, CAPTION, ITEM, MEDIA, PERMALINK, parseAuthorHref, parseSubjectPath } from './selectors';

/**
 * X (Twitter), best-effort. There is no platform AI label to read, so this
 * adapter exists to give posts an identity: it attaches the author to each
 * media item so the creator list and keyword scoring work per post, and points
 * image URLs at the provenance scanner.
 */
export const xAdapter = createBadgeAdapter({
  id: 'x',
  platform: 'x',
  hostPattern: /(^|\.)(x\.com|twitter\.com)$/i,
  item: ITEM,
  media: MEDIA,
  badge: BADGE,
  authorLink: AUTHOR_LINK,
  caption: CAPTION,
  permalink: PERMALINK,
  parseAuthorHref,
  parseSubjectPath,
});
