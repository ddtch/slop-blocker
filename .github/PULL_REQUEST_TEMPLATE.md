<!--
Short is fine. The two boxes below are the ones that save a round trip:
what you changed, and how you know it works.
-->

## What this changes

<!-- One or two sentences. If it fixes an issue, "Fixes #123". -->

## How you checked it

<!--
`npm run check` is the floor, not the answer. What matters is what you did by
hand:

  - adapter or selector change -> which URL you loaded, and what you saw
  - detection change -> which item got blocked or stopped being blocked, and
    the reason line the popup showed
  - anything visual -> a screenshot

"Tests pass" tells us nothing about a selector, because no test in this
repository visits a real platform.
-->

- [ ] `npm run check` passes
- [ ] Verified by hand (say where, above)

## If this touches detection

<!-- Delete this section if it does not. -->

- [ ] There is a test that would have failed before this change
- [ ] Nothing new is matched outside a disclosure container — captions, titles
      and article text are still never searched for platform label strings
- [ ] No new keyword sits in a tier stronger than it earns. The test: could this
      phrase appear in the title of a video *complaining* about AI slop? If yes,
      it is `ambiguous` at best

---

<!--
Two things that will be closed on sight, so you do not waste your time —
the reasoning is in CONTRIBUTING.md:

  - named accounts added to lists/creators.json. It ships empty on purpose:
    calling an account an AI-content publisher is a factual claim about a
    real person
  - accuracy percentages, stylistic tells (em-dashes, "delve", emoji density),
    or any new network destination
-->
