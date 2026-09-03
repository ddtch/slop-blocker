# Instagram adapter notes

**Selectors last touched:** 2026-09-03
**Verified against a live page:** no.

## Signal

Meta reads C2PA Content Credentials that Firefly, Photoshop generative fill,
DALL·E and Canva embed on export, and renders an "AI info" affordance in the
post chrome. So the badge does not depend on the creator disclosing anything.

## Before you trust this

Instagram's markup is machine-generated: class names are opaque and change
often, and `data-testid` values are sparse. Only `article` and `aria-label`
text are worth relying on.

1. Open a post carrying the AI info tag.
2. Inspect the tag. If it is a link, record its `href` fragment (the
   `ai_info` guess in `BADGE` comes from the documented URL shape and needs
   confirming). If it is a button, record its exact `aria-label` per locale.
3. Check `CAPTION`: `h1` holds the caption on post pages but not necessarily in
   the feed. A wrong caption selector only weakens keyword scoring, so it is
   safe to leave imperfect.

## Not implemented

- **Facebook.** It carries the same "AI info" label but an entirely different
  DOM, and sharing these selectors would produce false negatives while looking
  supported. It needs its own adapter and its own live verification. The
  disclosure strings for it are already in
  `lists/disclosure-strings.json` under `facebook`.
- **Stories and the explore grid.** Only feed posts and reels are covered.

## Rules for edits

- `BADGE` must stay out of the caption subtree. Instagram captions are full of
  AI talk that is not a disclosure.
- Blocking covers the media element, not the whole post, so the text stays
  readable — keep `MEDIA` pointing at the image/video, never at the article.
