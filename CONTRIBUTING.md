# Contributing

The most useful thing you can do here is tell us when we got a decision wrong. A blocker that
covers something it shouldn't is worse than one that misses something, so a good false-positive
report is worth more than a feature.

## The three contributions we want most

**1. A false positive.** Something got covered that isn't AI-generated. Open the popup, note the
reason line it gave, and file it. If the reason says `AI markers in the text: …`, the fix is usually
one line in `lists/keywords.json` — see [Keyword tiers](#keyword-tiers) below.

**2. A broken selector.** Platform markup churns constantly. If detection stopped working on a site,
the fix is almost always confined to one file: `src/adapters/<site>/selectors.ts`. Each of those
files carries a `LAST_VERIFIED` date and sits next to a `NOTES.md` explaining what to re-check and
where the markup came from. This is deliberately shaped to be a good first contribution.

**3. Disclosure strings in a language we don't speak.** `lists/disclosure-strings.json` maps
platform → locale → the exact strings a platform renders for its AI label. If you can confirm what
YouTube, TikTok or Instagram renders in your language — **from a real page, not a translation** —
that is a directly useful patch. Include a screenshot or the URL you saw it on, and add the entry to
`_meta.verified` so the next reader knows which lines are evidence and which are still guesses.

This is separate from the interface language. The UI ships in English, Spanish and Russian
(`_locales/`); a new one is one file and no code, and `test/unit/locales.test.ts` will tell you if
you missed a key or dropped a `$PLACEHOLDER$`. A translated *interface* does nothing for detection
on its own — the disclosure strings are what find AI content.

## Running it

```bash
npm install
npm run icons     # regenerate the PNG icons
npm run build     # -> dist/
npm run check     # typecheck + tests + build. Run this before opening a PR.
npm run check:all # the above, plus the real-Chrome smoke test
```

Load `dist/` via **chrome://extensions → Developer mode → Load unpacked**. `npm run watch`
rebuilds on change; press reload on the extension card to pick changes up.

`test/fixtures/provenance.html` is the manual test page — every image on it states what should
happen. `test/fixtures/demo.html` is the same detection paths dressed as an ordinary page, and is
what `npm run shots` screenshots.

## Rules that are not up for negotiation

These exist because of specific failures we watched other extensions in this category have. The
reasoning is in [`docs/competitive-analysis.md`](docs/competitive-analysis.md).

**`lists/creators.json` ships empty, and stays empty.** Calling a named account an AI-content
publisher is a factual claim about a real person. PRs adding names to the bundled list will be
closed regardless of how obvious the case seems. Users build that list themselves, locally.

**No stylistic tells as blocking signals.** No em-dash detection, no "delve", no emoji density, no
sentence-length heuristics. They fail hardest on non-native English speakers, which makes them a
fairness problem and not just an accuracy one. We detect disclosures, metadata and platform labels.

**No accuracy percentage.** We will not publish a number we cannot reproduce from a public test set.
The confidence tiers are the accuracy claim, and they can be audited by reading the code.

**No network destination other than the media host of the page being viewed.** No analytics, no
telemetry, no accounts, no remote configuration, no remotely hosted code. A PR that adds one will be
closed.

**Signals do not stack into a higher tier.** Two `suspected` signals stay `suspected`. Two weak
guesses are still a guess. See `src/core/confidence.ts`.

## Keyword tiers

`lists/keywords.json` has three tiers, and picking the right one is the whole game:

| Tier | One hit is worth | Use it for |
| --- | --- | --- |
| `disclosure` | `likely` — blocked | Phrases only said when labelling one's own work: "generated with AI", `#aiart` |
| `ambiguous` | `suspected` — not blocked; two hits reach `likely` | Reads as a disclosure *or* as a topic: "AI-generated" |
| `weak` | `suspected` — never blocked | Suggestive only |

The test to apply: **could this phrase appear in the title of a video complaining about AI slop?**
If yes, it is `ambiguous` at best. A video called "AI-generated slop is ruining YouTube" contains
exactly the same words as a disclosure, and blocking it is the failure mode that loses users' trust.
`test/unit/keywords.test.ts` and `test/integration/youtube.test.ts` both guard this.

## Code shape

- **Content scripts do DOM work; the service worker does I/O and state.** Cross-origin media bytes
  can only be read from the worker.
- **The worker is disposable.** MV3 can kill it at any moment, so state is written through to
  `chrome.storage.session`; the in-memory map is only a cache.
- **Every provider fails open.** A thrown error is logged with a `[slop-blocker]` prefix and skipped.
  A broken adapter must never break the page.
- **Fragile selectors live in one file per adapter**, with a `LAST_VERIFIED` date.
- `src/proto.ts` is the single source of truth for messages. Add the message type there first.

New behaviour needs a test. Detection changes need a test that would have failed before.

## Pull requests

Run `npm run check`. Explain what you verified by hand and on which page — for adapter changes, say
which URL you loaded and what you saw. Keep the diff to one concern.
