// Detection engine: runs the adapter, merges signals, drives the overlay,
// pauses video, and reports to the service worker.
//
// A scan is idempotent. It is safe (and expected) to call `scan()` on every
// mutation batch, scroll, navigation, and provenance reply — the engine
// reconciles the current DOM against the overlays that already exist rather
// than blocking things twice.

import { send, type ProvenanceVerdict } from '../proto';
import type { Detection, PageContext } from '../types';
import type { MediaCandidate, SiteAdapter } from '../adapters/types';
import { detectionId, pageKey } from '../core/hash';
import { shouldBlock, mergeSignals } from '../core/confidence';
import { t } from '../core/i18n';
import { Shroud } from './shroud';
import { collectSignals, domainSignal, isTrusted, provenanceSignal } from './providers/signals';

/** Window during which we undo one auto-resume after pausing (SPEC.md §3.2). */
const PAUSE_GUARD_MS = 5000;
/** Report detections in batches rather than one message per item. */
const REPORT_DEBOUNCE_MS = 300;
/** Only scan bytes for media within this many viewport heights. */
const VIEWPORT_MARGINS = 2;
/** How long after a navigation every scan re-reports its full set. */
const FORCE_REPORT_WINDOW_MS = 5000;

function nearViewport(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  if (!rect.width && !rect.height) return false;
  const margin = window.innerHeight * VIEWPORT_MARGINS;
  return rect.bottom > -margin && rect.top < window.innerHeight + margin;
}

/** Fields whose change is worth another message to the worker. */
function reportSignature(detection: Detection): string {
  return [
    detection.confidence,
    detection.blocked,
    detection.revealed,
    detection.reason,
    detection.source.join(','),
  ].join('|');
}

export class Engine {
  private ctx: PageContext;
  private readonly adapter: SiteAdapter;
  private readonly shroud: Shroud;

  private readonly detections = new Map<string, Detection>();
  private readonly candidates = new Map<string, MediaCandidate>();
  private readonly revealed = new Set<string>();
  private readonly reported = new Map<string, string>();

  private readonly provenance = new Map<string, ProvenanceVerdict>();
  private readonly provenanceRequested = new Set<string>();
  private readonly pauseGuarded = new WeakSet<HTMLVideoElement>();

  private pendingReports = new Map<string, Detection>();
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private lastContextTarget: Node | null = null;
  private scanning = false;
  /**
   * While set, every scan re-reports everything instead of only what changed.
   *
   * Around an in-page navigation the worker's tab state is cleared twice — once
   * by us, once by chrome.tabs.onUpdated seeing the new URL — and the second
   * one can land after we have already reported the new page's detections. The
   * post-navigation re-scans then repair the loss, but only if they are allowed
   * to send detections they consider unchanged.
   */
  private forceReportUntil = 0;

  constructor(ctx: PageContext, adapter: SiteAdapter) {
    this.ctx = ctx;
    this.adapter = adapter;
    this.shroud = new Shroud({
      onReveal: (id) => this.reveal(id),
      onTrustCreator: (id) => this.markCreator(id, 'trust'),
      onBlockCreator: (id) => this.markCreator(id, 'block'),
      onOpenSettings: () => void send({ t: 'options/open' }),
    });

    // Remember what was right-clicked so the context menu can act on it.
    document.addEventListener(
      'contextmenu',
      (event) => {
        this.lastContextTarget = event.target instanceof Node ? event.target : null;
      },
      true,
    );
  }

  get enabled(): boolean {
    const { settings } = this.ctx;
    if (!settings.enabled) return false;
    return !settings.disabledSites.includes(this.ctx.hostname.toLowerCase());
  }

  // -------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------

  scan(): void {
    if (this.scanning) return;
    this.scanning = true;
    try {
      this.runScan();
    } catch (error) {
      console.warn('[slop-blocker] scan failed:', error);
    } finally {
      this.scanning = false;
    }
  }

