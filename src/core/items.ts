// Matching and formatting for `ItemRef` — one specific video or post.
//
// Deliberately not merged with `creators.ts`. A creator is matched loosely (id
// *or* handle, case-insensitively, because platforms rename accounts), while an
// item is matched exactly: YouTube video ids are case-sensitive, and treating
// "dQw4w9WgXcQ" and "dqw4w9wgxcq" as the same id would block the wrong video.

import type { ItemRef } from '../types';

export function normalizeItem(item: ItemRef): ItemRef {
  const normalized: ItemRef = {
    platform: item.platform.trim().toLowerCase(),
    id: item.id.trim(),
  };
  if (item.title) normalized.title = item.title.trim().slice(0, 200);
  return normalized;
}

/** Stable key for de-duplication and storage. */
export function itemKey(item: ItemRef): string {
  const normalized = normalizeItem(item);
  return `${normalized.platform}:${normalized.id}`;
}

/** Round-trips with `parseItem`; also what the options page shows. */
export function formatItem(item: ItemRef): string {
  return itemKey(item);
}

/** Parses "youtube:dQw4w9WgXcQ" from the options page. */
export function parseItem(input: string): ItemRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const separator = trimmed.indexOf(':');
  if (separator <= 0) return null;

  const platform = trimmed.slice(0, separator).trim().toLowerCase();
  const id = trimmed.slice(separator + 1).trim();
  if (!platform || !id) return null;
  return { platform, id };
}

/** Same platform, same id. Ids are compared exactly; see the note above. */
export function itemMatches(a: ItemRef, b: ItemRef): boolean {
  const left = normalizeItem(a);
  const right = normalizeItem(b);
  return left.platform === right.platform && left.id === right.id;
}

export function inItemList(item: ItemRef, list: ItemRef[]): boolean {
  return list.some((entry) => itemMatches(item, entry));
}
