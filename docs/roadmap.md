# Roadmap — informed by the competitive analysis

_Written 2026-09-03. Companion to [`competitive-analysis.md`](./competitive-analysis.md); the
justification for every item is there. Supersedes SPEC.md §13 where the two disagree._

The organising principle: **we win on being right and being auditable, not on coverage.** Every item
below is either (a) closing a gap that keeps us out of the market, or (b) widening the one advantage
nobody else in the category has.

---

## R0 — Ship something real (blocking everything else)

Nothing below matters until the extension exists in public. Right now we have one commit, an
unverified selector set and no listing.

**R0.1 — Verify every selector against live pages.** Already our own README's #1 known gap. Work
through `TESTING.md` on real YouTube / TikTok / Instagram / X pages, set `LAST_VERIFIED` in each
`adapters/<site>/selectors.ts` and `lists/disclosure-strings.json` → `_meta.lastVerified`. Until this
is done every claim we make about detection is theoretical.

**R0.2 — A selector-drift canary.** Platform markup churns; a silent breakage is worse than a false
positive because nobody reports it. Add a scan-result sanity check: if an adapter's site is visited
and returns zero candidates across N page loads where it previously returned some, log it and surface
a one-line "detection may be broken on this site" note in the popup. This is the cheapest possible
insurance and no competitor has it.

**R0.3 — Publish.** Store listing using `docs/store-review.md` (already written), screenshots, a
hosted privacy policy URL, a real support channel, and a real developer identity. The DomainTools
research makes anonymity actively costly in this category.

**R0.4 — State the limitation in the listing.** Copy mt211211's framing: say plainly that no
extension can catch unlabelled AI content, and that we detect disclosures, metadata and platform
labels. This converts our narrow scope from a hidden weakness into a stated design choice, and it
pre-empts the "inconsistent" one-star review that the category leader collects.

---

## R1 — Close the coverage gaps that keep us invisible

**R1.1 — YouTube feed, search and sidebar card filtering.** Our single biggest functional gap. Every
YouTube competitor does this; we only handle watch and Shorts pages. SPEC.md already scheduled it for
M2 ("YouTube feed badging"), but badging is not enough — see R1.2.

**R1.2 — A third blocking mode: `hide`.** We currently have blur-with-overlay and label-chip. In a
feed, a covered placeholder is the wrong affordance — users want the card gone. Add `hide` as a
per-surface setting (`feed: hide`, `watch: cover`), matching Brian Munene's blur/hide/label triad.
The existing `Shroud` already reconciles against the DOM each scan, so `hide` is a third `Mode`
alongside `block` / `chip` / `page`, not a new subsystem.

**R1.3 — Google AI Overviews / AI Mode.** The demand magnet of the entire category: a 22 KB extension
that does only this and YouTube has 1,000 users — more than any of the other six combined. It is also
architecturally trivial for us (a new adapter, a `page`-adjacent media type, no provenance).

One caution: this stretches our Chrome Web Store "single purpose" statement, which currently reads
*"detect content that is disclosed or labelled as AI-generated"*. A Google AI Overview is
self-evidently AI-generated and arguably labelled as such by Google, so the statement holds — but
`docs/store-review.md` should be updated to say so explicitly before submission rather than after a
rejection.

**R1.4 — Hide AI UI chrome (opt-in, off by default).** Assistant buttons, chat widgets, summary
panels. Glossity Labs bundles this and it is a real user want, but it is a *different product* from
AI-content detection. Ship it as a clearly separate, default-off filter so it never contaminates our
detection statistics or our single-purpose story.

**R1.5 — Per-item block, not just per-author.** Damnright's "SLOP" button. We can block a creator or
a domain, but not a single video. Add a per-detection "block this item" that writes the media/video
id to the personal list, and expose it on the shroud next to the existing trust/block-author buttons.

---

## R2 — Widen the moat: be the one that is right