  private runScan(): void {
    if (!this.enabled) {
      this.shroud.destroy();
      return;
    }

    const keep = new Set<string>();
    const provenanceUrls: string[] = [];
    let confirmedBlocked = 0;

    let candidates: MediaCandidate[] = [];
    try {
      candidates = this.adapter.candidates(document, this.ctx);
    } catch (error) {
      console.warn(`[slop-blocker] adapter ${this.adapter.id} failed:`, error);
    }

    for (const candidate of candidates) {
      const id = detectionId(this.ctx.href, candidate.key);
      this.candidates.set(id, candidate);

      if (isTrusted(candidate, this.ctx)) {
        this.shroud.remove(id);
        continue;
      }

      const signals = collectSignals(candidate, this.ctx);

      if (candidate.provenanceUrl) {
        const verdict = this.provenance.get(candidate.provenanceUrl);
        if (verdict) {
          const signal = provenanceSignal(verdict);
          if (signal) signals.push(signal);
        } else if (
          !this.provenanceRequested.has(candidate.provenanceUrl) &&
          nearViewport(candidate.element)
        ) {
          provenanceUrls.push(candidate.provenanceUrl);
        }
      }

      const merged = mergeSignals(signals);
      if (!merged) {
        this.shroud.remove(id);
        continue;
      }

      const blocked = shouldBlock(merged.confidence, this.ctx.settings.threshold);
      const previous = this.detections.get(id);
      const detection: Detection = {
        id,
        // The worker fills in the real tab id; a content script cannot know it.
        tabId: 0,
        url: pageKey(this.ctx.href),
        mediaType: candidate.mediaType,
        source: merged.source,
        confidence: merged.confidence,
        reason: merged.reason,
        detectedAt: previous?.detectedAt ?? Date.now(),
        revealed: this.revealed.has(id),
        blocked,
      };
      if (candidate.mediaUrl) detection.mediaUrl = candidate.mediaUrl;
      if (candidate.creator) detection.creator = candidate.creator;

      if (detection.revealed) {
        this.shroud.remove(id);
        this.record(detection);
        continue;
      }

      keep.add(id);
      if (blocked) {
        this.shroud.block(candidate.element, detection);
        if (candidate.video && this.pauseVideo(candidate.video, id)) detection.pausedVideo = true;
        if (detection.confidence === 'confirmed') confirmedBlocked++;
      } else {
        this.shroud.chip(candidate.element, detection);
      }
      this.record(detection);
    }

    const pageId = this.applyPageLevel(confirmedBlocked);
    if (pageId) keep.add(pageId);

    this.shroud.retain(keep);
    if (provenanceUrls.length) void this.requestProvenance(provenanceUrls);
  }

  /** Blocks the whole page when the domain is listed, or too much of it is AI. */
  private applyPageLevel(confirmedBlocked: number): string | null {
    const { settings } = this.ctx;
    const domain = domainSignal(this.ctx);
    const overThreshold = settings.wholePageMode && confirmedBlocked >= settings.wholePageThreshold;
    if (!domain && !overThreshold) return null;

    const id = detectionId(this.ctx.href, 'page');
    if (this.revealed.has(id)) return null;

    const previous = this.detections.get(id);
    const detection: Detection = {
      id,
      tabId: 0,
      url: pageKey(this.ctx.href),
      mediaType: 'page',
      // No source when the page was blocked for aggregate reasons rather than
      // one signal firing on it.
      source: domain ? [domain.source] : [],
      confidence: 'confirmed',
      reason: domain?.reason ?? t('shroudPagePrefix'),
      detectedAt: previous?.detectedAt ?? Date.now(),
      revealed: false,
      blocked: true,
    };

    this.shroud.page(detection);
    this.record(detection);
    return id;
  }

  private async requestProvenance(urls: string[]): Promise<void> {
    for (const url of urls) this.provenanceRequested.add(url);

    const reply = await send({ t: 'provenance/check', urls });
    if (!reply?.results) return;

    let changed = false;
    for (const [url, verdict] of Object.entries(reply.results)) {
      this.provenance.set(url, verdict);
      if (verdict.verdict === 'ai' || verdict.verdict === 'generator') changed = true;
    }
    // Only re-scan when a result could actually promote something.
    if (changed) this.scan();
  }

  // -------------------------------------------------------------------------
  // User actions
  // -------------------------------------------------------------------------

