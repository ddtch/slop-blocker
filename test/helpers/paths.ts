import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves a repo-relative path.
 *
 * Not `import.meta.url`: under the jsdom environment that resolves to an
 * http:// URL, which readFileSync rejects. Vitest always runs from the project
 * root, so cwd is the stable anchor.
 */
export function repoPath(relative: string): string {
  return path.join(process.cwd(), relative);
}

export function readRepoJson<T = Record<string, unknown>>(relative: string): T {
  return JSON.parse(readFileSync(repoPath(relative), 'utf8')) as T;
}

export function readRepoBytes(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(repoPath(relative)));
}
