// Content-script entry point. Runs in every frame of every page.

import { send, type Msg } from '../proto';
import type { PageContext } from '../types';
import { pageKey } from '../core/hash';
import { pickAdapter } from '../adapters';
import { localeSupported } from '../adapters/disclosure';
import { Engine } from './engine';
import { observe } from './observer';
import { startTrackerWatch } from './trackers';

const INJECTED_FLAG = '__slopBlockerInjected';

function pageLocale(): string {
  const declared = document.documentElement?.getAttribute('lang');
  return (declared || navigator.language || 'en').toLowerCase();
}

async function main(): Promise<void> {
  const globals = window as unknown as Record<string, unknown>;
  // Re-injection happens on extension reload; a second engine would double-block.
  if (globals[INJECTED_FLAG]) return;
  globals[INJECTED_FLAG] = true;

  const bootstrap = await send({ t: 'ctx/request' });
  if (!bootstrap) return; // worker unavailable; fail open and leave the page alone

  const ctx: PageContext = {
    href: location.href,
    hostname: location.hostname,
    locale: pageLocale(),
    settings: bootstrap.settings,
    personalLists: bootstrap.personalLists,
    lists: bootstrap.lists,
  };

  const adapter = pickAdapter(ctx.hostname);
  const engine = new Engine(ctx, adapter);

  const isTopFrame = window.top === window;

  /**
   * Tells the worker what the page is about, for the popup's quick actions.
   *
   * Runs regardless of whether blocking is enabled here: "block this channel"
   * has to work on a site the user switched us off on, which is exactly when
   * they are most likely to want it. Reads the URL and page chrome only.
   */
  const reportSubject = (): void => {
    if (!isTopFrame) return;
    let subject = null;
    try {
      subject = adapter.subject?.(document, ctx) ?? null;
    } catch (error) {
      console.warn(`[slop-blocker] adapter ${adapter.id} subject failed:`, error);
    }
    void send({ t: 'page/subject', subject });
  };

  // Only the top frame owns the tab's detection list.
  if (isTopFrame) {
    void send({ t: 'page/reset', url: pageKey(ctx.href) });
    if (adapter.platform) {
      void send({ t: 'locale/unsupported', unsupported: !localeSupported(adapter.platform, ctx) });
    }
  }

  try {
    adapter.init?.(ctx, () => engine.scan());
  } catch (error) {
    console.warn(`[slop-blocker] adapter ${adapter.id} init failed:`, error);
  }

  observe(
    adapter,
    () => {
      engine.scan();
      // Channel names and video titles render after the URL changes, so the
      // subject is re-read on every scan; the worker drops no-op updates.
      reportSubject();
    },
    (href) => {
      if (isTopFrame) void send({ t: 'page/reset', url: pageKey(href) });
      ctx.href = href;
      engine.navigated(href);
      reportSubject();
    },
  );

  let stopTrackerWatch: (() => void) | null = null;
  const syncTrackerWatch = (mode: string): void => {
    if (mode === 'off') {
      stopTrackerWatch?.();
      stopTrackerWatch = null;
    } else if (!stopTrackerWatch) {
      stopTrackerWatch = startTrackerWatch();
    }
  };

  chrome.runtime.onMessage.addListener((msg: Msg) => {
    switch (msg.t) {
      case 'settings/changed':
        engine.updateContext(msg.settings, msg.personalLists);
        // Turning counting on must take effect without reloading the page.
        syncTrackerWatch(msg.settings.trackerMode);
        break;
      case 'reveal/apply':
        engine.applyRemoteReveal(msg.id);
        break;
      case 'contextmenu/mark':
        engine.markContextTarget(msg.verdict);
        break;
      default:
        break;
    }
  });

  syncTrackerWatch(ctx.settings.trackerMode);

  engine.scan();
  reportSubject();
}

void main().catch((error) => {
  console.warn('[slop-blocker] content script failed to start:', error);
});
