# YouTube adapter notes

**Selectors last touched:** 2026-09-03
**Verified against a live page:** no — see "Before you trust this" below.

## How detection works

Two independent paths feed one decision. Either can break without taking the
other down:

1. **Player response (`main-world.ts`).** A `MAIN`-world script at
   `document_start` hooks the assignment to `window.ytInitialPlayerResponse`,
   walks it, and reports a small summary of keys whose *names* mention
   synthetic / altered / AI-generated content. It never ships the response
   itself across worlds. This path fires before playback, which is what makes
   auto-pause feel instant.
2. **Rendered DOM (`selectors.ts` → `DISCLOSURE_CONTAINERS`).** The disclosure
   row under the description, and the player-attached label YouTube adds for
   sensitive topics.

## Before you trust this

`ytInitialPlayerResponse` field names for the disclosure are **not** pinned
here on purpose, and the DOM selectors were written from public documentation
rather than a live session. Do this once before shipping:

1. Open a real video that carries the disclosure. Public examples change; find
   one by filtering for the label in the expanded description.
2. In the console: `JSON.stringify(ytInitialPlayerResponse).match(/.{0,80}ynthetic.{0,80}/g)`
   and the same for `ltered`. Write down the real key paths in this file.
3. Inspect the disclosure row and the player label, and correct
   `DISCLOSURE_CONTAINERS`.
4. Confirm the exact disclosure wording in both `en` and `ru` interface
   languages and put it in `lists/disclosure-strings.json`, then set
   `_meta.lastVerified` there.

## Rules for edits

- **Never** add `#description` or a title selector to `DISCLOSURE_CONTAINERS`.
  Those hold creator free text, so a video *about* AI labelling would block
  itself. Keyword scoring already reads the title and description, and it
  cannot block on prose alone by design.
- Prefer stable hooks in this order: `data-*` attributes → `aria-label` →
  element/custom-element names → CSS classes. Class names churn every few
  weeks; treat any `[class*=...]` selector as a temporary patch.
- Keep the JSON path search generic (match on key *names*, not fixed deep
  paths) so a reshuffle inside the response does not silently disable it.
- If YouTube starts auto-resuming after our pause, adjust the guard window in
  `src/content/engine.ts` (`PAUSE_GUARD_MS`) rather than adding a second
  observer here.
