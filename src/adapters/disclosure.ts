// Matching of platform disclosure strings.
//
// Critical false-positive rule (SPEC.md §5.5): these strings are matched ONLY
// inside the disclosure containers a site adapter names — never against titles,
// captions, descriptions or article text. Otherwise a video *about* AI labelling
// would block itself.

import type { PageContext } from '../types';

/** Disclosure strings for a platform in the page's language, plus English. */
export function disclosureStrings(platform: string, ctx: PageContext): string[] {
  const byLocale = ctx.lists.disclosure[platform];
  if (!byLocale) return [];

  const language = ctx.locale.split('-')[0] ?? 'en';
  const strings = new Set<string>();
  for (const key of [ctx.locale, language, 'en']) {
    for (const value of byLocale[key] ?? []) strings.add(value);
  }
  return [...strings];
}

/** True when we have strings for the page's own language, not just English. */
export function localeSupported(platform: string, ctx: PageContext): boolean {
  const byLocale = ctx.lists.disclosure[platform];
  if (!byLocale) return false;
  const language = ctx.locale.split('-')[0] ?? 'en';
  return Boolean(byLocale[ctx.locale]?.length || byLocale[language]?.length);
}

const MAX_CONTAINER_TEXT = 2000;

/** Container text plus the aria-labels inside it, which often hold the label. */
function containerText(container: Element): string {
  const parts: string[] = [container.textContent ?? ''];
  for (const labelled of container.querySelectorAll('[aria-label]')) {
    const label = labelled.getAttribute('aria-label');
    if (label) parts.push(label);
  }
  const own = container.getAttribute?.('aria-label');
  if (own) parts.push(own);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, MAX_CONTAINER_TEXT);
}

/**
 * Looks for any disclosure string inside the given containers.
 * @returns the matched string as listed (for display), or null.
 */
export function findDisclosure(containers: Element[], strings: string[]): string | null {
  if (containers.length === 0 || strings.length === 0) return null;

  const lowered = strings.map((value) => [value, value.toLowerCase()] as const);
  for (const container of containers) {
    const haystack = containerText(container).toLowerCase();
    if (!haystack) continue;
    for (const [original, needle] of lowered) {
      if (needle && haystack.includes(needle)) return original;
    }
  }
  return null;
}
