// Signal providers. Each turns one kind of evidence into a PartialDetection,
// or null when it has nothing to say. Pure functions — no DOM writes, no I/O —
// so the confidence policy is unit-testable end to end.

import type { ProvenanceVerdict } from '../../proto';
import type { PageContext, PartialDetection } from '../../types';
import { inBundledCreatorList, inCreatorList, matchDomain } from '../../core/creators';
import { inItemList } from '../../core/items';
import { keywordConfidence, scoreKeywords } from '../../core/keywords';
import { t } from '../../core/i18n';
import type { MediaCandidate } from '../../adapters/types';

const PLATFORM_NAMES: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
};

function platformName(platform: string): string {
  return PLATFORM_NAMES[platform] ?? platform;
}

/** The platform said so itself: the strongest signal we have. */
export function platformLabelSignal(
  candidate: MediaCandidate,
  _ctx?: PageContext,
): PartialDetection | null {
  if (!candidate.platformLabel) return null;
  const { platform, label } = candidate.platformLabel;
  return {
    source: 'platform-label',
    confidence: 'confirmed',
    reason: t('reasonPlatformLabel', [platformName(platform), label]),
  };
}

/** The user's own decision about this author outranks every heuristic. */
export function userMarkedSignal(candidate: MediaCandidate, ctx: PageContext): PartialDetection | null {
  if (!candidate.creator) return null;
  if (!inCreatorList(candidate.creator, ctx.personalLists.blockCreators)) return null;
  return { source: 'user-marked', confidence: 'confirmed', reason: t('reasonUserMarked') };
}

/** The user blocked this exact video or post, rather than its author. */
export function userMarkedItemSignal(candidate: MediaCandidate, ctx: PageContext): PartialDetection | null {
  if (!candidate.itemRef) return null;
  if (!inItemList(candidate.itemRef, ctx.personalLists.blockItems)) return null;
  return { source: 'user-marked', confidence: 'confirmed', reason: t('reasonUserMarkedItem') };
}

/** The bundled/community list of accounts known for AI content. */
export function creatorListSignal(candidate: MediaCandidate, ctx: PageContext): PartialDetection | null {
  if (!candidate.creator) return null;
  if (!inBundledCreatorList(candidate.creator, ctx.lists.creators)) return null;
  return { source: 'creator-list', confidence: 'likely', reason: t('reasonCreatorList') };
}

export function keywordSignal(candidate: MediaCandidate, ctx: PageContext): PartialDetection | null {
  const { hits } = scoreKeywords(candidate.text, ctx.lists.keywords);
  const confidence = keywordConfidence(hits);
  if (!confidence) return null;
  return {
    source: 'keyword',
    confidence,
    reason: t('reasonKeyword', [hits.map((hit) => hit.term).join(', ')]),
  };
}

/** Turns a provenance verdict from the worker into a signal. */
export function provenanceSignal(verdict: ProvenanceVerdict | undefined): PartialDetection | null {
  if (!verdict) return null;

  const detail = verdict.detail ? ` (${verdict.detail})` : '';

  if (verdict.verdict === 'ai') {
    return verdict.source === 'iptc-metadata'
      ? { source: 'iptc-metadata', confidence: 'confirmed', reason: t('reasonIptc') }
      : { source: 'c2pa', confidence: 'confirmed', reason: t('reasonC2pa', [detail]) };
  }

  // A known AI tool signed the file but declared no AI action: strong, not proof.
  if (verdict.verdict === 'generator') {
    return { source: 'c2pa', confidence: 'likely', reason: t('reasonC2pa', [detail]) };
  }

  return null;
}

/** Whole-site block from the user's domain list. */
export function domainSignal(ctx: PageContext): PartialDetection | null {
  const domains = [...ctx.personalLists.blockDomains, ...ctx.lists.creators.domains];
  const matched = matchDomain(ctx.hostname, domains);
  if (!matched) return null;
  return { source: 'user-marked', confidence: 'confirmed', reason: t('reasonCreatorList') };
}

/**
 * True when the user has explicitly trusted this author.
 *
 * Blocking one video by an otherwise-trusted author is a narrower decision than
 * trusting the author, so it wins. Without this, "block this video" would do
 * nothing on a channel the user had trusted, with no indication why.
 */
export function isTrusted(candidate: MediaCandidate, ctx: PageContext): boolean {
  if (!candidate.creator) return false;
  if (candidate.itemRef && inItemList(candidate.itemRef, ctx.personalLists.blockItems)) return false;
  return inCreatorList(candidate.creator, ctx.personalLists.trustCreators);
}

/** All synchronous signals for one candidate. */
export function collectSignals(candidate: MediaCandidate, ctx: PageContext): PartialDetection[] {
  const signals: PartialDetection[] = [];
  const providers = [
    platformLabelSignal,
    userMarkedSignal,
    userMarkedItemSignal,
    creatorListSignal,
    keywordSignal,
  ];
  for (const provider of providers) {
    try {
      const signal = provider(candidate, ctx);
      if (signal) signals.push(signal);
    } catch (error) {
      console.warn('[slop-blocker] signal provider failed:', error);
    }
  }
  return signals;
}
