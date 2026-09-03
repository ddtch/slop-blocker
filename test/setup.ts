// Installs a minimal `chrome` global for every test.
//
// i18n is backed by the real _locales/en/messages.json, so assertions run
// against the strings users actually see and a missing message key fails a test
// instead of silently rendering a key name.

import { readRepoJson } from './helpers/paths';

interface RawMessage {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

const messages = readRepoJson<Record<string, RawMessage>>('_locales/en/messages.json');

export function getMessage(key: string, substitutions?: string | string[]): string {
  const entry = messages[key];
  if (!entry) return '';

  const values = Array.isArray(substitutions) ? substitutions : substitutions ? [substitutions] : [];
  let result = entry.message;

  for (const [name, definition] of Object.entries(entry.placeholders ?? {})) {
    // Placeholder content is "$1", "$2", ... pointing into the substitutions.
    const index = Number(definition.content.replace('$', '')) - 1;
    const value = values[index] ?? '';
    result = result.replace(new RegExp(`\\$${name}\\$`, 'gi'), value);
  }
  return result;
}

const chromeStub = {
  i18n: {
    getMessage,
    getUILanguage: () => 'en',
  },
  runtime: {
    id: 'slop-blocker-test',
    getURL: (path: string) => `chrome-extension://slop-blocker-test/${path}`,
    lastError: undefined,
    sendMessage: async () => undefined,
    onMessage: { addListener: () => undefined, removeListener: () => undefined },
    connect: () => ({
      name: 'stub',
      postMessage: () => undefined,
      onMessage: { addListener: () => undefined },
      onDisconnect: { addListener: () => undefined },
    }),
  },
};

Object.defineProperty(globalThis, 'chrome', {
  value: chromeStub,
  writable: true,
  configurable: true,
});
