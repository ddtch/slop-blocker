// Keeps the translations in step with each other.
//
// A missing key does not throw at runtime — chrome.i18n.getMessage returns an
// empty string and `t()` falls back to rendering the key name — so a forgotten
// translation ships as a button labelled "popupBlock" rather than as a crash.
// A dropped placeholder is worse: the button renders "Block " with a blank
// where the channel name should be.

import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { readRepoJson } from '../helpers/paths';

interface Message {
  message: string;
  description?: string;
  placeholders?: Record<string, { content: string }>;
}

type Catalogue = Record<string, Message>;

const REFERENCE = 'en';
const locales = readdirSync(new URL('../../_locales', import.meta.url)).sort();
const catalogue = (locale: string) => readRepoJson<Catalogue>(`_locales/${locale}/messages.json`);

const reference = catalogue(REFERENCE);
const translations = locales.filter((locale) => locale !== REFERENCE);

describe('locales', () => {
  it('ships the languages the extension claims to support', () => {
    expect(locales).toEqual(['en', 'es', 'ru']);
  });

  it('has a default locale that exists', () => {
    const manifest = readRepoJson<{ default_locale: string }>('src/manifest.json');
    expect(locales).toContain(manifest.default_locale);
    expect(manifest.default_locale).toBe(REFERENCE);
  });

  it.each(translations)('%s covers every key in en, and adds none', (locale) => {
    const keys = Object.keys(catalogue(locale)).sort();
    expect(keys).toEqual(Object.keys(reference).sort());
  });

  it.each(translations)('%s keeps every placeholder', (locale) => {
    const translated = catalogue(locale);

    for (const [key, source] of Object.entries(reference)) {
      const placeholders = Object.keys(source.placeholders ?? {});
      if (placeholders.length === 0) continue;

      const entry = translated[key];
      expect(Object.keys(entry?.placeholders ?? {}).sort(), `${locale}.${key} placeholders`).toEqual(
        placeholders.sort(),
      );
      for (const name of placeholders) {
        // The substitution is spliced in on "$NAME$"; without it the value is
        // silently dropped from the rendered string.
        expect(entry?.message.toLowerCase(), `${locale}.${key} uses $${name}$`).toContain(
          `$${name}$`.toLowerCase(),
        );
      }
    }
  });

  it.each(translations)('%s leaves no message empty', (locale) => {
    for (const [key, entry] of Object.entries(catalogue(locale))) {
      expect(entry.message.trim(), `${locale}.${key}`).not.toBe('');
    }
  });

  it.each(translations)('%s is actually translated, not copied from en', (locale) => {
    const translated = catalogue(locale);
    // Some strings are legitimately identical — the product name, "Audio".
    const identical = Object.keys(reference).filter(
      (key) => translated[key]?.message === reference[key]?.message,
    );
    expect(identical.length).toBeLessThan(Object.keys(reference).length / 4);
  });
});