These are the items that turn "another slop blocker" into "the one that doesn't block your stuff by
mistake". They are cheap and no competitor has all of them.

**R2.1 — Never hide content the user has a relationship with.** DeSlop's structural false-positive
elimination, and the best idea found in this research. If the user is subscribed to the YouTube
channel, follows the X/Instagram account, or is connected on LinkedIn, do not block — badge at most.
This is a hard exemption, not a heuristic, and it removes the most damaging class of false positive
by construction. Extends the existing `isTrusted()` path in `content/providers/signals.ts`.

**R2.2 — Never block on pages where the user is actively seeking AI.** AI Content Shield's rule:
chatgpt.com, claude.ai, gemini.google.com, midjourney.com, and AI-related search queries. Obvious in
hindsight; add as a bundled `neverBlock` host list plus a search-query check.

**R2.3 — Independently toggleable filter categories.** Glossity Labs' structure, and better than our
single global `threshold`. Let a user enable *provenance + platform labels* while disabling
*keywords* entirely. A user who only trusts C2PA should be able to say so and then experience zero
false positives by construction. Our signal providers are already separate pure functions — this is a
settings and merge-filter change, not an architectural one.

**R2.4 — Surface the sensitivity control.** `settings.threshold` is our sensitivity slider and it is
buried in the options page. Put it in the popup where competitors put theirs.

**R2.5 — Make "why was this hidden" the headline, not a footnote.** We already compute a per-signal
reason string with a confidence tier — this is our differentiator and it deserves the top of the
shroud, the top of the popup row, and a screenshot in the store listing. Add "Show anyway" and
"Always show this author" as the two primary actions (we have both; they are not framed as the
primary answer to a mistake).

**R2.6 — Widen what the generic adapter reads as text.** Found while building the demo page for the
screenshots: `nearbyText()` in `src/adapters/generic.ts` reads only `alt`, `title`, `aria-label` and
`<figcaption>`. On an ordinary page whose captions sit in sibling `<div>`s — which is most of the
web — the keyword signal never fires at all. Every keyword test passes because the fixture puts its
disclosure text in `alt`. The design question is how to reach a caption without dragging in
unrelated page text; a bounded walk up to a common container and back down, capped at the existing
600 characters, is the obvious first attempt. Until this is fixed, the generic adapter is a
provenance detector and little else.

**R2.7 — A false-positive report path.** One click on a shroud → opens a prefilled GitHub issue with
the URL, the signals that fired and the matched terms. Costs nothing, and turns our worst moments
into the tuning data for `lists/keywords.json`.

---

## R3 — New signals, ordered by value per unit of work

**R3.1 — Meta's account-level AI-creator label** (rolled out May 2026). The platform is handing us a
creator-list signal for free; we currently only read the per-post "AI info" tag.

**R3.2 — LinkedIn Content Credentials.** LinkedIn now surfaces Content Credentials to users, and we
have no LinkedIn adapter at all. A disclosure-container adapter there is low-risk work in a place
where every competitor is doing unreliable stylistic guessing.

**R3.3 — TikTok's `__UNIVERSAL_DATA_FOR_REHYDRATION__`.** Already on our list; a main-world script
like YouTube's gives a pre-render signal that survives badge markup changes.

**R3.4 — MP4 / ISOBMFF provenance probing.** Already listed as not done.

**R3.5 — Re-evaluate the 256 KB probe budget.** Glossity Labs ships 128 KB. If 128 KB is sufficient
in practice, halving the budget halves our most privacy-sensitive network behaviour, which is worth
real points in a permissions-hostile category. Measure against `test/fixtures/media/` and real files
before changing it.

---

## R4 — Considered and deliberately deferred

**Text-slop detection.** Every text-based competitor does it, and it is the source of the category's
worst reviews — including a shipping extension that flags LinkedIn posts for containing an em-dash,
and a market leader blocking videos for saying the word "AI". Our position: *if* we add it, it enters
at the `suspected` tier only, never blocks by default, is a separately-toggleable filter (R2.3), and
we publish no accuracy percentage we cannot reproduce. Pangram's research-grade results show credible
text detection is possible; it is also clearly not a side feature.

