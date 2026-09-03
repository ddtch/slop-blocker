# TikTok adapter notes

**Selectors last touched:** 2026-09-03
**Verified against a live page:** no.

## Why this platform is the easy one

TikTok reads C2PA Content Credentials on upload and labels AI content itself,
without waiting for the creator to disclose. When the badge is there, it is
there for everyone — no locale-specific creator behaviour to guess at.

## Before you trust this

`BADGE` is the whole adapter. Verify it on a real labelled video:

1. Find a video showing the AI-generated badge.
2. Inspect the badge element. Record its `data-e2e` value (or `aria-label`) in
   `selectors.ts`, and drop the `[class*=...]` fallbacks once a stable hook is
   confirmed — obfuscated class names change constantly.
3. Confirm the badge wording in `en` and `ru` and update
   `lists/disclosure-strings.json`.

## Not implemented yet

- **`__UNIVERSAL_DATA_FOR_REHYDRATION__` / `SIGI_STATE`.** TikTok ships a page
  JSON blob that appears to carry an AIGC label field. Reading it would give a
  pre-render signal the way `ytInitialPlayerResponse` does on YouTube, and would
  survive badge markup changes. It needs a `MAIN`-world script like the YouTube
  one plus a live session to pin the field name. Worth doing.

## Rules for edits

- Never add `CAPTION` selectors to `BADGE`. Captions are creator free text, and
  matching disclosure strings there would block every video that merely talks
  about AI.
- Feed videos stream in fragments, so provenance byte scanning is skipped for
  them (`badge-adapter.ts` only scans images). Do not "fix" this by fetching
  video URLs — it would download media the user never asked for.
