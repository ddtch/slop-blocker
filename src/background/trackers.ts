// Tracker counting and (optional) blocking.
//
// Counting is observational: content scripts report the hostnames the page
// actually loaded and we match them against the bundled list. Blocking uses
// declarativeNetRequest dynamic rules.
//
// Honest limitation: in "block" mode the blocked requests never reach the page,
// so they never show up in resource timing and are NOT counted. Counting the
// blocked ones would need the declarativeNetRequestFeedback permission, whose
// install-time warning ("read your browsing history") is not worth a counter.
// The popup therefore says "found", not "blocked".

import type { TrackerMode } from '../types';
import { compileTrackerSet, matchTracker } from '../core/trackers';
import { loadTrackerDomains } from './storage';

/** Reserved dynamic-rule id range, so we never disturb rules we did not add. */
const RULE_ID_BASE = 1000;
const DOMAINS_PER_RULE = 500;

/**
 * Everything except `main_frame`. The API takes plain strings; @types/chrome
 * models them as a TypeScript enum, hence the cast.
 */
const BLOCKED_RESOURCE_TYPES = [
  'script',
  'image',
  'xmlhttprequest',
  'sub_frame',
  'ping',
  'media',
  'stylesheet',
  'font',
  'object',
  'csp_report',
  'websocket',
  'other',
] as unknown as chrome.declarativeNetRequest.ResourceType[];

const ACTION_BLOCK = 'block' as unknown as chrome.declarativeNetRequest.RuleActionType;
const DOMAIN_THIRD_PARTY = 'thirdParty' as unknown as chrome.declarativeNetRequest.DomainType;

let trackerSet: Set<string> | null = null;

export async function getTrackerSet(): Promise<Set<string>> {
  if (trackerSet) return trackerSet;
  trackerSet = compileTrackerSet(await loadTrackerDomains());
  return trackerSet;
}

/** Maps reported hostnames to the tracker-list entries they matched. */
export async function matchHostnames(hostnames: string[]): Promise<string[]> {
  const set = await getTrackerSet();
  const matched: string[] = [];
  for (const hostname of hostnames) {
    const domain = matchTracker(hostname, set);
    if (domain) matched.push(domain);
  }
  return matched;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Installs or removes the blocking rules to match the current setting. */
export async function syncTrackerRules(mode: TrackerMode): Promise<void> {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;

  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.map((rule) => rule.id).filter((id) => id >= RULE_ID_BASE);

    if (mode !== 'block') {
      if (removeRuleIds.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
      }
      return;
    }

    const domains = [...(await getTrackerSet())];
    const addRules: chrome.declarativeNetRequest.Rule[] = chunk(domains, DOMAINS_PER_RULE).map(
      (group, index) => ({
        id: RULE_ID_BASE + index,
        priority: 1,
        action: { type: ACTION_BLOCK },
        condition: {
          requestDomains: group,
          // Never block the page the user actually asked for.
          domainType: DOMAIN_THIRD_PARTY,
          resourceTypes: BLOCKED_RESOURCE_TYPES,
        },
      }),
    );

    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (error) {
    console.warn('[slop-blocker] could not sync tracker rules:', error);
  }
}
