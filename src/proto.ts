// The single source of truth for extension-internal messaging (SPEC.md §6).
//
// Content scripts -> service worker uses chrome.runtime.sendMessage.
// The popup uses a long-lived port (PORT_POPUP) and receives pushed state.

import type {
  BundledLists,
  Counters,
  CreatorRef,
  Detection,
  ItemRef,
  PageSubject,
  PersonalLists,
  Settings,
  TrackerStat,
} from './types';

export const PORT_POPUP = 'slop-blocker/popup';

/** Verdict for one media URL, produced by the provenance scanner. */
export interface ProvenanceVerdict {
  /**
   * - `ai`: metadata declares AI generation (C2PA action or IPTC digitalSourceType)
   * - `generator`: a known AI tool signed the asset, without an explicit AI action
   * - `clean`: provenance metadata present, no AI declaration
   * - `none`: no provenance metadata found
   * - `error`: could not be fetched or parsed
   */
  verdict: 'ai' | 'generator' | 'clean' | 'none' | 'error';
  /** Which signal produced an `ai` verdict. */
  source?: 'c2pa' | 'iptc-metadata';
  /** e.g. the claim generator ("Adobe Firefly"), shown in the reason line. */
  detail?: string;
}

export interface TabState {
  detections: Detection[];
  trackers: TrackerStat[];
  trackerTotal: number;
  counters: Counters;
  settings: Settings;
  /** So the popup can show its quick actions as toggles rather than one-way doors. */
  personalLists: PersonalLists;
  /** Hostname of the tab, so the popup can offer "off on this site". */
  hostname: string;
  /**
   * What the page is about — the channel, the video — so the popup can offer
   * quick actions even when nothing was detected. Null off a supported site,
   * and on feed pages that are not about one thing.
   */
  subject: PageSubject | null;
  /** True when the page language has no disclosure-string coverage. */
  localeUnsupported: boolean;
}

export type Msg =
  // --- content script -> service worker ---
  | { t: 'ctx/request' }
  /** Drops a tab's detections: a fresh page load, or an SPA route change. */
  | { t: 'page/reset'; url: string }
  | { t: 'detections/report'; detections: Detection[] }
  | { t: 'detections/revealed'; id: string }
  | { t: 'provenance/check'; urls: string[] }
  | { t: 'trackers/report'; domains: string[] }
  /** Who and what the page is about, for the popup's quick actions. */
  | { t: 'page/subject'; subject: PageSubject | null }
  | { t: 'locale/unsupported'; unsupported: boolean }
  /** Content scripts cannot call chrome.runtime.openOptionsPage themselves. */
  | { t: 'options/open' }
  // --- popup / options -> service worker ---
  | { t: 'tab/state'; tabId?: number }
  | { t: 'settings/get' }
  | { t: 'settings/set'; patch: Partial<Settings> }
  | { t: 'lists/get' }
  /** `none` removes the creator from both lists, so the popup toggle can undo. */
  | { t: 'lists/markCreator'; creator: CreatorRef; verdict: 'block' | 'trust' | 'none' }
  | { t: 'lists/markItem'; item: ItemRef; verdict: 'block' | 'none' }
  | { t: 'lists/set'; lists: PersonalLists }
  | { t: 'stats/get' }
  | { t: 'stats/reset' }
  | { t: 'reveal/request'; tabId: number; id: string }
  // --- service worker -> content script ---
  | { t: 'settings/changed'; settings: Settings; personalLists: PersonalLists }
  | { t: 'reveal/apply'; id: string }
  /** Acts on the element the user last right-clicked in that tab. */
  | { t: 'contextmenu/mark'; verdict: 'block' | 'trust' };

export type Reply = {
  'ctx/request': { settings: Settings; personalLists: PersonalLists; lists: BundledLists };
  'page/reset': { ok: true };
  'detections/report': { ok: true };
  'detections/revealed': { ok: true };
  'provenance/check': { results: Record<string, ProvenanceVerdict> };
  'trackers/report': { ok: true };
  'page/subject': { ok: true };
  'locale/unsupported': { ok: true };
  'options/open': { ok: true };
  'tab/state': TabState;
  'settings/get': { settings: Settings };
  'settings/set': { settings: Settings };
  'lists/get': { lists: PersonalLists };
  'lists/markCreator': { lists: PersonalLists };
  'lists/markItem': { lists: PersonalLists };
  'lists/set': { lists: PersonalLists };
  'stats/get': { counters: Counters };
  'stats/reset': { counters: Counters };
  'reveal/request': { ok: true };
  'settings/changed': { ok: true };
  'reveal/apply': { ok: true };
  'contextmenu/mark': { ok: true };
};

/** Typed wrapper over sendMessage; resolves to null if the worker is unreachable. */
export async function send<K extends Msg['t']>(
  msg: Extract<Msg, { t: K }>,
): Promise<Reply[K] | null> {
  try {
    return (await chrome.runtime.sendMessage(msg)) as Reply[K];
  } catch {
    // The worker may be restarting, or the page is being torn down. Fail open.
    return null;
  }
}

/** Typed wrapper for messages aimed at a tab's content scripts. */
export async function sendToTab<K extends Msg['t']>(
  tabId: number,
  msg: Extract<Msg, { t: K }>,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // No content script in that tab (chrome:// pages, or not yet injected).
  }
}

/** Push payload sent over the popup port whenever a tab's state changes. */
export interface PopupPush {
  t: 'tab/stateResult';
  state: TabState;
}
