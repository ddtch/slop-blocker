import { describe, expect, it } from 'vitest';

import {
  creatorKey,
  creatorMatches,
  formatCreator,
  inBundledCreatorList,
  inCreatorList,
  matchDomain,
  normalizeHandle,
  parseCreator,
} from '../../src/core/creators';
import type { CreatorLists } from '../../src/types';

const emptyLists: CreatorLists = {
  youtubeChannels: [],
  tiktokUsers: [],
  instagramUsers: [],
  xUsers: [],
  domains: [],
};

describe('handle normalisation', () => {
  it('strips "@" and lowercases', () => {
    expect(normalizeHandle('@SlopChannel')).toBe('slopchannel');
    expect(normalizeHandle('  @@Weird  ')).toBe('weird');
  });

  it('treats blank handles as absent', () => {
    expect(normalizeHandle('  ')).toBeUndefined();
    expect(normalizeHandle(undefined)).toBeUndefined();
  });
});

describe('parse and format round-trip', () => {
  it('parses a handle', () => {
    expect(parseCreator('youtube:@Channel')).toEqual({ platform: 'youtube', handle: 'channel' });
  });

  it('parses a platform id', () => {
    expect(parseCreator('youtube:UC12345')).toEqual({ platform: 'youtube', id: 'UC12345' });
  });

  it('rejects malformed input', () => {
    expect(parseCreator('nonsense')).toBeNull();
    expect(parseCreator('youtube:')).toBeNull();
    expect(parseCreator(':@handle')).toBeNull();
    expect(parseCreator('')).toBeNull();
  });

  it('round-trips through formatCreator', () => {
    for (const input of ['youtube:@channel', 'tiktok:@user', 'youtube:UC12345']) {
      expect(formatCreator(parseCreator(input)!)).toBe(input);
    }
  });
});

describe('creator matching', () => {
  it('matches on id across differing handles', () => {
    expect(
      creatorMatches(
        { platform: 'youtube', id: 'UC1', handle: 'old' },
        { platform: 'youtube', id: 'UC1', handle: 'new' },
      ),
    ).toBe(true);
  });

  it('matches on handle when no id is known', () => {
    expect(
      creatorMatches({ platform: 'youtube', handle: 'Chan' }, { platform: 'youtube', handle: '@chan' }),
    ).toBe(true);
  });

  it('never matches across platforms', () => {
    expect(
      creatorMatches({ platform: 'youtube', handle: 'same' }, { platform: 'tiktok', handle: 'same' }),
    ).toBe(false);
  });

  it('does not match when nothing identifying is shared', () => {
    expect(
      creatorMatches({ platform: 'youtube', id: 'UC1' }, { platform: 'youtube', handle: 'chan' }),
    ).toBe(false);
  });

  it('keys the same creator identically regardless of casing', () => {
    expect(creatorKey({ platform: 'YouTube', handle: '@Chan' })).toBe(
      creatorKey({ platform: 'youtube', handle: 'chan' }),
    );
  });

  it('finds a creator in a personal list', () => {
    const list = [{ platform: 'youtube', handle: 'blocked' }];
    expect(inCreatorList({ platform: 'youtube', handle: '@Blocked' }, list)).toBe(true);
    expect(inCreatorList({ platform: 'youtube', handle: 'other' }, list)).toBe(false);
  });
});

describe('bundled list matching', () => {
  it('matches handles with or without the "@" prefix in the list', () => {
    const lists: CreatorLists = { ...emptyLists, youtubeChannels: ['@slop', 'bare'] };
    expect(inBundledCreatorList({ platform: 'youtube', handle: 'slop' }, lists)).toBe(true);
    expect(inBundledCreatorList({ platform: 'youtube', handle: 'bare' }, lists)).toBe(true);
  });

  it('matches channel ids', () => {
    const lists: CreatorLists = { ...emptyLists, youtubeChannels: ['UC000'] };
    expect(inBundledCreatorList({ platform: 'youtube', id: 'UC000' }, lists)).toBe(true);
  });

  it('returns false for platforms with no list', () => {
    expect(inBundledCreatorList({ platform: 'vimeo', handle: 'a' }, emptyLists)).toBe(false);
  });

  it('returns false for an empty shipped list', () => {
    expect(inBundledCreatorList({ platform: 'youtube', handle: 'anyone' }, emptyLists)).toBe(false);
  });
});

describe('domain matching', () => {
  it('matches the domain itself and its subdomains', () => {
    expect(matchDomain('slop.example', ['slop.example'])).toBe('slop.example');
    expect(matchDomain('cdn.slop.example', ['slop.example'])).toBe('slop.example');
  });

  it('does not match a suffix that is not a label boundary', () => {
    expect(matchDomain('notslop.example', ['slop.example'])).toBeNull();
  });

  it('tolerates leading dots and wildcards in list entries', () => {
    expect(matchDomain('a.slop.example', ['*.slop.example'])).toBe('slop.example');
  });

  it('returns null for an empty hostname or list', () => {
    expect(matchDomain('', ['slop.example'])).toBeNull();
    expect(matchDomain('slop.example', [])).toBeNull();
  });
});
