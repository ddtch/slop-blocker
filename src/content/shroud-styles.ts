// Styles for the blocking overlay, adopted into a closed shadow root.
//
// Kept as a TypeScript template literal rather than a .css file so exactly one
// bundler rule applies to it (none) and the unit tests can import it as-is.
// Every value is explicit because `all: initial` on the host means there is no
// inherited cascade to rely on, and no page CSS can reach in.

export const SHROUD_CSS = `
/* Styles for the blocking overlay. Injected into a closed shadow root, so
   nothing here can leak out and no page CSS can reach in. Every value is
   explicit for that reason — there is no inherited cascade to rely on. */

:host {
  all: initial;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.sb-root {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  color: #f4f4f5;
  overflow: hidden;
  border-radius: inherit;
  animation: sb-fade-in 160ms ease-out both;
}

.sb-root--leaving {
  animation: sb-fade-out 150ms ease-in both;
}

@keyframes sb-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes sb-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

/* --- blocking panel --- */

.sb-backdrop {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(120% 120% at 50% 0%, rgba(225, 29, 72, 0.22), transparent 60%),
    rgba(9, 9, 12, 0.86);
  backdrop-filter: blur(14px) saturate(0.7);
  -webkit-backdrop-filter: blur(14px) saturate(0.7);
}

.sb-panel {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: min(420px, 88%);
  padding: 22px 24px;
  text-align: center;
}

.sb-mark {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: rgba(225, 29, 72, 0.16);
  border: 1px solid rgba(225, 29, 72, 0.5);
  color: #fb7185;
  flex: none;
}

.sb-mark svg {
  width: 22px;
  height: 22px;
  display: block;
}

.sb-title {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
}

.sb-reason {
  font-size: 12.5px;
  color: #a1a1aa;
  max-height: 3.2em;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.sb-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #71717a;
}

.sb-tier {
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(244, 244, 245, 0.16);
  text-transform: lowercase;
}

.sb-tier--confirmed {
  color: #fda4af;
  border-color: rgba(251, 113, 133, 0.4);
}

.sb-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}

.sb-btn {
  font: inherit;
  font-size: 13px;
  font-weight: 550;
  padding: 8px 15px;
  border-radius: 9px;
  border: 1px solid rgba(244, 244, 245, 0.18);
  background: rgba(244, 244, 245, 0.06);
  color: #f4f4f5;
  cursor: pointer;
  transition:
    background 120ms ease,
    border-color 120ms ease,
    transform 80ms ease;
}

.sb-btn:hover {
  background: rgba(244, 244, 245, 0.13);
  border-color: rgba(244, 244, 245, 0.3);
}

.sb-btn:active {
  transform: translateY(1px);
}

.sb-btn:focus-visible {
  outline: 2px solid #fb7185;
  outline-offset: 2px;
}

.sb-btn--primary {
  background: #e11d48;
  border-color: #e11d48;
  color: #fff;
}

.sb-btn--primary:hover {
  background: #f43f5e;
  border-color: #f43f5e;
}

.sb-settings {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 7px;
  background: rgba(244, 244, 245, 0.08);
  color: #d4d4d8;
  cursor: pointer;
}

.sb-settings:hover {
  background: rgba(244, 244, 245, 0.16);
  color: #fff;
}

.sb-settings svg {
  width: 14px;
  height: 14px;
}

/* Small media: drop everything but the mark and the primary action. */
.sb-root--compact .sb-panel {
  gap: 7px;
  padding: 10px;
}

.sb-root--compact .sb-title {
  font-size: 13px;
}

.sb-root--compact .sb-reason,
.sb-root--compact .sb-meta,
.sb-root--compact .sb-settings {
  display: none;
}

.sb-root--compact .sb-btn {
  padding: 6px 11px;
  font-size: 12px;
}

.sb-root--compact .sb-mark {
  width: 30px;
  height: 30px;
}

.sb-root--tiny .sb-title,
.sb-root--tiny .sb-mark {
  display: none;
}

.sb-root--tiny .sb-panel {
  padding: 4px;
}

.sb-root--tiny .sb-btn {
  padding: 4px 8px;
  font-size: 11px;
}

/* --- suspected chip --- */

/* The chip must not swallow interaction with the media it sits on. */
.sb-root--chip {
  pointer-events: none;
}

.sb-root--chip .sb-chip,
.sb-root--chip .sb-menu {
  pointer-events: auto;
}

.sb-chip-root {
  position: absolute;
  top: 8px;
  left: 8px;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
}

.sb-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 9px;
  border-radius: 999px;
  border: 1px solid rgba(245, 158, 11, 0.55);
  background: rgba(20, 15, 5, 0.82);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  color: #fcd34d;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}

.sb-chip:hover {
  border-color: #f59e0b;
}

.sb-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #f59e0b;
  flex: none;
}

.sb-menu {
  display: none;
  position: absolute;
  top: 26px;
  left: 0;
  min-width: 168px;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid rgba(244, 244, 245, 0.14);
  background: rgba(12, 12, 16, 0.96);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}

.sb-menu--open {
  display: block;
}

.sb-menu-reason {
  padding: 5px 8px 7px;
  font-size: 11px;
  color: #a1a1aa;
  overflow-wrap: anywhere;
}

.sb-menu-item {
  display: block;
  width: 100%;
  font: inherit;
  font-size: 12.5px;
  text-align: left;
  padding: 7px 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #f4f4f5;
  cursor: pointer;
}

.sb-menu-item:hover {
  background: rgba(244, 244, 245, 0.1);
}

@media (prefers-reduced-motion: reduce) {
  .sb-root,
  .sb-root--leaving {
    animation: none;
  }

  .sb-btn {
    transition: none;
  }
}
`;
