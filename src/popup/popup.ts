// Popup: shows what was detected on the current tab and the running totals.
//
// State arrives over a long-lived port and is pushed again whenever the tab's
// registry changes, so the list stays live while the popup is open.

import { PORT_POPUP, send, type PopupPush, type TabState } from '../proto';
import type { Detection } from '../types';
import { confidenceLabel, mediaTypeLabel, t } from '../core/i18n';

const MEDIA_ICONS: Record<string, string> = {
  video: '▶',
  image: '▣',
  post: '❏',
  audio: '♪',
  embed: '◫',
  page: '⬒',
};

const elements = {
  master: document.getElementById('master') as HTMLInputElement,
  detections: document.getElementById('detections') as HTMLUListElement,
  empty: document.getElementById('empty') as HTMLElement,
  localeWarning: document.getElementById('localeWarning') as HTMLElement,
  offBanner: document.getElementById('offBanner') as HTMLElement,
  trackerToggle: document.getElementById('trackerToggle') as HTMLButtonElement,
  trackerLabel: document.getElementById('trackerLabel') as HTMLElement,
  trackers: document.getElementById('trackers') as HTMLUListElement,
  trackerNote: document.getElementById('trackerNote') as HTMLElement,
  lifetime: document.getElementById('lifetime') as HTMLElement,
  session: document.getElementById('session') as HTMLElement,
  disableSite: document.getElementById('disableSite') as HTMLButtonElement,
  openOptions: document.getElementById('openOptions') as HTMLButtonElement,
};

let state: TabState | null = null;
let tabId: number | null = null;
let trackersExpanded = false;

function applyStaticLabels(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  }
}

function row(detection: Detection): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'row';
  if (detection.confidence === 'suspected' || !detection.blocked) item.classList.add('row--suspected');
  if (detection.revealed) item.classList.add('row--revealed');

  const icon = document.createElement('div');
  icon.className = 'row-icon';
  icon.textContent = MEDIA_ICONS[detection.mediaType] ?? '●';
  item.appendChild(icon);

  const body = document.createElement('div');
  body.className = 'row-body';

  const head = document.createElement('div');
  head.className = 'row-head';

  const type = document.createElement('span');
  type.className = 'row-type';
  type.textContent = mediaTypeLabel(detection.mediaType);
  head.appendChild(type);

  const tier = document.createElement('span');
  tier.className = `row-tier row-tier--${detection.confidence}`;
  tier.textContent = confidenceLabel(detection.confidence);
  head.appendChild(tier);

  if (detection.pausedVideo) {
    const paused = document.createElement('span');
    paused.className = 'row-flag';
    paused.textContent = t('popupPaused');
    head.appendChild(paused);
  }
  if (detection.revealed) {
    const revealed = document.createElement('span');
    revealed.className = 'row-flag';
    revealed.textContent = t('popupRevealed');
    head.appendChild(revealed);
  }
  body.appendChild(head);

  // Reason text comes from the page (platform labels, matched keywords), so it
  // is only ever assigned as text.
  const reason = document.createElement('div');
  reason.className = 'row-reason';
  reason.textContent = detection.reason;
  body.appendChild(reason);

  const actions = document.createElement('div');
  actions.className = 'row-actions';

  if (!detection.revealed && detection.blocked && tabId !== null) {
    const show = document.createElement('button');
    show.className = 'link';
    show.type = 'button';
    show.textContent = t('shroudShow');
    show.addEventListener('click', () => {
      void send({ t: 'reveal/request', tabId: tabId as number, id: detection.id });
    });
    actions.appendChild(show);
  }

  if (detection.creator) {
    const trust = document.createElement('button');
    trust.className = 'link';
    trust.type = 'button';
    trust.textContent = t('popupTrustCreator');
    trust.addEventListener('click', () => {
      void send({ t: 'lists/markCreator', creator: detection.creator!, verdict: 'trust' });
    });
    actions.appendChild(trust);
  }

  if (actions.childElementCount > 0) body.appendChild(actions);
  item.appendChild(body);
  return item;
}

