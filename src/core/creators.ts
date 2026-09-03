import type { CreatorLists, CreatorRef } from '../types';

const PLATFORM_LIST_KEY: Record<string, keyof CreatorLists> = {
  youtube: 'youtubeChannels',
  tiktok: 'tiktokUsers',
  instagram: 'instagramUsers',
  facebook: 'instagramUsers',
  x: 'xUsers',
};

/** Handles are compared case-insensitively without a leading "@". */
export function normalizeHandle(handle: string | undefined): string | undefined {
  if (!handle) return undefined;
  const cleaned = handle.trim().replace(/^@+/, '').toLowerCase();
  return cleaned || undefined;
}

export function normalizeCreator(creator: CreatorRef): CreatorRef {
  const normalized: CreatorRef = { platform: creator.platform.trim().toLowerCase() };
  if (creator.id) normalized.id = creator.id.trim();
  const handle = normalizeHandle(creator.handle);
  if (handle) normalized.handle = handle;
  if (creator.name) normalized.name = creator.name.trim();
  return normalized;
}

/** Stable key for de-duplication and storage. */
export function creatorKey(creator: CreatorRef): string {
  const normalized = normalizeCreator(creator);
  return `${normalized.platform}:${normalized.id ?? normalized.handle ?? ''}`;
}

/** Round-trips with `parseCreator`; also what the options page shows. */
export function formatCreator(creator: CreatorRef): string {
  const normalized = normalizeCreator(creator);
  const identity = normalized.handle ? `@${normalized.handle}` : (normalized.id ?? '');
  return `${normalized.platform}:${identity}`;
}

/** Parses "youtube:@handle" or "youtube:UCxxxx" from the options page. */
export function parseCreator(input: string): CreatorRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(':');
  if (separator <= 0) return null;

  const platform = trimmed.slice(0, separator).trim().toLowerCase();
  const identity = trimmed.slice(separator + 1).trim();
  if (!platform || !identity) return null;

  // A leading "@" means a handle; anything else is treated as a platform id.
  return identity.startsWith('@')
    ? normalizeCreator({ platform, handle: identity })
    : normalizeCreator({ platform, id: identity });
}

/** Two refs match when the platform agrees and either the id or the handle does. */
export function creatorMatches(a: CreatorRef, b: CreatorRef): boolean {
  const left = normalizeCreator(a);
  const right = normalizeCreator(b);
  if (left.platform !== right.platform) return false;
  if (left.id && right.id && left.id === right.id) return true;
  if (left.handle && right.handle && left.handle === right.handle) return true;
  return false;
}

export function inCreatorList(creator: CreatorRef, list: CreatorRef[]): boolean {
  return list.some((entry) => creatorMatches(creator, entry));
}

/**
 * Matches against the bundled lists, whose entries are plain strings — either
 * "@handle" or a platform id.
 */
export function inBundledCreatorList(creator: CreatorRef, lists: CreatorLists): boolean {
  const normalized = normalizeCreator(creator);
  const key = PLATFORM_LIST_KEY[normalized.platform];
  if (!key) return false;
  const entries = lists[key];
  if (!entries?.length) return false;

  return entries.some((raw) => {
    const entry = raw.trim();
    if (!entry) return false;
    if (entry.startsWith('@')) return normalizeHandle(entry) === normalized.handle;
    if (normalized.id && entry.toLowerCase() === normalized.id.toLowerCase()) return true;
    // Tolerate list entries written without the "@" prefix.
    return normalizeHandle(entry) === normalized.handle;
  });
}

/** Returns the matching list entry, so callers can show which rule fired. */
export function matchDomain(hostname: string, domains: string[]): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  for (const raw of domains) {
    const domain = raw.trim().toLowerCase().replace(/^\*?\.?/, '');
    if (!domain) continue;
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}
