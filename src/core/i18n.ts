/**
 * Thin wrapper over chrome.i18n so the same call works in content scripts, the
 * popup, the service worker, and unit tests (where tests install a fake
 * chrome.i18n backed by _locales/en/messages.json).
 */
export function t(key: string, substitutions?: string[]): string {
  const api = (globalThis as { chrome?: typeof chrome }).chrome?.i18n;
  if (!api) return substitutions?.length ? `${key}: ${substitutions.join(', ')}` : key;
  return api.getMessage(key, substitutions) || key;
}

/** Localised label for a confidence tier. */
export function confidenceLabel(confidence: 'confirmed' | 'likely' | 'suspected'): string {
  const keys = {
    confirmed: 'confidenceConfirmed',
    likely: 'confidenceLikely',
    suspected: 'confidenceSuspected',
  } as const;
  return t(keys[confidence]);
}

/** Localised label for a media type. */
export function mediaTypeLabel(mediaType: string): string {
  const key = `mediaType${mediaType.charAt(0).toUpperCase()}${mediaType.slice(1)}`;
  return t(key);
}