function renderTrackers(next: TabState): void {
  const { trackerMode } = next.settings;

  if (trackerMode === 'off') {
    elements.trackerLabel.textContent = t('popupTrackersOff');
    elements.trackerToggle.disabled = true;
    elements.trackers.hidden = true;
    elements.trackerNote.hidden = true;
    return;
  }

  elements.trackerToggle.disabled = next.trackers.length === 0;
  elements.trackerLabel.textContent = t('popupTrackers', [String(next.trackerTotal)]);
  elements.trackerNote.hidden = trackerMode !== 'block';

  elements.trackers.textContent = '';
  for (const tracker of next.trackers.slice(0, 12)) {
    const item = document.createElement('li');
    item.className = 'tracker-row';

    const domain = document.createElement('span');
    domain.textContent = tracker.domain;
    item.appendChild(domain);

    const count = document.createElement('span');
    count.className = 'tracker-count';
    count.textContent = String(tracker.count);
    item.appendChild(count);

    elements.trackers.appendChild(item);
  }
  elements.trackers.hidden = !trackersExpanded || next.trackers.length === 0;
  elements.trackerToggle.setAttribute('aria-expanded', String(trackersExpanded));
}

function render(next: TabState): void {
  state = next;

  elements.master.checked = next.settings.enabled;
  elements.offBanner.hidden = next.settings.enabled;

  const siteDisabled = next.settings.disabledSites.includes(next.hostname.toLowerCase());
  elements.disableSite.textContent = siteDisabled
    ? `${t('popupDisableSite')} ✓`
    : t('popupDisableSite');
  elements.disableSite.classList.toggle('link--danger', !siteDisabled);

  elements.localeWarning.hidden = !next.localeUnsupported;

  elements.detections.textContent = '';
  const sorted = [...next.detections].sort((a, b) => {
    if (a.revealed !== b.revealed) return a.revealed ? 1 : -1;
    return b.detectedAt - a.detectedAt;
  });
  for (const detection of sorted) elements.detections.appendChild(row(detection));
  elements.empty.hidden = sorted.length > 0;

  renderTrackers(next);

  elements.lifetime.textContent = String(next.counters.lifetimeBlocked);
  elements.session.textContent = String(next.counters.sessionBlocked);
}

function connect(): void {
  const port = chrome.runtime.connect({ name: PORT_POPUP });

  port.onMessage.addListener((message: PopupPush) => {
    if (message?.t === 'tab/stateResult') render(message.state);
  });

  port.postMessage({ t: 'tab/state', tabId: tabId ?? undefined });
}

function wireControls(): void {
  elements.master.addEventListener('change', () => {
    void send({ t: 'settings/set', patch: { enabled: elements.master.checked } });
  });

  elements.disableSite.addEventListener('click', () => {
    if (!state) return;
    const hostname = state.hostname.toLowerCase();
    if (!hostname) return;
    const current = state.settings.disabledSites;
    const disabledSites = current.includes(hostname)
      ? current.filter((entry) => entry !== hostname)
      : [...current, hostname];
    void send({ t: 'settings/set', patch: { disabledSites } });
  });

  elements.openOptions.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });

  elements.trackerToggle.addEventListener('click', () => {
    trackersExpanded = !trackersExpanded;
    if (state) renderTrackers(state);
  });
}

async function main(): Promise<void> {
  applyStaticLabels();
  wireControls();

  // As a real popup this resolves to the tab the popup is anchored to. Opened
  // as an ordinary page — which is how it is inspected and screenshotted —
  // that query would return the popup's own tab, so `?tabId=` overrides it.
  const requested = Number(new URLSearchParams(location.search).get('tabId'));
  if (Number.isInteger(requested) && requested > 0) {
    tabId = requested;
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id ?? null;
  }

  connect();

  // The port push covers updates; this first pull fills the UI immediately.
  const initial = await send({ t: 'tab/state', tabId: tabId ?? undefined });
  if (initial) render(initial);
}

void main().catch((error) => {
  console.warn('[slop-blocker] popup failed:', error);
});
