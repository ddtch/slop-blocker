import { genericAdapter } from './generic';
import { instagramAdapter } from './instagram';
import { tiktokAdapter } from './tiktok';
import { xAdapter } from './x';
import { youtubeAdapter } from './youtube';
import type { SiteAdapter } from './types';

const SITE_ADAPTERS: SiteAdapter[] = [youtubeAdapter, tiktokAdapter, instagramAdapter, xAdapter];

/**
 * Picks the one adapter that owns a page.
 *
 * A site adapter replaces the generic one rather than running alongside it: the
 * two would produce different keys for the same media (post container vs. bare
 * <img>), which means two shrouds over one item and double counting. Site
 * adapters also know which media are feed chrome and not worth scanning.
 */
export function pickAdapter(hostname: string): SiteAdapter {
  for (const adapter of SITE_ADAPTERS) {
    try {
      if (adapter.matches(hostname)) return adapter;
    } catch {
      // A broken matcher must not take the whole extension down.
    }
  }
  return genericAdapter;
}

export { genericAdapter, instagramAdapter, tiktokAdapter, xAdapter, youtubeAdapter };
export type { SiteAdapter };
