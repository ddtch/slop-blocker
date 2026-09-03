import { DEFAULT_SETTINGS, EMPTY_PERSONAL_LISTS, type BundledLists, type PageContext } from '../../src/types';
import { readRepoJson } from './paths';

function readList(name: string): Record<string, unknown> {
  return readRepoJson(`lists/${name}`);
}

/** The lists exactly as shipped, so tests exercise the real data. */
export function bundledLists(): BundledLists {
  const keywords = readList('keywords.json');
  const creators = readList('creators.json');
  const disclosure = readList('disclosure-strings.json');

  const byPlatform: BundledLists['disclosure'] = {};
  for (const [platform, locales] of Object.entries(disclosure)) {
    if (platform.startsWith('_') || !locales || typeof locales !== 'object') continue;
    byPlatform[platform] = locales as Record<string, string[]>;
  }

  return {
    keywords: {
      disclosure: keywords.disclosure as string[],
      ambiguous: keywords.ambiguous as string[],
      weak: keywords.weak as string[],
    },
    creators: {
      youtubeChannels: creators.youtubeChannels as string[],
      tiktokUsers: creators.tiktokUsers as string[],
      instagramUsers: creators.instagramUsers as string[],
      xUsers: creators.xUsers as string[],
      domains: creators.domains as string[],
    },
    disclosure: byPlatform,
  };
}

export function makeContext(overrides: Partial<PageContext> = {}): PageContext {
  return {
    href: 'https://www.youtube.com/watch?v=abc123',
    hostname: 'www.youtube.com',
    locale: 'en',
    settings: { ...DEFAULT_SETTINGS },
    personalLists: {
      blockCreators: [...EMPTY_PERSONAL_LISTS.blockCreators],
      trustCreators: [...EMPTY_PERSONAL_LISTS.trustCreators],
      blockDomains: [...EMPTY_PERSONAL_LISTS.blockDomains],
      blockItems: [...EMPTY_PERSONAL_LISTS.blockItems],
    },
    lists: bundledLists(),
    ...overrides,
  };
}
