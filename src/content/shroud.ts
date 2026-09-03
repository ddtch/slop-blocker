// The blocking overlay ("shroud") and the suspected-tier chip.
//
// Positioning: each overlay is a fixed-position host appended to <body> and
// kept aligned with its target's bounding box. The alternative — inserting into
// the media's ancestor — needs that ancestor to be positioned, which means
// mutating the page's layout and guessing at containers that differ on every
// site. Fixed positioning costs a sync pass but never touches page layout.
//
// Everything lives in a closed shadow root, and all page-derived text (reason
// strings contain platform labels and matched keywords) is written with
// textContent — never innerHTML.

import type { Detection } from '../types';
import { confidenceLabel, t } from '../core/i18n';
import { SHROUD_CSS } from './shroud-styles';

const Z_INDEX = '2147483000';
/** Give up re-inserting after this many removals by the page, then blur only. */
const MAX_REINSERTS = 3;
const SYNC_INTERVAL_MS = 500;

const COMPACT_WIDTH = 260;
const COMPACT_HEIGHT = 170;
const TINY_WIDTH = 130;
const TINY_HEIGHT = 90;

export interface ShroudHandlers {
  onReveal(id: string): void;
  onTrustCreator(id: string): void;
  onBlockCreator(id: string): void;
  onOpenSettings(): void;
}

type Mode = 'block' | 'chip' | 'page';