**Local-LLM deep check at `127.0.0.1`.** Glossity Labs' escape hatch, and an elegant way to offer
aggressive detection while never owning the accuracy claim. Fills SPEC §13's "pluggable local ML
classifier slot". Genuinely interesting; strictly after R0–R2.

**User-trainable personal model** (gammy's approach). Sidesteps false-positive liability entirely —
if the user trained it, the mistakes are theirs. Same slot as above.

**Crowd-sourced community lists.** Two designs exist in the market. Damnright's requires a Google
account and publishes a scoreboard, and turned a zero-data extension into one that must disclose PII
collection — it bought 10 users at that price. SlopBlock's is better: consumers receive community
verdicts without an account. If we ever do this, only in SlopBlock's shape: a signed list downloaded
on an opt-in schedule (`settings.listUpdates`, already stubbed and forced off), submissions optional,
anonymous, batched, no account, and an appeals process before any named account enters a shipped
list. The defamation exposure that keeps `lists/creators.json` empty applies with full force to a
list we distribute.

**Firefox and Edge builds.** AI Content Shield ships all three and it is part of why it leads. Our
MV3 code is mostly portable; the blockers are `world: "MAIN"` content scripts and
`declarativeNetRequest` differences. Worth doing, but after we have a Chrome listing that works.

---

## R5 — Anti-goals

Written down so they do not get re-litigated later. Each of these is something a competitor does that
is directly responsible for a bad outcome we can observe.

- **No accuracy percentage we cannot reproduce.** "94.8% on the test set" is unfalsifiable marketing.
  Our confidence tiers *are* the accuracy claim, and they are auditable.
- **No free tier that does nothing.** *"Does nothing if you don't pay to upgrade. Worthless"* — 1★ on
  the category leader. If we ever charge, the detection engine stays free and complete.
- **No subscription.** If we monetise, one-time, like the $12 competitor — the category's reviews are
  explicit about subscription fatigue.
- **No review funnelling.** Redirecting 1–3★ away from the store is what the DomainTools research
  documented, and it violates Chrome Web Store policy.
- **No `declarativeNetRequestFeedback`.** Already decided; a better tracker counter is not worth a
  "read your browsing history" warning.
- **No stylistic tells as blocking signals.** Em-dashes, "delve", emoji density. They fail on
  non-native English speakers, which is a fairness problem as much as an accuracy one.
- **No named accounts in a shipped `creators.json`** without an appeals process.
- **No account, no telemetry, no analytics.** This is the product.

---

## Should this be open source?

**Yes. MIT, before or at the same time as the store listing.** This is not a philosophical question
in this category; it is a competitive one, and the evidence is unusually direct.

### The case for

**1. Users in this exact niche say so out loud.** A two-star review of the 20,000-user category
leader reads, in full: *"Great idea, questionable execution… NOT Open-Source plus immediately &
obnoxiously greeted by 'PRO'-Vers…."* Being closed source is being cited as a defect, in a review, by
a paying-market user, on the biggest product in the category.

**2. Our entire value proposition is an unverifiable claim.** `PRIVACY.md` says there is no server, no
telemetry, and that we read the first 256 KB of images with `credentials: "omit"`. Every one of our
competitors says something similar. In a minified bundle, all of those claims are equally worthless.
Published source turns our privacy policy from a promise into something a reader can check — and we
are the only entrant whose policy is specific enough to be worth checking.

**3. We ask for `<all_urls>`, in a category with a documented scam problem.** DomainTools found ~20
extensions from a single actor exfiltrating chat histories and fingerprinting users via Yandex
cookies, with faked ratings. Their advice to users is to scrutinise the developer, the domains and
the permissions. We will be scrutinised the same way, and we are asking for the scariest permission
set in the list. Open source is the standard, expected mitigation — it is why uBlock Origin gets away
with what it asks for.

**4. The code is not the moat.** It is ~5,500 lines. A competitor already ships a 128 KB image
metadata probe, so even our most technical component is not unique. What is actually defensible is
the curation and calibration — the keyword tiering, the disclosure-container discipline, the verified
selectors, the empty creators list and the reasoning behind it — plus execution and the trust that
comes from being auditable. None of that is protected by hiding the source; most of it gets *better*
when strangers can file issues against it.

**5. Selector rot is a maintenance problem that open source is unusually good at.** Our biggest
long-term operational risk is that YouTube changes its markup and detection silently breaks. Fragile
selectors already live in one file per adapter with a `LAST_VERIFIED` date and a `NOTES.md` —
deliberately shaped as a one-file fix. That is a perfect first contribution, and every competitor
carries the same rot with no one but the author to fix it.

**6. It makes R2.6 and R3 work.** A false-positive report path that opens a GitHub issue, and
community-contributed disclosure strings for locales we do not speak, both need a public repository
to point at.

### The case against, and what it is actually worth

- **"Someone will clone it and sell it."** They can, and the clone will be a closed fork of an
  auditable original, competing on marketing against a project whose whole pitch is auditability. The
  Chrome Web Store's spam policy also handles near-duplicate listings. The real protections are the
  name, the listing and the release cadence — not the source.
- **"Platforms will use it to evade detection."** They will not: platforms are the ones *publishing*
  the disclosures we read, under regulatory and policy pressure to publish more. Unlike an ad
  blocker, we are not in an adversarial relationship with the sites we read. Individual creators who
  want to evade a disclosure label have a much easier route — not disclosing — and our README already
  admits we cannot catch that.
- **"Support burden."** Real, and manageable with a `CONTRIBUTING.md`, issue templates, and an
  explicit statement that unverified selectors and unreviewed creator-list PRs are not merged.
- **"It forecloses monetisation."** It does not. MIT is compatible with a paid hosted community list,
  paid sync, or a "support the project" tier. Open core is the normal shape here, and given R5's
  anti-goals we would not be gating detection anyway.

### Licence

**MIT.** The goal is adoption and trust, and MIT maximises both while creating no friction for anyone
who wants to reuse `src/core/provenance.ts`. GPL-3.0 is the alternative if the closed-paid-fork
scenario worries you more than adoption does — but enforcement by a solo developer against a Chrome
Web Store listing is impractical, so it would buy a deterrent rather than a remedy. Pick MIT and put
the effort into the two things that actually differentiate instead.

### The thing to do that nobody else does

**Reproducible builds with a published hash.** For each release, publish the SHA-256 of the packaged
`dist/` alongside a tagged commit, so any user can build from source and confirm the Chrome Web Store
package matches. `build.mjs` is ~100 lines with five dev dependencies and no framework indirection,
so this is nearly free for us and effectively impossible for the bundler-heavy competitors.

Not one extension in this research does it. Combined with a privacy policy that is specific enough to
falsify, it is the strongest available answer to *"why should I trust an extension that can read
every page I visit?"* — and it is exactly the question this category has taught its users to ask.

### Concretely

1. Add `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, and GitHub issue templates —
   false-positive report, selector-broken report, disclosure-string contribution.
2. Push the repository public **before** submitting to the store, so the listing can link it.
3. Add the repository URL to the store listing, to `PRIVACY.md` § Contact (currently "open an issue
   in the repository" with no repository), and to the options page footer.
4. Tag `v0.1.0` and publish the `dist/` SHA-256 in the release notes. Document the verification
   command in `README.md`.
5. State in the README that `lists/creators.json` stays empty in-repo and that PRs adding named
   accounts will be closed — the reasoning is already written, it just needs to be a contribution
   rule as well as a design note.
