/**
 * Tracker matching by registrable-ish domain suffix.
 *
 * We deliberately avoid a Public Suffix List: for a curated list of tracker
 * domains, walking the label suffixes of a hostname and testing each against a
 * Set is exact enough and costs nothing in bundle size.
 */

export function compileTrackerSet(domains: string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of domains) {
    const domain = raw.trim().toLowerCase().replace(/^\*?\./, '').replace(/\.$/, '');
    if (!domain || domain.startsWith('#')) continue;
    // A single-label entry would be a TLD, which must never match a whole zone.
    if (!domain.includes('.')) continue;
    set.add(domain);
  }
  return set;
}

/** Returns the tracker domain that matched, or null. */
export function matchTracker(hostname: string, trackers: Set<string>): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  if (!host || trackers.size === 0) return null;

  if (trackers.has(host)) return host;

  let index = host.indexOf('.');
  while (index >= 0) {
    const suffix = host.slice(index + 1);
    // Stop before testing a bare TLD: matching "net" would flag every .net host.
    if (!suffix.includes('.')) break;
    if (trackers.has(suffix)) return suffix;
    index = host.indexOf('.', index + 1);
  }
  return null;
}

/** Hostname of a resource URL, or null for non-http(s) schemes we ignore. */
export function resourceHostname(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname;
  } catch {
    return null;
  }
}