interface Instance {
  id: string;
  mode: Mode;
  target: HTMLElement;
  host: HTMLDivElement;
  root: HTMLDivElement;
  /** Inline styles we overwrote, so reveal can restore them exactly. */
  previousFilter: string | null;
  previousClipPath: string;
  reinserts: number;
  blurOnly: boolean;
  lastGeometry: string;
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function svg(paths: string[], viewBox = '0 0 24 24'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const root = document.createElementNS(ns, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('fill', 'none');
  root.setAttribute('stroke', 'currentColor');
  root.setAttribute('stroke-width', '2');
  root.setAttribute('stroke-linecap', 'round');
  root.setAttribute('stroke-linejoin', 'round');
  root.setAttribute('aria-hidden', 'true');
  for (const definition of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', definition);
    root.appendChild(path);
  }
  return root;
}

/** Circle with a diagonal slash, matching the extension icon. */
function blockedMark(): SVGSVGElement {
  return svg(['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M5.6 18.4 18.4 5.6']);
}

function gearMark(): SVGSVGElement {
  return svg([
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    'M12 2.5v2m0 15v2m7.1-16.6-1.4 1.4M6.3 17.7l-1.4 1.4M21.5 12h-2m-15 0h-2m16.6 7.1-1.4-1.4M6.3 6.3 4.9 4.9',
  ]);
}

export class Shroud {
  private readonly instances = new Map<string, Instance>();
  private readonly handlers: ShroudHandlers;
  private frame: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listening = false;

  constructor(handlers: ShroudHandlers) {
    this.handlers = handlers;
    this.markDirty = this.markDirty.bind(this);
  }

  has(id: string): boolean {
    return this.instances.has(id);
  }

  /** Covers the target and blurs it as a second layer. */
  block(target: HTMLElement, detection: Detection): void {
    const existing = this.instances.get(detection.id);
    if (existing) {
      if (existing.mode === 'block' && existing.target === target) {
        this.renderBlock(existing, detection);
        return;
      }
      this.destroyInstance(existing);
    }

    const instance = this.createInstance(detection.id, 'block', target);
    this.applyBlur(instance);
    this.renderBlock(instance, detection);
    this.schedule();
  }

  /** Covers the whole viewport: the page itself is the blocked thing. */
  page(detection: Detection): void {
    if (this.instances.has(detection.id)) return;
    const instance = this.createInstance(detection.id, 'page', document.documentElement);
    this.renderBlock(instance, detection, true);
    this.schedule();
  }

  /** Small corner chip for suspected detections; leaves the media visible. */
  chip(target: HTMLElement, detection: Detection): void {
    const existing = this.instances.get(detection.id);
    if (existing) {
      if (existing.mode === 'chip' && existing.target === target) return;
      this.destroyInstance(existing);
    }

    const instance = this.createInstance(detection.id, 'chip', target);
    this.renderChip(instance, detection);
    this.schedule();
  }

  reveal(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    this.restoreBlur(instance);
    instance.root.classList.add('sb-root--leaving');
    const remove = () => this.destroyInstance(instance);
    setTimeout(remove, 160);
  }

  remove(id: string): void {
    const instance = this.instances.get(id);
    if (instance) this.destroyInstance(instance);
  }

  /** Drops overlays whose detection is no longer active. */
  retain(activeIds: Set<string>): void {
    for (const instance of [...this.instances.values()]) {
      if (!activeIds.has(instance.id)) this.destroyInstance(instance);
    }
  }

  destroy(): void {
    for (const instance of [...this.instances.values()]) this.destroyInstance(instance);
    this.stopListening();
  }

  // -------------------------------------------------------------------------

  private createInstance(id: string, mode: Mode, target: HTMLElement): Instance {
    const host = element('div');
    host.style.cssText = `position:fixed;left:0;top:0;margin:0;padding:0;border:0;z-index:${Z_INDEX};`;
    host.setAttribute('data-slop-blocker', mode);

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = SHROUD_CSS;
    shadow.appendChild(style);

    const root = element('div', mode === 'chip' ? 'sb-root sb-root--chip' : 'sb-root');
    // Match the media's corners so the overlay does not look pasted on.
    try {
      host.style.borderRadius = getComputedStyle(target).borderRadius;
    } catch {
      // Detached or cross-document target; the default square corners are fine.
    }
    shadow.appendChild(root);

    const instance: Instance = {
      id,
      mode,
      target,
      host,
      root,
      previousFilter: null,
      previousClipPath: '',
      reinserts: 0,
      blurOnly: false,
      lastGeometry: '',
    };

    this.parentFor(target).appendChild(host);
    this.instances.set(id, instance);
    this.startListening();
    this.position(instance);
    return instance;
  }

  private destroyInstance(instance: Instance): void {
    this.restoreBlur(instance);
    instance.host.remove();
    this.instances.delete(instance.id);
    if (this.instances.size === 0) this.stopListening();
  }

  private applyBlur(instance: Instance): void {
    if (instance.previousFilter !== null) return;
    try {
      instance.previousFilter = instance.target.style.filter || '';
      instance.previousClipPath = instance.target.style.clipPath || '';
      instance.target.style.filter = 'blur(24px)';
      // A blur filter spreads well past the element's box and would smear over
      // whatever sits next to it. Clipping to the border box contains it.
      instance.target.style.clipPath = 'inset(0)';
    } catch {
      instance.previousFilter = null;
    }
  }

  private restoreBlur(instance: Instance): void {
    if (instance.previousFilter === null) return;
    try {
      instance.target.style.filter = instance.previousFilter;
      instance.target.style.clipPath = instance.previousClipPath;
    } catch {
      // Target is gone; nothing to restore.
    }
    instance.previousFilter = null;
  }

  private renderBlock(instance: Instance, detection: Detection, pageLevel = false): void {
    const { root } = instance;
    root.textContent = '';

    root.appendChild(element('div', 'sb-backdrop'));

    const panel = element('div', 'sb-panel');
    const mark = element('div', 'sb-mark');
    mark.appendChild(blockedMark());
    panel.appendChild(mark);

    panel.appendChild(element('div', 'sb-title', pageLevel ? t('shroudPagePrefix') : t('shroudTitle')));
    if (detection.reason) panel.appendChild(element('div', 'sb-reason', detection.reason));

    const meta = element('div', 'sb-meta');
    const tier = element(
      'span',
      `sb-tier sb-tier--${detection.confidence}`,
      confidenceLabel(detection.confidence),
    );
    meta.appendChild(tier);
    panel.appendChild(meta);

    const actions = element('div', 'sb-actions');
    const show = element(
      'button',
      'sb-btn sb-btn--primary',
      pageLevel ? t('shroudPageContinue') : t('shroudShow'),
    );
    show.type = 'button';
    show.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onReveal(instance.id);
    });
    actions.appendChild(show);

    if (detection.creator) {
      const trust = element('button', 'sb-btn', t('shroudTrustCreator'));
      trust.type = 'button';
      trust.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onTrustCreator(instance.id);
      });
      actions.appendChild(trust);
    }
    panel.appendChild(actions);
    root.appendChild(panel);

    const settings = element('button', 'sb-settings');
    settings.type = 'button';
    settings.title = t('shroudSettings');
    settings.setAttribute('aria-label', t('shroudSettings'));
    settings.appendChild(gearMark());
    settings.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.handlers.onOpenSettings();
    });
    root.appendChild(settings);

    // Clicks must never reach the media underneath (play buttons, links).
    root.addEventListener('click', (event) => event.stopPropagation());
  }

  private renderChip(instance: Instance, detection: Detection): void {
    const { root } = instance;
    root.textContent = '';

    const wrapper = element('div', 'sb-chip-root');
    const chip = element('div', 'sb-chip');
    chip.appendChild(element('span', 'sb-chip-dot'));
    chip.appendChild(element('span', undefined, t('shroudTitleSuspected')));
    chip.title = detection.reason;

    const menu = element('div', 'sb-menu');
    if (detection.reason) menu.appendChild(element('div', 'sb-menu-reason', detection.reason));

    const blockIt = element('button', 'sb-menu-item', t('shroudBlockIt'));
    blockIt.type = 'button';
    blockIt.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onBlockCreator(instance.id);
    });
    menu.appendChild(blockIt);

    const ignore = element('button', 'sb-menu-item', t('shroudIgnore'));
    ignore.type = 'button';
    ignore.addEventListener('click', (event) => {
      event.stopPropagation();
      this.handlers.onReveal(instance.id);
    });
    menu.appendChild(ignore);

    if (detection.creator) {
      const trust = element('button', 'sb-menu-item', t('shroudTrustCreator'));
      trust.type = 'button';
      trust.addEventListener('click', (event) => {
        event.stopPropagation();
        this.handlers.onTrustCreator(instance.id);
      });
      menu.appendChild(trust);
    }

    chip.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.toggle('sb-menu--open');
    });

    wrapper.appendChild(chip);
    wrapper.appendChild(menu);
    root.appendChild(wrapper);
  }

  // -------------------------------------------------------------------------
  // Geometry sync
  // -------------------------------------------------------------------------

  private parentFor(target: HTMLElement): HTMLElement {
    const fullscreen = document.fullscreenElement;
    // In fullscreen only the fullscreen subtree renders, so the overlay has to
    // live inside it to stay visible.
    if (fullscreen instanceof HTMLElement && fullscreen.contains(target)) return fullscreen;
    return document.body ?? document.documentElement;
  }

  private position(instance: Instance): void {
    const { target, host, root } = instance;

    if (!target.isConnected) {
      this.destroyInstance(instance);
      return;
    }

    const desiredParent = this.parentFor(target);
    if (!host.isConnected) {
      if (instance.reinserts >= MAX_REINSERTS) {
        // The page keeps deleting our node; stop fighting and rely on the blur.
        instance.blurOnly = true;
        return;
      }
      instance.reinserts++;
      desiredParent.appendChild(host);
    } else if (host.parentElement !== desiredParent) {
      desiredParent.appendChild(host);
    }

    if (instance.mode === 'page') {
      // Fixed positioning makes percentages resolve against the viewport.
      host.style.display = '';
      host.style.left = '0';
      host.style.top = '0';
      host.style.width = '100%';
      host.style.height = '100%';
      return;
    }

    const rect = target.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) {
      host.style.display = 'none';
      return;
    }

    const geometry = `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    if (geometry === instance.lastGeometry && host.style.display !== 'none') return;
    instance.lastGeometry = geometry;

    host.style.display = '';
    host.style.left = `${rect.left}px`;
    host.style.top = `${rect.top}px`;
    host.style.width = `${rect.width}px`;
    host.style.height = `${rect.height}px`;

    if (instance.mode === 'block') {
      root.classList.toggle(
        'sb-root--compact',
        rect.width < COMPACT_WIDTH || rect.height < COMPACT_HEIGHT,
      );
      root.classList.toggle('sb-root--tiny', rect.width < TINY_WIDTH || rect.height < TINY_HEIGHT);
    }
  }

  private markDirty(): void {
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== null || this.instances.size === 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      for (const instance of [...this.instances.values()]) {
        try {
          this.position(instance);
        } catch (error) {
          console.warn('[slop-blocker] overlay sync failed:', error);
        }
      }
    });
  }

  private startListening(): void {
    if (this.listening) return;
    this.listening = true;
    // Capture phase catches scrolling inside nested containers too.
    window.addEventListener('scroll', this.markDirty, { capture: true, passive: true });
    window.addEventListener('resize', this.markDirty, { passive: true });
    document.addEventListener('fullscreenchange', this.markDirty, true);
    // Layout can change with no event at all (lazy images, CSS animations).
    this.timer = setInterval(this.markDirty, SYNC_INTERVAL_MS);
  }

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('scroll', this.markDirty, { capture: true });
    window.removeEventListener('resize', this.markDirty);
    document.removeEventListener('fullscreenchange', this.markDirty, true);
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
    }
  }
}
