
import { describe, expect, it } from 'vitest';

import { readRepoJson } from '../helpers/paths';
import { compileTrackerSet, matchTracker, resourceHostname } from '../../src/core/trackers';

const shipped = readRepoJson<{ domains: string[] }>('lists/trackers.json');

describe('tracker matching', () => {
  const set = compileTrackerSet(['doubleclick.net', 'google-analytics.com', 'mc.yandex.ru']);

  it('matches an exact hostname', () => {
    expect(matchTracker('doubleclick.net', set)).toBe('doubleclick.net');
  });

  it('matches subdomains', () => {
    expect(matchTracker('stats.g.doubleclick.net', set)).toBe('doubleclick.net');
  });

  it('matches a multi-label entry only at a label boundary', () => {
    expect(matchTracker('mc.yandex.ru', set)).toBe('mc.yandex.ru');
    expect(matchTracker('yandex.ru', set)).toBeNull();
    expect(matchTracker('notmc.yandex.ru', set)).toBeNull();
  });

  it('ignores unrelated hosts', () => {
    expect(matchTracker('example.com', set)).toBeNull();
  });

  it('never matches a bare TLD', () => {
    expect(matchTracker('anything.net', compileTrackerSet(['net']))).toBeNull();
  });

  it('handles a trailing dot and casing', () => {
    expect(matchTracker('Stats.DoubleClick.net.', set)).toBe('doubleclick.net');
  });

  it('returns null against an empty set', () => {
    expect(matchTracker('doubleclick.net', compileTrackerSet([]))).toBeNull();
  });
});

describe('resourceHostname', () => {
  it('extracts the hostname from http(s) URLs', () => {
    expect(resourceHostname('https://cdn.example.com/a.js?x=1')).toBe('cdn.example.com');
  });

  it('ignores non-http schemes', () => {
    expect(resourceHostname('data:image/png;base64,AAAA')).toBeNull();
    expect(resourceHostname('blob:https://example.com/uuid')).toBeNull();
    expect(resourceHostname('not a url')).toBeNull();
  });
});

describe('shipped tracker list', () => {
  it('contains only bare hostnames', () => {
    // The matcher works on hostnames, so an entry with a path could never fire.
    const offenders = (shipped.domains as string[]).filter(
      (domain) => domain.includes('/') || domain.includes(':') || /\s/.test(domain),
    );
    expect(offenders).toEqual([]);
  });

  it('has no duplicates', () => {
    const domains = shipped.domains as string[];
    expect(new Set(domains).size).toBe(domains.length);
  });

  it('compiles and matches a well-known tracker', () => {
    const set = compileTrackerSet(shipped.domains);
    expect(matchTracker('www.google-analytics.com', set)).toBe('google-analytics.com');
  });
});
