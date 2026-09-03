// Observes which hosts the page actually loaded and reports them for counting.
//
// Resource Timing is the right source here: it sees every subresource without
// needing a network-level permission, and it costs nothing because the browser
// records the entries anyway. Requests blocked by declarativeNetRequest never
// appear here — see the note in src/background/trackers.ts.

import { send } from '../proto';
import { resourceHostname } from '../core/trackers';

const FLUSH_INTERVAL_MS = 2000;
/** Cap per batch so a page with thousands of requests cannot flood messaging. */
const MAX_BATCH = 200;

export function startTrackerWatch(): () => void {
  // Duplicates are intentional: the worker counts requests, not just domains.
  let pending: string[] = [];
  let stopped = false;

  const collect = (entries: readonly PerformanceEntry[]): void => {
    for (const entry of entries) {
      if (pending.length >= MAX_BATCH) break;
      const hostname = resourceHostname(entry.name);
      if (hostname && hostname !== location.hostname) pending.push(hostname);
    }
  };

  try {
    collect(performance.getEntriesByType('resource'));
  } catch {
    // Resource Timing unavailable in this context.
  }

  let observer: PerformanceObserver | null = null;
  try {
    observer = new PerformanceObserver((list) => collect(list.getEntries()));
    observer.observe({ entryTypes: ['resource'] });
  } catch {
    observer = null;
  }

  const flush = (): void => {
    if (stopped || pending.length === 0) return;
    const domains = pending;
    pending = [];
    void send({ t: 'trackers/report', domains });
  };

  const timer = setInterval(flush, FLUSH_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    observer?.disconnect();
  };
}
