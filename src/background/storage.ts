// Persistence for settings, personal lists, counters, and the bundled JSON lists.
//
// Lifetime counters live in chrome.storage.local; the session counter lives in
// chrome.storage.session so it resets when the browser restarts. Only the
// service worker touches storage — content scripts ask over messaging, because
// storage.session is not readable from content scripts by default.

import {
  DEFAULT_SETTINGS,
  EMPTY_COUNTERS,
  EMPTY_PERSONAL_LISTS,
  type BundledLists,
  type Counters,
  type CreatorLists,
  type DisclosureStrings,
  type ItemRef,
  type KeywordLists,
  type MediaType,
  type PersonalLists,
  type Settings,
} from '../types';
import { creatorKey, normalizeCreator } from '../core/creators';
import { itemKey, normalizeItem } from '../core/items';

const KEY_SETTINGS = 'settings';
const KEY_PERSONAL_LISTS = 'personalLists';
const KEY_COUNTERS = 'counters';
const KEY_SESSION_BLOCKED = 'sessionBlocked';

/**
 * Serialises read-modify-write cycles. The worker is single-threaded but `await`
 * interleaves, so two concurrent counter bumps could otherwise clobber each other.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  // Keep the chain alive even if a task rejects.
  writeChain = next.catch(() => undefined);
  return next;
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(KEY_SETTINGS);
  const raw = (stored[KEY_SETTINGS] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    // Remote list updates are not implemented yet; never let a stale value enable them.
    listUpdates: false,
    disabledSites: Array.isArray(raw.disabledSites) ? raw.disabledSites : [],
  };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  return serialize(async () => {
    const current = await getSettings();
    const next: Settings = { ...current, ...patch };
    next.wholePageThreshold = Math.max(1, Math.min(100, Math.round(next.wholePageThreshold)));
    next.disabledSites = [...new Set(next.disabledSites.map((host) => host.trim().toLowerCase()).filter(Boolean))];
    await chrome.storage.local.set({ [KEY_SETTINGS]: next });
    return next;
  });
}

export async function getPersonalLists(): Promise<PersonalLists> {
  const stored = await chrome.storage.local.get(KEY_PERSONAL_LISTS);
  const raw = (stored[KEY_PERSONAL_LISTS] ?? {}) as Partial<PersonalLists>;
  return {
    blockCreators: Array.isArray(raw.blockCreators) ? raw.blockCreators.map(normalizeCreator) : [],
    trustCreators: Array.isArray(raw.trustCreators) ? raw.trustCreators.map(normalizeCreator) : [],
    blockDomains: Array.isArray(raw.blockDomains) ? raw.blockDomains : [],
    blockItems: Array.isArray(raw.blockItems) ? raw.blockItems.map(normalizeItem) : [],
  };
}

/** Normalises and persists. Callers must hold the write chain; see `serialize`. */
async function writeLists(lists: PersonalLists): Promise<PersonalLists> {
  const deduped: PersonalLists = {
    blockCreators: dedupeCreators(lists.blockCreators ?? []),
    trustCreators: dedupeCreators(lists.trustCreators ?? []),
    blockDomains: [
      ...new Set((lists.blockDomains ?? []).map((domain) => domain.trim().toLowerCase()).filter(Boolean)),
    ],
    blockItems: dedupeItems(lists.blockItems ?? []),
  };
  await chrome.storage.local.set({ [KEY_PERSONAL_LISTS]: deduped });
  return deduped;
}

export async function setPersonalLists(lists: PersonalLists): Promise<PersonalLists> {
  return serialize(() => writeLists(lists));
}

/**
 * Reads, mutates and writes the lists inside a single turn of the write chain.
 *
 * The read has to be in here with the write. The popup offers two quick-action
 * buttons side by side, so blocking a channel and blocking its video land as
 * two messages a few milliseconds apart; with the read outside the chain both
 * would start from the same snapshot and the second write would silently
 * discard the first.
 */
async function updateLists(
  mutate: (lists: PersonalLists) => PersonalLists,
): Promise<PersonalLists> {
  return serialize(async () => writeLists(mutate(await getPersonalLists())));
}

function dedupeCreators(creators: PersonalLists['blockCreators']): PersonalLists['blockCreators'] {
  const seen = new Map<string, PersonalLists['blockCreators'][number]>();
  for (const creator of creators) {
    const normalized = normalizeCreator(creator);
    if (!normalized.id && !normalized.handle) continue;
    seen.set(creatorKey(normalized), normalized);
  }
  return [...seen.values()];
}

function dedupeItems(items: ItemRef[]): ItemRef[] {
  const seen = new Map<string, ItemRef>();
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (!normalized.platform || !normalized.id) continue;
    seen.set(itemKey(normalized), normalized);
  }
  return [...seen.values()];
}

/**
 * Moves a creator between the block and trust lists.
 *
 * `none` removes them from both, which is what the popup's toggle needs: a
 * quick action a user cannot undo from the same button is a trap.
 */
