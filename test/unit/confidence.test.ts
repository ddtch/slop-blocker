import { describe, expect, it } from 'vitest';

import { highest, mergeSignals, rank, shouldBlock } from '../../src/core/confidence';
import type { PartialDetection } from '../../src/types';

const signal = (
  source: PartialDetection['source'],
  confidence: PartialDetection['confidence'],
  reason: string = source,
): PartialDetection => ({ source, confidence, reason });

describe('confidence ordering', () => {
  it('ranks tiers', () => {
    expect(rank('confirmed')).toBeGreaterThan(rank('likely'));
    expect(rank('likely')).toBeGreaterThan(rank('suspected'));
  });

  it('picks the higher of two tiers', () => {
    expect(highest('suspected', 'confirmed')).toBe('confirmed');
    expect(highest('likely', 'suspected')).toBe('likely');
  });
});

describe('shouldBlock', () => {
  it('blocks at or above the threshold', () => {
    expect(shouldBlock('confirmed', 'likely')).toBe(true);
    expect(shouldBlock('likely', 'likely')).toBe(true);
    expect(shouldBlock('suspected', 'likely')).toBe(false);
  });

  it('honours the strictest threshold', () => {
    expect(shouldBlock('likely', 'confirmed')).toBe(false);
    expect(shouldBlock('confirmed', 'confirmed')).toBe(true);
  });

  it('honours the loosest threshold', () => {
    expect(shouldBlock('suspected', 'suspected')).toBe(true);
  });
});

describe('mergeSignals', () => {
  it('returns null when nothing fired', () => {
    expect(mergeSignals([])).toBeNull();
  });

  it('takes the highest single confidence rather than stacking', () => {
    const merged = mergeSignals([
      signal('keyword', 'suspected'),
      signal('creator-list', 'suspected'),
    ]);
    // Two guesses are still a guess: this must not reach "likely".
    expect(merged?.confidence).toBe('suspected');
  });

  it('leads the reason with the strongest evidence', () => {
    const merged = mergeSignals([
      signal('keyword', 'suspected', 'weak evidence'),
      signal('platform-label', 'confirmed', 'platform said so'),
    ]);
    expect(merged?.reason.startsWith('platform said so')).toBe(true);
    expect(merged?.confidence).toBe('confirmed');
  });

  it('lists every source, strongest first, without duplicates', () => {
    const merged = mergeSignals([
      signal('keyword', 'suspected'),
      signal('c2pa', 'confirmed'),
      signal('keyword', 'suspected'),
    ]);
    expect(merged?.source).toEqual(['c2pa', 'keyword']);
  });

  it('de-duplicates identical reasons', () => {
    const merged = mergeSignals([
      signal('keyword', 'likely', 'same'),
      signal('creator-list', 'likely', 'same'),
    ]);
    expect(merged?.reason).toBe('same');
  });
});
