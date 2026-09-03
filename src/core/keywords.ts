import type { Confidence, KeywordLists } from '../types';

export type KeywordTier = 'disclosure' | 'ambiguous' | 'weak';

export interface KeywordHit {
  term: string;
  tier: KeywordTier;
}

export interface KeywordScore {
  hits: KeywordHit[];
}

/**
 * Word characters for boundary checks, including Cyrillic — JavaScript's `\b`
 * only understands ASCII word characters, so Russian terms need explicit
 * Unicode-aware lookarounds.
 */
const WORD = '[\\p{L}\\p{N}_]';

function escapeRegex(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cache = new Map<string, RegExp>();

function termRegex(term: string): RegExp {
  const cached = cache.get(term);
  if (cached) return cached;

  const isHashtag = term.startsWith('#');
  // A hashtag's own "#" must not count as a preceding word character.
  const before = isHashtag ? `(?<!${WORD})` : '(?<![\\p{L}\\p{N}_#])';
  const regex = new RegExp(`${before}${escapeRegex(term)}(?!${WORD})`, 'iu');
  cache.set(term, regex);
  return regex;
}

/** Finds AI markers in the text next to a media element. Each term counts once. */
export function scoreKeywords(text: string, lists: KeywordLists): KeywordScore {
  if (!text) return { hits: [] };

  const haystack = text.replace(/\s+/g, ' ');
  const hits: KeywordHit[] = [];

  const collect = (terms: string[] | undefined, tier: KeywordTier) => {
    for (const term of terms ?? []) {
      if (term && termRegex(term).test(haystack)) hits.push({ term, tier });
    }
  };

  collect(lists.disclosure, 'disclosure');
  collect(lists.ambiguous, 'ambiguous');
  collect(lists.weak, 'weak');
  return { hits };
}

/**
 * Confidence a set of keyword hits justifies.
 *
 * The asymmetry is deliberate. "Generated with AI" or "#aiart" only appear when
 * someone is labelling their own work, so one hit reaches a blocking tier. Bare
 * "AI-generated" appears just as often in a title complaining *about* AI slop,
 * so a single ambiguous hit stays at "suspected" and is not blocked by default —
 * two independent ambiguous phrases are treated as a disclosure said twice.
 */
export function keywordConfidence(hits: KeywordHit[]): Confidence | null {
  if (hits.length === 0) return null;

  const disclosure = hits.filter((hit) => hit.tier === 'disclosure').length;
  const ambiguous = hits.filter((hit) => hit.tier === 'ambiguous').length;

  if (disclosure >= 1 || ambiguous >= 2) return 'likely';
  return 'suspected';
}