export async function markCreator(
  creator: PersonalLists['blockCreators'][number],
  verdict: 'block' | 'trust' | 'none',
): Promise<PersonalLists> {
  const normalized = normalizeCreator(creator);
  const key = creatorKey(normalized);

  return updateLists((lists) => {
    const without = (entries: PersonalLists['blockCreators']) =>
      entries.filter((entry) => creatorKey(entry) !== key);

    const blockCreators = without(lists.blockCreators);
    const trustCreators = without(lists.trustCreators);
    if (verdict === 'block') blockCreators.push(normalized);
    if (verdict === 'trust') trustCreators.push(normalized);

    return { ...lists, blockCreators, trustCreators };
  });
}

/** Adds or removes one video/post from the personal block list. */
export async function markItem(item: ItemRef, verdict: 'block' | 'none'): Promise<PersonalLists> {
  const normalized = normalizeItem(item);
  const key = itemKey(normalized);

  return updateLists((lists) => {
    const blockItems = lists.blockItems.filter((entry) => itemKey(entry) !== key);
    if (verdict === 'block') blockItems.push(normalized);
    return { ...lists, blockItems };
  });
}

export async function getCounters(): Promise<Counters> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(KEY_COUNTERS),
    chrome.storage.session.get(KEY_SESSION_BLOCKED),
  ]);
  const raw = (local[KEY_COUNTERS] ?? {}) as Partial<Counters>;
  return {
    ...EMPTY_COUNTERS,
    ...raw,
    lifetimeByType: { ...EMPTY_COUNTERS.lifetimeByType, ...(raw.lifetimeByType ?? {}) },
    sessionBlocked: Number(session[KEY_SESSION_BLOCKED] ?? 0),
  };
}

export interface CounterDelta {
  blockedByType?: Partial<Record<MediaType, number>>;
  trackers?: number;
}

export async function bumpCounters(delta: CounterDelta): Promise<Counters> {
  return serialize(async () => {
    const current = await getCounters();
    const byType = { ...current.lifetimeByType };
    let blocked = 0;
    for (const [type, count] of Object.entries(delta.blockedByType ?? {})) {
      if (!count) continue;
      byType[type as MediaType] = (byType[type as MediaType] ?? 0) + count;
      blocked += count;
    }

    const next: Counters = {
      lifetimeBlocked: current.lifetimeBlocked + blocked,
      lifetimeByType: byType,
      lifetimeTrackers: current.lifetimeTrackers + (delta.trackers ?? 0),
      sessionBlocked: current.sessionBlocked + blocked,
    };

    await Promise.all([
      chrome.storage.local.set({
        [KEY_COUNTERS]: {
          lifetimeBlocked: next.lifetimeBlocked,
          lifetimeByType: next.lifetimeByType,
          lifetimeTrackers: next.lifetimeTrackers,
        },
      }),
      chrome.storage.session.set({ [KEY_SESSION_BLOCKED]: next.sessionBlocked }),
    ]);
    return next;
  });
}

export async function resetCounters(): Promise<Counters> {
  return serialize(async () => {
    await Promise.all([
      chrome.storage.local.set({
        [KEY_COUNTERS]: {
          lifetimeBlocked: 0,
          lifetimeByType: { ...EMPTY_COUNTERS.lifetimeByType },
          lifetimeTrackers: 0,
        },
      }),
      chrome.storage.session.set({ [KEY_SESSION_BLOCKED]: 0 }),
    ]);
    return { ...EMPTY_COUNTERS };
  });
}

// ---------------------------------------------------------------------------
// Bundled lists
// ---------------------------------------------------------------------------

let bundledCache: BundledLists | null = null;

async function loadJson(path: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(chrome.runtime.getURL(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  } catch (error) {
    console.warn(`[slop-blocker] could not load ${path}:`, error);
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Keys prefixed with "_" are documentation, not data. */
function stripMeta<T extends Record<string, unknown>>(source: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !key.startsWith('_')));
}

export async function loadBundledLists(): Promise<BundledLists> {
  if (bundledCache) return bundledCache;

  const [keywordsRaw, creatorsRaw, disclosureRaw] = await Promise.all([
    loadJson('lists/keywords.json'),
    loadJson('lists/creators.json'),
    loadJson('lists/disclosure-strings.json'),
  ]);

  const keywords: KeywordLists = {
    disclosure: stringArray(keywordsRaw.disclosure),
    ambiguous: stringArray(keywordsRaw.ambiguous),
    weak: stringArray(keywordsRaw.weak),
  };

  const creators: CreatorLists = {
    youtubeChannels: stringArray(creatorsRaw.youtubeChannels),
    tiktokUsers: stringArray(creatorsRaw.tiktokUsers),
    instagramUsers: stringArray(creatorsRaw.instagramUsers),
    xUsers: stringArray(creatorsRaw.xUsers),
    domains: stringArray(creatorsRaw.domains),
  };

  const disclosure: DisclosureStrings = {};
  for (const [platform, locales] of Object.entries(stripMeta(disclosureRaw))) {
    if (!locales || typeof locales !== 'object') continue;
    const byLocale: Record<string, string[]> = {};
    for (const [locale, strings] of Object.entries(locales as Record<string, unknown>)) {
      const values = stringArray(strings);
      if (values.length) byLocale[locale.toLowerCase()] = values;
    }
    disclosure[platform] = byLocale;
  }

  bundledCache = { keywords, creators, disclosure };
  return bundledCache;
}

export async function loadTrackerDomains(): Promise<string[]> {
  const raw = await loadJson('lists/trackers.json');
  return stringArray(raw.domains);
}
