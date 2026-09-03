// Service worker: message router, tab lifecycle, popup port, context menus.

import { PORT_POPUP, sendToTab, type Msg, type PopupPush, type TabState } from '../proto';
import { t } from '../core/i18n';
import type { Settings } from '../types';
import {
  bumpCounters,
  getCounters,
  getPersonalLists,
  getSettings,
  loadBundledLists,
  markCreator,
  resetCounters,
  setPersonalLists,
  setSettings,
} from './storage';
import {
  addTrackers,
  clearTab,
  getTab,
  markRevealed,
  onRegistryChange,
  reportDetections,
  resetTab,
  setLocaleUnsupported,
  trackerStats,
  trackerTotal,
  updateBadge,
} from './registry';
import { checkUrls, dropQueue } from './provenance';
import { matchHostnames, syncTrackerRules } from './trackers';

const MENU_BLOCK = 'slop-blocker/mark-creator-block';
const MENU_TRUST = 'slop-blocker/mark-creator-trust';

// ---------------------------------------------------------------------------
// Tab state assembly
// ---------------------------------------------------------------------------

async function hostnameOf(tabId: number, fallback: string): Promise<string> {
  if (fallback) return fallback;
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab.url ? new URL(tab.url).hostname : '';
  } catch {
    return '';
  }
}

async function buildTabState(tabId: number): Promise<TabState> {
  const [record, counters, settings] = await Promise.all([getTab(tabId), getCounters(), getSettings()]);
  return {
    detections: [...record.detections].sort((a, b) => b.detectedAt - a.detectedAt),
    trackers: trackerStats(record),
    trackerTotal: trackerTotal(record),
    counters,
    settings,
    hostname: await hostnameOf(tabId, record.hostname),
    localeUnsupported: record.localeUnsupported,
  };
}

async function activeTabId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

/** Tells every content script about new settings or lists. */
async function broadcastSettings(): Promise<void> {
  const [settings, personalLists] = await Promise.all([getSettings(), getPersonalLists()]);
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === 'number')
        .map((tab) => sendToTab(tab.id, { t: 'settings/changed', settings, personalLists })),
    );
  } catch (error) {
    console.warn('[slop-blocker] could not broadcast settings:', error);
  }
}

// ---------------------------------------------------------------------------
// Message routing
// ---------------------------------------------------------------------------

async function handle(msg: Msg, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const senderTabId = sender.tab?.id;

  switch (msg.t) {
    case 'ctx/request': {
      const [settings, personalLists, lists] = await Promise.all([
        getSettings(),
        getPersonalLists(),
        loadBundledLists(),
      ]);
      return { settings, personalLists, lists };
    }

    case 'page/reset': {
      // Only the top frame owns a tab's detection list; sub-frames would wipe it.
      if (senderTabId !== undefined && sender.frameId === 0) {
        dropQueue();
        await resetTab(senderTabId, msg.url);
      }
      return { ok: true };
    }

    case 'detections/report': {
      if (senderTabId === undefined) return { ok: true };
      const newlyBlocked = await reportDetections(senderTabId, msg.detections);
      if (Object.keys(newlyBlocked).length) await bumpCounters({ blockedByType: newlyBlocked });
      return { ok: true };
    }

    case 'detections/revealed': {
      if (senderTabId !== undefined) await markRevealed(senderTabId, msg.id);
      return { ok: true };
    }

    case 'provenance/check': {
      return { results: await checkUrls(msg.urls) };
    }

    case 'trackers/report': {
      if (senderTabId === undefined) return { ok: true };
      const settings = await getSettings();
      if (settings.trackerMode === 'off') return { ok: true };
      const matched = await matchHostnames(msg.domains);
      const newUnique = await addTrackers(senderTabId, matched);
      if (newUnique) await bumpCounters({ trackers: newUnique });
      return { ok: true };
    }

    case 'locale/unsupported': {
      if (senderTabId !== undefined) await setLocaleUnsupported(senderTabId, msg.unsupported);
      return { ok: true };
    }

    case 'tab/state': {
      const tabId = msg.tabId ?? (await activeTabId());
      if (tabId === null) return null;
      return buildTabState(tabId);
    }

    case 'options/open': {
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    }

    case 'settings/get':
      return { settings: await getSettings() };

    case 'settings/set': {
      const before = await getSettings();
      const settings = await setSettings(msg.patch);
      if (before.trackerMode !== settings.trackerMode) await syncTrackerRules(settings.trackerMode);
      await broadcastSettings();
      return { settings };
    }

    case 'lists/get':
      return { lists: await getPersonalLists() };

    case 'lists/markCreator': {
      const lists = await markCreator(msg.creator, msg.verdict);
      await broadcastSettings();
      return { lists };
    }

    case 'lists/set': {
      const lists = await setPersonalLists(msg.lists);
      await broadcastSettings();
      return { lists };
    }

    case 'stats/get':
      return { counters: await getCounters() };

    case 'stats/reset':
      return { counters: await resetCounters() };

    case 'reveal/request': {
      await markRevealed(msg.tabId, msg.id);
      await sendToTab(msg.tabId, { t: 'reveal/apply', id: msg.id });
      return { ok: true };
    }

    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((msg: Msg, sender, respond) => {
  handle(msg, sender).then(respond, (error) => {
    console.warn('[slop-blocker] message handler failed:', msg?.t, error);
    respond(null);
  });
  return true; // keep the channel open for the async reply
});

// ---------------------------------------------------------------------------
// Popup port: pushes state for the tab the popup is showing
// ---------------------------------------------------------------------------

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_POPUP) return;

  let watching: number | null = null;

  const unsubscribe = onRegistryChange((tabId) => {
    if (tabId !== watching) return;
    void buildTabState(tabId).then((state) => {
      try {
        port.postMessage({ t: 'tab/stateResult', state } satisfies PopupPush);
      } catch {
        // Popup closed between the change and the push.
      }
    });
  });

  port.onMessage.addListener((msg: Msg) => {
    if (msg.t !== 'tab/state') return;
    void (async () => {
      const tabId = msg.tabId ?? (await activeTabId());
      if (tabId === null) return;
      watching = tabId;
      const state = await buildTabState(tabId);
      try {
        port.postMessage({ t: 'tab/stateResult', state } satisfies PopupPush);
      } catch {
        // Popup closed while we assembled the state.
      }
    })();
  });

  port.onDisconnect.addListener(() => unsubscribe());
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function createContextMenus(): void {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_BLOCK, title: t('menuBlockCreator'), contexts: ['all'] });
    chrome.contextMenus.create({ id: MENU_TRUST, title: t('menuTrustCreator'), contexts: ['all'] });
  });
}

chrome.contextMenus?.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  if (info.menuItemId === MENU_BLOCK) void sendToTab(tab.id, { t: 'contextmenu/mark', verdict: 'block' });
  if (info.menuItemId === MENU_TRUST) void sendToTab(tab.id, { t: 'contextmenu/mark', verdict: 'trust' });
});

async function bootstrap(): Promise<void> {
  const settings: Settings = await getSettings();
  await syncTrackerRules(settings.trackerMode);
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
  void bootstrap();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
  void bootstrap();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A committed URL change means the old page's detections are gone.
  if (changeInfo.url) {
    dropQueue();
    void resetTab(tabId, changeInfo.url);
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void updateBadge(tabId);
});
