import { describe, expect, it } from 'vitest';

import {
  formatItem,
  inItemList,
  itemKey,
  itemMatches,
  normalizeItem,
  parseItem,
} from '../../src/core/items';
import type { ItemRef } from '../../src/types';

const item = (platform: string, id: string, title?: string): ItemRef =>
  title ? { platform, id, title } : { platform, id };

describe('normalizeItem', () => {
  it('lower-cases the platform but never the id', () => {
    const normalized = normalizeItem({ platform: '  YouTube ', id: ' dQw4w9WgXcQ ' });
    expect(normalized.platform).toBe('youtube');
    expect(normalized.id).toBe('dQw4w9WgXcQ');
  });

  it('caps a title so a pathological page cannot bloat storage', () => {
    const normalized = normalizeItem({ platform: 'youtube', id: 'a', title: 'x'.repeat(500) });
    expect(normalized.title).toHaveLength(200);
  });
});

describe('itemMatches', () => {
  it('matches the same video', () => {
    expect(itemMatches(item('youtube', 'abc123'), item('youtube', 'abc123'))).toBe(true);
  });

  it('does not match across platforms', () => {
    expect(itemMatches(item('youtube', 'abc123'), item('tiktok', 'abc123'))).toBe(false);
  });

  // The whole reason items are matched differently from creators: YouTube video
  // ids are case-sensitive, so folding case would block a different video.
  it('treats ids differing only in case as different items', () => {
    expect(itemMatches(item('youtube', 'dQw4w9WgXcQ'), item('youtube', 'dqw4w9wgxcq'))).toBe(false);
  });

  it('ignores the title, which is display-only', () => {
    expect(itemMatches(item('youtube', 'a', 'One'), item('youtube', 'a', 'Two'))).toBe(true);
  });
});

describe('inItemList', () => {
  it('finds a blocked item and misses an unrelated one', () => {
    const list = [item('youtube', 'abc'), item('tiktok', 'user/video/9')];
    expect(inItemList(item('youtube', 'abc'), list)).toBe(true);
    expect(inItemList(item('youtube', 'xyz'), list)).toBe(false);
  });
});

describe('formatItem / parseItem', () => {
  it('round-trips', () => {
    const parsed = parseItem(formatItem(item('youtube', 'dQw4w9WgXcQ')));
    expect(parsed).toEqual({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
  });

  it('keeps colons inside an id, which X and TikTok paths can contain', () => {
    expect(parseItem('x:user/status/123')).toEqual({ platform: 'x', id: 'user/status/123' });
  });

  it('rejects input without a platform or without an id', () => {
    expect(parseItem('youtube:')).toBeNull();
    expect(parseItem(':abc')).toBeNull();
    expect(parseItem('nocolon')).toBeNull();
    expect(parseItem('   ')).toBeNull();
  });
});

describe('itemKey', () => {
  it('is stable across equivalent refs', () => {
    expect(itemKey({ platform: 'YouTube', id: 'abc', title: 'x' })).toBe(itemKey(item('youtube', 'abc')));
  });
});