  reveal(id: string): void {
    this.revealed.add(id);
    this.shroud.reveal(id);

    const detection = this.detections.get(id);
    if (detection) {
      detection.revealed = true;
      this.record(detection);
    }
    void send({ t: 'detections/revealed', id });
  }

  /** Applies a reveal requested from the popup, without echoing it back. */
  applyRemoteReveal(id: string): void {
    this.revealed.add(id);
    this.shroud.reveal(id);
    const detection = this.detections.get(id);
    if (detection) detection.revealed = true;
  }

  private markCreator(id: string, verdict: 'block' | 'trust'): void {
    const creator = this.candidates.get(id)?.creator;
    if (!creator) return;

    // Update the local copy first so the UI reacts immediately; the worker
    // broadcasts the authoritative lists back to every tab right after.
    if (verdict === 'trust') {
      this.ctx.personalLists.trustCreators.push(creator);
      this.revealed.add(id);
      this.shroud.reveal(id);
      void send({ t: 'detections/revealed', id });
    } else {
      this.ctx.personalLists.blockCreators.push(creator);
    }

    void send({ t: 'lists/markCreator', creator, verdict });
    this.scan();
  }

  /** Handles the context-menu action on whatever the user right-clicked. */
  markContextTarget(verdict: 'block' | 'trust'): void {
    const target = this.lastContextTarget;
    if (!target) return;

    for (const [id, candidate] of this.candidates) {
      if (candidate.element === target || candidate.element.contains(target)) {
        this.markCreator(id, verdict);
        return;
      }
    }
  }

  updateContext(settings: PageContext['settings'], personalLists: PageContext['personalLists']): void {
    this.ctx = { ...this.ctx, settings, personalLists };
    this.scan();
  }

  /** Called on SPA navigation: the page identity changed, so ids do too. */
  navigated(href: string): void {
    this.ctx = { ...this.ctx, href };
    this.detections.clear();
    this.candidates.clear();
    this.reported.clear();
    this.pendingReports.clear();
    this.shroud.retain(new Set());
    this.forceReportUntil = Date.now() + FORCE_REPORT_WINDOW_MS;
    this.scan();
  }

  destroy(): void {
    this.shroud.destroy();
    if (this.reportTimer !== null) clearTimeout(this.reportTimer);
  }

  // -------------------------------------------------------------------------
  // Video pausing
  // -------------------------------------------------------------------------

  /**
   * Pauses a blocked video and undoes one auto-resume.
   * @returns whether we actually stopped playback.
   */
  private pauseVideo(video: HTMLVideoElement, id: string): boolean {
    if (!this.ctx.settings.autoPauseVideos) return false;

    let didPause = false;
    try {
      if (!video.paused) {
        video.pause();
        didPause = true;
      }
    } catch {
      return false;
    }

    if (!this.pauseGuarded.has(video)) {
      this.pauseGuarded.add(video);
      // Platforms often resume once after an external pause. Undo exactly one
      // such resume, and never fight the user after they reveal the video.
      const onPlay = () => {
        if (this.revealed.has(id)) return;
        try {
          video.pause();
        } catch {
          // Element detached mid-playback.
        }
      };
      video.addEventListener('play', onPlay, { once: true });
      setTimeout(() => video.removeEventListener('play', onPlay), PAUSE_GUARD_MS);
    }

    return didPause;
  }

  // -------------------------------------------------------------------------
  // Reporting
  // -------------------------------------------------------------------------

  private record(detection: Detection): void {
    this.detections.set(detection.id, detection);

    const signature = reportSignature(detection);
    const forcing = Date.now() < this.forceReportUntil;
    if (!forcing && this.reported.get(detection.id) === signature) return;
    this.reported.set(detection.id, signature);
    this.pendingReports.set(detection.id, { ...detection });

    if (this.reportTimer !== null) return;
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      void this.flushReports();
    }, REPORT_DEBOUNCE_MS);
  }

  private async flushReports(): Promise<void> {
    if (this.pendingReports.size === 0) return;
    const detections = [...this.pendingReports.values()];
    this.pendingReports = new Map();
    await send({ t: 'detections/report', detections });
  }
}
