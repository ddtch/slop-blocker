// Decides *when* the engine scans.
//
// Three triggers: DOM mutations (infinite feeds), scrolling (media entering the
// provenance-scan window), and in-page navigation. All are debounced and run in
// idle time, because a scan touches layout.

import type { SiteAdapter } from '../adapters/types';

const MUTATION_DEBOUNCE_MS = 250;
const SCROLL_DEBOUNCE_MS = 300;
/**
 * Platform disclosure labels frequently render after the media does, so a
 * navigation is followed by two late re-checks (SPEC.md §3.2).
 */
const NAVIGATION_RECHECKS_MS = [800, 3000];

export interface Observer {
  stop(): void;
  /** Force a scan now, bypassing debouncing. */
  trigger(): void;
}

function idle(callback: () => void): void {
  const schedule =
    typeof requestIdleCallback === 'function'
      ? (task: () => void) => requestIdleCallback(task, { timeout: 500 })
      : (task: () => void) => setTimeout(task, 0);
  schedule(callback);
}

export function observe(
  adapter: SiteAdapter,
  onScan: () => void,
  onNavigate: (href: string) => void,
): Observer {
  let mutationTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  const navigationTimers: Array<ReturnType<typeof setTimeout>> = [];
  let stopped = false;
  let lastHref = location.href;

  const scan = () => {
    if (!stopped) idle(onScan);
  };

  const debounce = (
    current: ReturnType<typeof setTimeout> | null,
    delay: number,
    assign: (timer: ReturnType<typeof setTimeout> | null) => void,
  ) => {
    if (current !== null) return;
    assign(
      setTimeout(() => {
        assign(null);
        scan();
      }, delay),
    );
  };

  const mutationObserver = new MutationObserver((records) => {
    // Ignore batches that only touched our own overlay hosts.
    const relevant = records.some((record) => {
      const target = record.target as HTMLElement;
      return !(target instanceof HTMLElement) || !target.hasAttribute?.('data-slop-blocker');
    });
    if (!relevant) return;
    debounce(mutationTimer, MUTATION_DEBOUNCE_MS, (timer) => {
      mutationTimer = timer;
    });
  });

  if (document.documentElement) {
    mutationObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      // Disclosure badges often appear as an attribute flip on an existing node.
      attributes: true,
      attributeFilter: ['aria-label', 'src', 'href', 'data-e2e'],
    });
  }

  const onScroll = () =>
    debounce(scrollTimer, SCROLL_DEBOUNCE_MS, (timer) => {
      scrollTimer = timer;
    });
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  const handleNavigation = () => {
    if (stopped) return;
    const href = location.href;
    if (href !== lastHref) {
      lastHref = href;
      onNavigate(href);
    } else {
      scan();
    }
    for (const delay of NAVIGATION_RECHECKS_MS) {
      navigationTimers.push(setTimeout(scan, delay));
    }
  };

  const unsubscribeAdapter = adapter.onNavigate?.(handleNavigation);
  // History API navigations that the adapter does not cover.
  window.addEventListener('popstate', handleNavigation);
  window.addEventListener('hashchange', handleNavigation);

  return {
    trigger: () => onScan(),
    stop: () => {
      stopped = true;
      mutationObserver.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('popstate', handleNavigation);
      window.removeEventListener('hashchange', handleNavigation);
      unsubscribeAdapter?.();
      for (const timer of [mutationTimer, scrollTimer, ...navigationTimers]) {
        if (timer !== null) clearTimeout(timer);
      }
    },
  };
}
