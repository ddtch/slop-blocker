// Per-tab detection registry, badge rendering, and change notification.
//
// The MV3 worker can be torn down at any moment, so the registry is written
// through to chrome.storage.session and the in-memory Map is only a cache. The
// popup must never depend on worker-lifetime state.

import type { Detection, MediaType, PageSubject, TrackerStat } from '../types';

const MAX_DETECTIONS_PER_TAB = 500;
const BADGE_CONFIRMED = '#e11d48';
const BADGE_WEAK = '#f59e0b';

export interface TabRecord {
  url: string;
  hostname: string;
  detections: Detection[];
  /** Tracker domain -> number of requests seen. */
  trackers: Record<string, number>;
  localeUnsupported: boolean;
  /** What the page is about, for the popup's quick actions. */
  subject: PageSubject | null;
}

function emptyRecord(url = '', hostname = ''): TabRecord {
  return { url, hostname, detections: [], trackers: {}, localeUnsupported: false, subject: null };
}

const cache = new Map<number, TabRecord>();
const listeners = new Set<(tabId: number) => void>();

export function onRegistryChange(listener: (tabId: number) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(tabId: number): void {
  for (const listener of listeners) {
    try {
      listener(tabId);
    } catch (error) {
      console.warn('[slop-blocker] registry listener failed:', error);
    }
  }
}

function sessionKey(tabId: number): string {
  return `tab:${tabId}`;
}

export async function getTab(tabId: number): Promise<TabRecord> {
  const cached = cache.get(tabId);
  if (cached) return cached;

  try {
    const stored = await chrome.storage.session.get(sessionKey(tabId));
    const record = stored[sessionKey(tabId)] as TabRecord | undefined;
    const result = record ?? emptyRecord();
    cache.set(tabId, result);
    return result;
  } catch {
    return emptyRecord();
  }
}

async function saveTab(tabId: number, record: TabRecord): Promise<void> {
  cache.set(tabId, record);
  try {
    await chrome.storage.session.set({ [sessionKey(tabId)]: record });
  } catch (error) {
    console.warn('[slop-blocker] could not persist tab state:', error);
  }
  await updateBadge(tabId, record);
  notify(tabId);
}

export async function clearTab(tabId: number): Promise<void> {
  cache.delete(tabId);
  try {
    await chrome.storage.session.remove(sessionKey(tabId));
  } catch {
    // Session storage may be unavailable during shutdown.
  }
  notify(tabId);
}

/** Called on page load and on SPA route changes: drops stale detections. */
export async function resetTab(tabId: number, url: string): Promise<void> {
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = '';
  }
  await saveTab(tabId, emptyRecord(url, hostname));
}

/**
 * Merges reported detections into a tab.
 * @returns how many newly *blocked* detections appeared, per media type, so the
 * caller can bump lifetime counters exactly once per item.
 */
export async function reportDetections(
  tabId: number,
  incoming: Detection[],
): Promise<Partial<Record<MediaType, number>>> {
  const record = await getTab(tabId);
  const byId = new Map(record.detections.map((detection) => [detection.id, detection]));
  const newlyBlocked: Partial<Record<MediaType, number>> = {};

  for (const raw of incoming) {
    const detection: Detection = { ...raw, tabId };
    const existing = byId.get(detection.id);

    if (existing) {
      const wasBlocked = existing.blocked;
      const merged: Detection = {
        ...existing,
        ...detection,
        // A reveal is a user decision; a re-scan must never undo it.
        revealed: existing.revealed || detection.revealed,
        detectedAt: existing.detectedAt,
      };
      byId.set(detection.id, merged);
      // Provenance results arrive after the first pass and can promote an item.
      if (!wasBlocked && merged.blocked) {
        newlyBlocked[merged.mediaType] = (newlyBlocked[merged.mediaType] ?? 0) + 1;
      }
      continue;
    }

    byId.set(detection.id, detection);
    if (detection.blocked) {
      newlyBlocked[detection.mediaType] = (newlyBlocked[detection.mediaType] ?? 0) + 1;
    }
  }

  record.detections = trim([...byId.values()]);
  await saveTab(tabId, record);
  return newlyBlocked;
}

/** Keeps memory bounded: revealed items are the first to go, then the oldest. */
function trim(detections: Detection[]): Detection[] {
  if (detections.length <= MAX_DETECTIONS_PER_TAB) return detections;

  const sorted = [...detections].sort((a, b) => {
    if (a.revealed !== b.revealed) return a.revealed ? -1 : 1;
    return a.detectedAt - b.detectedAt;
  });
  const dropCount = detections.length - MAX_DETECTIONS_PER_TAB;
  const dropped = new Set(sorted.slice(0, dropCount).map((detection) => detection.id));
  return detections.filter((detection) => !dropped.has(detection.id));
}

export async function markRevealed(tabId: number, id: string): Promise<void> {
  const record = await getTab(tabId);
  const detection = record.detections.find((candidate) => candidate.id === id);
  if (!detection || detection.revealed) return;
  detection.revealed = true;
  await saveTab(tabId, record);
}

/**
 * @returns the number of tracker domains seen on this tab for the first time,
 * so the lifetime tracker counter grows per unique domain rather than per request.
 */
export async function addTrackers(tabId: number, domains: string[]): Promise<number> {
  if (domains.length === 0) return 0;
  const record = await getTab(tabId);
  let newDomains = 0;
  for (const domain of domains) {
    if (record.trackers[domain] === undefined) {
      record.trackers[domain] = 0;
      newDomains++;
    }
    record.trackers[domain] += 1;
  }
  await saveTab(tabId, record);
  return newDomains;
}

export async function setSubject(tabId: number, subject: PageSubject | null): Promise<void> {
  const record = await getTab(tabId);
  // Re-scans report the same subject constantly; only a change is worth a write
  // and a push to the popup.
  if (JSON.stringify(record.subject ?? null) === JSON.stringify(subject ?? null)) return;
  record.subject = subject;
  await saveTab(tabId, record);
}

export async function setLocaleUnsupported(tabId: number, unsupported: boolean): Promise<void> {
  const record = await getTab(tabId);
  if (record.localeUnsupported === unsupported) return;
  record.localeUnsupported = unsupported;
  await saveTab(tabId, record);
}

export function trackerStats(record: TabRecord): TrackerStat[] {
  return Object.entries(record.trackers)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

export function trackerTotal(record: TabRecord): number {
  return Object.values(record.trackers).reduce((sum, count) => sum + count, 0);
}

export async function updateBadge(tabId: number, record?: TabRecord): Promise<void> {
  const tab = record ?? (await getTab(tabId));
  const active = tab.detections.filter((detection) => detection.blocked && !detection.revealed);
  const hasConfirmed = active.some((detection) => detection.confidence === 'confirmed');

  try {
    await chrome.action.setBadgeText({ tabId, text: active.length ? String(active.length) : '' });
    if (active.length) {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: hasConfirmed ? BADGE_CONFIRMED : BADGE_WEAK,
      });
    }
  } catch {
    // The tab may have closed between the report and the badge update.
  }
}
