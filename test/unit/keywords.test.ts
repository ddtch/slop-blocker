
import { describe, expect, it } from 'vitest';

import { readRepoJson } from '../helpers/paths';
import { keywordConfidence, scoreKeywords } from '../../src/core/keywords';
import type { KeywordLists } from '../../src/types';

/** The shipped list, so these tests fail if a term is re-tiered by accident. */
const lists: KeywordLists = readRepoJson<KeywordLists>('lists/keywords.json');

function confidenceOf(text: string) {
  return keywordConfidence(scoreKeywords(text, lists).hits);
}

describe('keyword scoring', () => {
  it('blocks on a single self-tagging hashtag', () => {
    expect(confidenceOf('sunset over the mountains #aiart #wallpaper')).toBe('likely');
  });

  it('blocks on a single disclosure-shaped phrase', () => {
    expect(confidenceOf('This short was generated with AI.')).toBe('likely');
  });

  it('blocks on a Russian disclosure phrase', () => {
    expect(confidenceOf('Видео сгенерировано нейросетью, приятного просмотра')).toBe('likely');
  });

  it('treats one ambiguous phrase as suspected only', () => {
    expect(confidenceOf('AI-generated slop is ruining YouTube')).toBe('suspected');
  });

  it('promotes two independent ambiguous phrases to likely', () => {
    expect(confidenceOf('AI-generated synthetic media, made this morning')).toBe('likely');
  });

  it('returns null for unrelated text', () => {
    expect(confidenceOf('My trip to Georgia, day three: the mountains')).toBeNull();
  });

  it('respects word boundaries', () => {
    // "sora" is a weak term; "Sorabji" and "personality" must not match it.
    expect(confidenceOf('Kaikhosru Sorabji plays')).toBeNull();
    expect(confidenceOf('a study in personality')).toBeNull();
  });

  it('does not match a hashtag term inside a longer hashtag', () => {
    expect(confidenceOf('#aiartifacts')).toBeNull();
  });

  it('matches Cyrillic terms on word boundaries, not inside words', () => {
    expect(confidenceOf('обсуждаем нейросеть в целом')).toBe('suspected');
    expect(confidenceOf('нейросетьюжная станция')).toBeNull();
  });

  it('counts each term once', () => {
    const { hits } = scoreKeywords('#aiart #aiart #aiart', lists);
    expect(hits.filter((hit) => hit.term === '#aiart')).toHaveLength(1);
  });

  it('reports which terms matched, for the reason line', () => {
    const { hits } = scoreKeywords('made with ai, see #midjourney', lists);
    expect(hits.map((hit) => hit.term).sort()).toEqual(['#midjourney', 'made with ai']);
  });
});
