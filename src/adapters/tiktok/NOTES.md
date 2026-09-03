# TikTok adapter notes

**Selectors last touched:** 2026-09-03
**Verified against a live page:** no.

## Why this platform is the easy one

TikTok reads C2PA Content Credentials on upload and labels AI content itself,
without waiting for the creator to disclose. When the badge is there, it is
there for everyone — no locale-specific creator behaviour to guess at.

## What a live page has told us so far (2026-09-03)

One screenshot of a real, labelled video page:

- The badge reads **"Contains AI-generated media"**, bottom-left of the video,
  under the caption. That string is now in `lists/disclosure-strings.json` and
  is the only entry in that file confirmed against a live page.
- We detected **nothing** on that page. The badge was visible and the popup said
  "Nothing detected here", so either no `ITEM` matched (most likely — the
  single-video page shares no container with the feed) or no `BADGE` did.
- The URL was `tiktok.com/@handle/video/<id>`, which the quick actions now read.

Since then the adapter falls back to "the video filling the viewport, and the
nearest ancestor that names an author" whenever no `ITEM` selector matches, so
the badge is read even from containers we cannot name. That is a safety net, not
a fix: it only finds one post, so a page where `ITEM` is wrong is covered far
less well than one where it is right.

**Still needed, and it is one console command on that page:**

```js
const el = [...document.querySelectorAll('*')]
  .find((n) => n.childElementCount === 0 && /contains ai-generated/i.test(n.textContent || ''));
let node = el, out = [];
for (let i = 0; node && i < 8; i++, node = node.parentElement) {
  out.push({ tag: node.tagName, cls: node.className, e2e: node.dataset?.e2e, aria: node.getAttribute('aria-label') });
}
copy(JSON.stringify(out, null, 2));
```

That gives the badge's own hooks and seven ancestors, which is everything needed
to replace the guesses in `BADGE` and `ITEM` with one verified selector each and
set `LAST_VERIFIED`.

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
