// Options page: settings, personal lists, statistics.

import { send } from '../proto';
import type { PersonalLists, Settings, Threshold, TrackerMode } from '../types';
import { formatCreator, parseCreator } from '../core/creators';
import { formatItem, parseItem } from '../core/items';
import { t } from '../core/i18n';

type ListName =
  | 'blockCreators'
  | 'trustCreators'
  | 'blockDomains'
  | 'blockItems'
  | 'disabledSites';

let settings: Settings | null = null;
let lists: PersonalLists | null = null;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

function applyStaticLabels(): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  }
  for (const node of document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    const key = node.dataset.i18nPlaceholder;
    if (key) node.placeholder = t(key);
  }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

function toast(message: string): void {
  const element = byId('toast');
  element.textContent = message;
  element.hidden = false;
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, 1800);
}

async function patchSettings(patch: Partial<Settings>): Promise<void> {
  const reply = await send({ t: 'settings/set', patch });
  if (reply) {
    settings = reply.settings;
    renderSettings();
  }
  toast(t('optionsSaved'));
}

async function saveLists(next: PersonalLists): Promise<void> {
  const reply = await send({ t: 'lists/set', lists: next });
  if (reply) {
    lists = reply.lists;
    renderLists();
  }
  toast(t('optionsSaved'));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderSettings(): void {
  if (!settings) return;
  byId<HTMLInputElement>('enabled').checked = settings.enabled;
  byId<HTMLInputElement>('autoPause').checked = settings.autoPauseVideos;
  byId<HTMLSelectElement>('threshold').value = settings.threshold;
  byId<HTMLInputElement>('wholePageMode').checked = settings.wholePageMode;
  byId<HTMLInputElement>('wholePageThreshold').value = String(settings.wholePageThreshold);
  byId<HTMLSelectElement>('trackerMode').value = settings.trackerMode;
  // The caveat about uncounted requests only applies in blocking mode.
  byId('trackerBlockNote').hidden = settings.trackerMode !== 'block';
}

/** Values shown for one list, as display strings. */
function entriesFor(name: ListName): string[] {
  if (!lists || !settings) return [];
  switch (name) {
    case 'blockCreators':
      return lists.blockCreators.map(formatCreator);
    case 'trustCreators':
      return lists.trustCreators.map(formatCreator);
    case 'blockDomains':
      return [...lists.blockDomains];
    case 'blockItems':
      // The title, when we captured one, is what makes an opaque video id
      // recognisable months later — but only the id is ever matched on.
      return lists.blockItems.map((item) =>
        item.title ? `${formatItem(item)}  —  ${item.title}` : formatItem(item),
      );
    case 'disabledSites':
      return [...settings.disabledSites];
  }
}

async function removeEntry(name: ListName, index: number): Promise<void> {
  if (!lists || !settings) return;

  if (name === 'disabledSites') {
    const disabledSites = settings.disabledSites.filter((_, i) => i !== index);
    await patchSettings({ disabledSites });
    return;
  }
  if (name === 'blockDomains') {
    await saveLists({ ...lists, blockDomains: lists.blockDomains.filter((_, i) => i !== index) });
    return;
  }
  if (name === 'blockItems') {
    await saveLists({ ...lists, blockItems: lists.blockItems.filter((_, i) => i !== index) });
    return;
  }
  const key = name;
  await saveLists({ ...lists, [key]: lists[key].filter((_, i) => i !== index) });
}

async function addEntry(name: ListName, raw: string): Promise<void> {
  if (!lists || !settings) return;
  const value = raw.trim();
  if (!value) return;

  if (name === 'disabledSites') {
    await patchSettings({ disabledSites: [...settings.disabledSites, value.toLowerCase()] });
    return;
  }
  if (name === 'blockDomains') {
    await saveLists({ ...lists, blockDomains: [...lists.blockDomains, value.toLowerCase()] });
    return;
  }

  if (name === 'blockItems') {
    const item = parseItem(value);
    if (!item) {
      toast(t('optionsItemPlaceholder'));
      return;
    }
    await saveLists({ ...lists, blockItems: [...lists.blockItems, item] });
    return;
  }

  const creator = parseCreator(value);
  if (!creator) {
    toast(t('optionsAddPlaceholder'));
    return;
  }
  await saveLists({ ...lists, [name]: [...lists[name], creator] });
}

function renderLists(): void {
  for (const editor of document.querySelectorAll<HTMLElement>('.list-editor')) {
    const name = editor.dataset.list as ListName | undefined;
    if (!name) continue;

    const container = editor.querySelector('.entries');
    if (!container) continue;
    container.textContent = '';

    const values = entriesFor(name);
    if (values.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'entry-empty';
      empty.textContent = t('optionsEmptyList');
      container.appendChild(empty);
      continue;
    }

    values.forEach((value, index) => {
      const item = document.createElement('li');
      item.className = 'entry';

      const label = document.createElement('span');
      label.textContent = value;
      item.appendChild(label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = t('optionsRemove');
      remove.addEventListener('click', () => void removeEntry(name, index));
      item.appendChild(remove);

      container.appendChild(item);
    });
  }
}

async function renderStats(): Promise<void> {
  const reply = await send({ t: 'stats/get' });
  if (!reply) return;
  byId('statBlocked').textContent = String(reply.counters.lifetimeBlocked);
  byId('statSession').textContent = String(reply.counters.sessionBlocked);
  byId('statTrackers').textContent = String(reply.counters.lifetimeTrackers);
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

interface ListExport {
  slopBlockerLists: 1;
  lists: PersonalLists;
}

function exportLists(): void {
  if (!lists) return;
  const payload: ListExport = { slopBlockerLists: 1, lists };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = 'slop-blocker-lists.json';
  link.click();
  URL.revokeObjectURL(url);
}

async function importLists(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Partial<ListExport>;
    const imported = parsed?.lists;
    if (!imported || typeof imported !== 'object') throw new Error('bad shape');

    await saveLists({
      blockCreators: Array.isArray(imported.blockCreators) ? imported.blockCreators : [],
      trustCreators: Array.isArray(imported.trustCreators) ? imported.trustCreators : [],
      blockDomains: Array.isArray(imported.blockDomains) ? imported.blockDomains : [],
      blockItems: Array.isArray(imported.blockItems) ? imported.blockItems : [],
    });
  } catch {
    toast(t('optionsImportFailed'));
  }
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire(): void {
  byId<HTMLInputElement>('enabled').addEventListener('change', (event) => {
    void patchSettings({ enabled: (event.target as HTMLInputElement).checked });
  });
  byId<HTMLInputElement>('autoPause').addEventListener('change', (event) => {
    void patchSettings({ autoPauseVideos: (event.target as HTMLInputElement).checked });
  });
  byId<HTMLSelectElement>('threshold').addEventListener('change', (event) => {
    void patchSettings({ threshold: (event.target as HTMLSelectElement).value as Threshold });
  });
  byId<HTMLInputElement>('wholePageMode').addEventListener('change', (event) => {
    void patchSettings({ wholePageMode: (event.target as HTMLInputElement).checked });
  });
  byId<HTMLInputElement>('wholePageThreshold').addEventListener('change', (event) => {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(value)) void patchSettings({ wholePageThreshold: value });
  });
  byId<HTMLSelectElement>('trackerMode').addEventListener('change', (event) => {
    void patchSettings({ trackerMode: (event.target as HTMLSelectElement).value as TrackerMode });
  });

  for (const editor of document.querySelectorAll<HTMLElement>('.list-editor')) {
    const name = editor.dataset.list as ListName | undefined;
    const input = editor.querySelector<HTMLInputElement>('.adder input');
    const button = editor.querySelector<HTMLButtonElement>('.adder button');
    if (!name || !input || !button) continue;

    const submit = () => {
      const value = input.value;
      input.value = '';
      void addEntry(name, value);
    };
    button.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  }

  byId('exportLists').addEventListener('click', exportLists);
  byId('importLists').addEventListener('click', () => byId<HTMLInputElement>('importFile').click());
  byId<HTMLInputElement>('importFile').addEventListener('change', (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) void importLists(file);
  });

  byId('resetStats').addEventListener('click', () => {
    if (!confirm(t('optionsResetConfirm'))) return;
    void send({ t: 'stats/reset' }).then(() => renderStats());
  });
}

async function main(): Promise<void> {
  applyStaticLabels();
  wire();

  const [settingsReply, listsReply] = await Promise.all([
    send({ t: 'settings/get' }),
    send({ t: 'lists/get' }),
  ]);
  settings = settingsReply?.settings ?? null;
  lists = listsReply?.lists ?? null;

  renderSettings();
  renderLists();
  await renderStats();
}

void main().catch((error) => {
  console.warn('[slop-blocker] options page failed:', error);
});
