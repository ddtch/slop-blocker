// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { disclosureStrings, findDisclosure, localeSupported } from '../../src/adapters/disclosure';
import { makeContext } from '../helpers/context';

function html(markup: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = markup;
  return host;
}

describe('disclosureStrings', () => {
  it('returns the page language plus English as a fallback', () => {
    const strings = disclosureStrings('youtube', makeContext({ locale: 'ru-ru' }));
    expect(strings).toContain('Изменённый или синтетический контент');
    expect(strings).toContain('Altered or synthetic content');
  });

  it('falls back to English for an uncovered language', () => {
    const strings = disclosureStrings('youtube', makeContext({ locale: 'ja' }));
    expect(strings).toContain('Altered or synthetic content');
  });

  it('returns nothing for an unknown platform', () => {
    expect(disclosureStrings('vimeo', makeContext())).toEqual([]);
  });
});

describe('localeSupported', () => {
  it('is true for a covered language', () => {
    expect(localeSupported('youtube', makeContext({ locale: 'ru' }))).toBe(true);
    expect(localeSupported('youtube', makeContext({ locale: 'en-gb' }))).toBe(true);
  });

  it('is false for an uncovered language, so the popup can warn', () => {
    expect(localeSupported('youtube', makeContext({ locale: 'ja' }))).toBe(false);
  });
});

describe('findDisclosure', () => {
  const strings = ['Altered or synthetic content', 'synthetic content'];

  it('finds the label in a container', () => {
    const container = html('<div class="row">Altered or synthetic content</div>');
    expect(findDisclosure([container], strings)).toBe('Altered or synthetic content');
  });

  it('matches case-insensitively', () => {
    const container = html('<div>ALTERED OR SYNTHETIC CONTENT</div>');
    expect(findDisclosure([container], strings)).toBe('Altered or synthetic content');
  });

  it('reads aria-labels inside the container', () => {
    const container = html('<button aria-label="Altered or synthetic content"></button>');
    expect(findDisclosure([container], strings)).toBe('Altered or synthetic content');
  });

  it('returns null when no container is given', () => {
    expect(findDisclosure([], strings)).toBeNull();
  });

  it('returns null when the string list is empty', () => {
    expect(findDisclosure([html('<div>Altered or synthetic content</div>')], [])).toBeNull();
  });

  // This is the guard that keeps a video *about* AI labelling from blocking
  // itself: the disclosure text exists on the page, but not in a disclosure
  // container, and only containers are ever searched.
  it('ignores the same words when they appear outside a disclosure container', () => {
    const page = html(`
      <h1>Why "Altered or synthetic content" labels do not work</h1>
      <div id="description">This video explains synthetic content labelling.</div>
      <div class="disclosure-row">Captured with a camera</div>
    `);
    const containers = [...page.querySelectorAll<HTMLElement>('.disclosure-row')];
    expect(findDisclosure(containers, strings)).toBeNull();
  });
});
