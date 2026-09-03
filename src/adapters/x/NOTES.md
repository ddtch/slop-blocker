# X (Twitter) adapter notes

**Selectors last touched:** 2026-09-03
**Verified against a live page:** no.

## Expect weaker results here

X publishes no consistent AI disclosure, so `BADGE` is empty and there is no
"confirmed" platform signal to find. Detection falls back to:

- **Provenance metadata** on images. Note that X re-encodes uploads, which
  strips C2PA manifests in most cases — so this rarely fires.
- **The creator list**, which is the realistic path on this platform.
- **Keyword scoring** over `tweetText`, which cannot block on prose alone by
  design (see `src/core/keywords.ts`).

The adapter's real job is attaching the author to each media item, so
"block this author" works from the shroud.

## Before you trust this

`data-testid` values (`tweet`, `tweetText`, `tweetPhoto`, `User-Name`) have
been stable for years and are the right hooks. Confirm they still exist, and
check that `AUTHOR_LINK` resolves to the post author rather than a quoted
author on quote-posts — the first matching link inside the article wins, which
is the author for a normal post.

## If X ever ships a label

Put its container selector in `BADGE` and its wording in
`lists/disclosure-strings.json` under an `x` key. Nothing else needs to change.
