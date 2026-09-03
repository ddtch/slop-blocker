// Personal lists against a fake chrome.storage.
//
// The reason this file exists is the concurrency test at the bottom: the popup
// puts "Block channel" and "Block this video" next to each other, so two
// read-modify-write cycles overlap by a few milliseconds in ordinary use.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPersonalLists, markCreator, markItem, setPersonalLists } from '../../src/background/storage';
import { EMPTY_PERSONAL_LISTS } from '../../src/types';

/**
 * A chrome.storage.local stand-in that resolves on a later microtask than the
 * caller, the way a real extension storage round-trip does. An implementation
 * that resolved synchronously would hide exactly the interleaving under test.
 */
function installFakeStorage(): { area: Record<string, unknown> } {
  const area: Record<string, unknown> = {};
  const local = {
    get: vi.fn(async (key: string) => {
      await Promise.resolve();
      return key in area ? { [key]: area[key] } : {};
    }),
    set: vi.fn(async (values: Record<string, unknown>) => {
      await Promise.resolve();
      Object.assign(area, values);
    }),
  };
  const chromeGlobal = globalThis as unknown as { chrome: Record<string, unknown> };
  chromeGlobal.chrome = { ...chromeGlobal.chrome, storage: { local, session: local } };
  return { area };
}

beforeEach(() => {
  installFakeStorage();
});

describe('personal lists', () => {
  it('starts empty and round-trips', async () => {
    expect(await getPersonalLists()).toEqual(EMPTY_PERSONAL_LISTS);

    await setPersonalLists({
      ...EMPTY_PERSONAL_LISTS,
      blockItems: [{ platform: 'youtube', id: 'abc' }],
    });
    expect((await getPersonalLists()).blockItems).toEqual([{ platform: 'youtube', id: 'abc' }]);
  });

  it('moves a creator between block and trust rather than listing them twice', async () => {
    const creator = { platform: 'youtube', handle: 'slopchannel' };
    await markCreator(creator, 'block');
    await markCreator(creator, 'trust');

    const lists = await getPersonalLists();
    expect(lists.blockCreators).toEqual([]);
    expect(lists.trustCreators).toHaveLength(1);
  });

  it('removes a creator from both lists on "none", so the popup toggle can undo', async () => {
    const creator = { platform: 'youtube', handle: 'slopchannel' };
    await markCreator(creator, 'block');
    await markCreator(creator, 'none');

    const lists = await getPersonalLists();
    expect(lists.blockCreators).toEqual([]);
    expect(lists.trustCreators).toEqual([]);
  });

  it('adds and removes a single item', async () => {
    const item = { platform: 'youtube', id: 'dQw4w9WgXcQ', title: 'Rain' };
    await markItem(item, 'block');
    expect((await getPersonalLists()).blockItems).toHaveLength(1);

    await markItem(item, 'none');
    expect((await getPersonalLists()).blockItems).toEqual([]);
  });

  it('does not add the same item twice', async () => {
    const item = { platform: 'youtube', id: 'abc' };
    await markItem(item, 'block');
    await markItem({ ...item, title: 'a later title' }, 'block');
    expect((await getPersonalLists()).blockItems).toHaveLength(1);
  });

  // The regression this file was written for: a user clicking both quick-action
  // buttons in quick succession used to lose the first one, because each call
  // read the lists before the other had written them back.
  it('keeps both writes when a creator and an item are blocked concurrently', async () => {
    await Promise.all([
      markCreator({ platform: 'youtube', handle: 'slopchannel' }, 'block'),
      markItem({ platform: 'youtube', id: 'dQw4w9WgXcQ' }, 'block'),
    ]);

    const lists = await getPersonalLists();
    expect(lists.blockCreators).toHaveLength(1);
    expect(lists.blockItems).toHaveLength(1);
  });

  it('keeps every entry when many marks land at once', async () => {
    await Promise.all([
      markCreator({ platform: 'youtube', handle: 'one' }, 'block'),
      markCreator({ platform: 'youtube', handle: 'two' }, 'block'),
      markCreator({ platform: 'tiktok', handle: 'three' }, 'trust'),
      markItem({ platform: 'youtube', id: 'v1' }, 'block'),
      markItem({ platform: 'youtube', id: 'v2' }, 'block'),
    ]);

    const lists = await getPersonalLists();
    expect(lists.blockCreators).toHaveLength(2);
    expect(lists.trustCreators).toHaveLength(1);
    expect(lists.blockItems).toHaveLength(2);
  });
});
