import type { Confidence, PartialDetection, SignalSource, Threshold } from '../types';

const RANK: Record<Confidence, number> = { suspected: 1, likely: 2, confirmed: 3 };

export function rank(confidence: Confidence): number {
  return RANK[confidence];
}

export function highest(a: Confidence, b: Confidence): Confidence {
  return RANK[a] >= RANK[b] ? a : b;
}

/** A detection is blocked when it is at least as confident as the user's threshold. */
export function shouldBlock(confidence: Confidence, threshold: Threshold): boolean {
  return RANK[confidence] >= RANK[threshold];
}

export interface MergedSignals {
  source: SignalSource[];
  confidence: Confidence;
  reason: string;
}

/**
 * Combines every signal that fired on one element.
 *
 * Confidence is the highest any single signal justifies — signals do not stack
 * into a higher tier, because two weak guesses are still a guess. The reason
 * string leads with the strongest signal so the shroud shows the best evidence.
 */
export function mergeSignals(partials: PartialDetection[]): MergedSignals | null {
  if (partials.length === 0) return null;

  const ordered = [...partials].sort((a, b) => RANK[b.confidence] - RANK[a.confidence]);
  const sources: SignalSource[] = [];
  for (const partial of ordered) {
    if (!sources.includes(partial.source)) sources.push(partial.source);
  }

  const reasons: string[] = [];
  for (const partial of ordered) {
    if (partial.reason && !reasons.includes(partial.reason)) reasons.push(partial.reason);
  }

  return {
    source: sources,
    confidence: ordered[0]!.confidence,
    reason: reasons.join(' · '),
  };
}
