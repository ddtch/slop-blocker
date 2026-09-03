# Competitive analysis — AI-slop blocking extensions

_Researched 2026-09-03. All figures are Chrome Web Store / addons.mozilla.org listings as of that
date. Store listings are self-reported by their developers; nothing here was verified by reading
their code._

---

## 1. Summary

Seven extensions were reviewed at the user's request, plus five adjacent ones found during the
research because they matter more to the competitive picture than some of the seven.

The finding that matters most: **this category is crowded but almost entirely unserious.** Six of
the seven requested extensions have fewer than 350 users. The one genuine market leader —
AI Content Shield, ~20,000 users across Chrome, Firefox and Edge — carries a 3.7★ rating where
**12 of 48 reviews are one star**, and the complaints in those reviews are precisely the failure
modes this project's architecture was designed to avoid.

There is no strong incumbent. There is a real, repeatedly-voiced demand, and a field of products
that either (a) do one narrow thing well, (b) guess from writing style and get it wrong, or
(c) put the working half behind a subscription. The opening is a detector that is *right*, says
*why*, and can be *audited*.

Three concrete conclusions:

1. **Our detection model is validated by our competitors' one-star reviews.** The single most common
   complaint in the category is blocking content for *mentioning* AI. Our `disclosure` /
   `ambiguous` / `weak` keyword tiering (ADR-3) exists specifically to prevent that, and it is the
   thing to lead the listing with.
2. **Our coverage is too narrow to compete.** Every YouTube-focused competitor filters the *home
   feed, search and sidebar*. We only handle the watch and Shorts pages. Google AI Overviews —
   the single most-demanded feature in the category — we do not touch at all.
3. **Open-sourcing is not a philosophical question here, it is a competitive one.** See §6.

---

## 2. The seven requested extensions

| # | Name (developer) | Users | Rating | Version / updated | Scope |
| --- | --- | --- | --- | --- | --- |
| 1 | **AI Slop Blocker** (wiksiapps) | 1,000 | 3.9★ (7) | 0.1.3 / 2026-05-03 | Google AI Overviews + YouTube AI-disclosed videos |
| 2 | **Slop Blocker** (Elliot William Arledge) | 2 | — | 1.5.0 / 2026-07-27 | X/Twitter only, on-device neural scoring |
| 3 | **AI Slop Blocker** (mt211211) | 26 | — | 0.4.1 / 2026-06-21 | Any site, explicit labels only |
| 4 | **YouTube Slop Blocker** (gammy) | 9 | 4.5★ (2) | 1.0.0 / 2026-01-08 | YouTube home feed, user-trained model |
| 5 | **AI Blocker — local slop filter** (Glossity Labs) | 17 | — | 1.1.0 / 2026-07-22 | Four filters: AI UI, posts, text, images |
| 6 | **AI Slop Blocker** (Brian Munene) | 327 | 3.9★ (7) | 3.1.0 / 2026-06-16 | X, LinkedIn, Reddit, Facebook, Google |
| 7 | **AI Slop Blocker – Hide YouTube AI Videos** (Damnright) | 10 | 5★ (1) | 0.4.6 / 2026-08-30 | YouTube desktop only |

### 1. AI Slop Blocker — wiksiapps (1,000 users)

The most-installed of the seven, at 22 KB, doing the two simplest possible things: hide Google's AI
Overview block, and stop YouTube videos the uploader disclosed as AI. No privacy policy URL, no
website, a gmail contact, "non-trader" status.

**The lesson is the ratio.** This is the smallest and least ambitious extension in the group and it
has 3× the users of the most technically sophisticated one. It won because it does the thing people
actually search for — *"get the AI summary out of my Google results"* — and nothing else. Its 3.9★
suggests it does not do even that reliably.

**Take:** Google AI Overviews / AI Mode removal is the demand magnet of this entire category. We do
not have it.

### 2. Slop Blocker — Elliot William Arledge / infatoshi (2 users)

Name collision with ours. X/Twitter feed scoring with an on-device neural model plus heuristic
fallback, an amber→red confidence gradient, optional automation (mute / "not interested" / block)
that ships **disabled by default**, per-account whitelist, and an optional `localhost:8765`
connection for the developer's own model server. Privacy policy is a GitHub gist. The developer
declares as an EU trader and publishes a name, phone number and city.

**Take:** three things worth stealing — the graded confidence display rather than a binary verdict,
automation off by default, and honest trader disclosure. Its two users say nothing about the design;
it appears to be unmarketed.

### 3. AI Slop Blocker — mt211211 (26 users)

The closest philosophical relative to this project. It "hides web content explicitly labeled as
AI-generated or synthetic", preserves page layout, restores instantly when disabled, and — unusually
— the listing itself states the limitation:

> "No browser extension can reliably identify every piece of unlabelled AI-generated text, image, or
> video."

Detection is by explicit disclosures, metadata and known AI interface patterns. Privacy policy is on
GitHub Pages, is well-written, promises changes will be published in a public repository, and
discloses one optional user-initiated Stripe link.

**Take:** it proves the honest framing is publishable and survives review. Its 26 users prove that
honesty alone does not distribute. It also shows the value of a *stated limitation* in the listing —
it converts the FP problem from a broken promise into an expectation set upfront.

### 4. YouTube Slop Blocker — gammy (9 users)

Targets "brainrot", not AI specifically. Ships a model pre-trained on 500+ videos and lets users
train their own on top. Requests **web history, user activity and website content** — the heaviest
permission set of the seven. Privacy policy (slopblocker.io) is genuinely local-first: titles,
channels and URLs you label stay on device, and the only network call is YouTube's oEmbed endpoint,
and only when you press "Backfill Titles".

**Take:** the *user-trainable* model is the most interesting idea in the group. A "this, not that"
personal classifier sidesteps the entire false-positive-liability problem: if the user trained it,
its mistakes are theirs. Worth noting as a possible M3+ slot — SPEC §13 already reserves a
"pluggable local ML classifier slot".

### 5. AI Blocker — local slop filter — Glossity Labs (17 users)

The most direct architectural overlap with us. Four independent, individually-disableable filters:

1. AI UI chrome (assistant buttons, chat widgets, answer boxes, summary panels),
2. posts matching a customisable term list,
3. probable-AI *text* scored by an on-device model with a sensitivity slider,
4. AI *images* flagged by platform labels and metadata.

Its privacy policy documents the mechanism explicitly: **"fetches the first 128 KB of images already
displayed on the current webpage to read embedded metadata, contacting only the image's original
host."** That is the same technique as our provenance probe, at half our 256 KB budget. It also
offers an **optional local LLM deep-check**, off by default, where flagged text is sent to a
user-configured `127.0.0.1` address. It lists a Houston business address, a phone number and a D-U-N-S
number, and links a GitHub repository.

**Take:** three things. (a) Our provenance probe is not a moat — someone else already ships it, and
at a smaller byte budget we should evaluate matching. (b) *Splitting the product into independently
toggleable filters* is better UX than our single global threshold; it lets a user who only wants
image blocking avoid every text false positive by construction. (c) A local-LLM escape hatch is a
clean way to offer aggressive detection without ever owning the accuracy claim.

### 6. AI Slop Blocker — Brian Munene (327 users) — the most commercially developed

Version 3.1.0, the most iterated of the seven. Claims a "6-layer hybrid detection engine" running
on-device, combining signature detection with a Naive Bayes classifier trained on 23,000 samples,
and advertises **94.8% accuracy on the test set**. It analyses "sentence structure, burstiness, emoji
density, hashtag spam, listicle formatting and 40+ linguistic fingerprints" across X, LinkedIn,
Reddit, Facebook and Google AI Overviews. YouTube is "in active development".

Monetisation: free tier gives **30 blocks per day**, three modes (blur / hide / label) and a
sensitivity slider; **$12 one-time** unlocks unlimited blocks, custom blocklists, author whitelisting
and full history. Privacy: no account, no external API calls for detection, but **anonymous SHA-256
hashes sync for community model improvement** (opt-out available).

**Take:** the good parts are the *three blocking modes* (blur / hide / label — we effectively have
blur and label, and are missing hide), the *sensitivity slider* as a first-class control, and the
**one-time $12 price instead of a subscription**, which the category's reviews strongly suggest users
prefer. The bad part is the accuracy claim: "94.8% on the test set" is unfalsifiable marketing for a
stylistic classifier, and its 3.9★ over 7 ratings is the same score as the 22 KB extension that only
hides a Google box. Stylistic detection of AI text does not appear to convert into user satisfaction.

### 7. AI Slop Blocker – Hide YouTube AI Videos — Damnright (10 users)

The most recently updated (2026-08-30) and the most polished operation: its own domain
(slopblocker.app), a hosted privacy policy, a real product boundary. It hides YouTube cards carrying
"Made with AI" / "How this was made" / altered-audio-or-visual disclosures from **home, search and
related** — the feed surfaces we do not cover. It adds a **"SLOP" button on the watch page** for
manually blocking a video or a whole channel, caches verdicts locally for 7 days, and is explicit
about what it does *not* cover (Shorts, embeds, mobile, auto-dubbed content, the video you are
currently watching).

It also has the most invasive optional feature in the group: **Google sign-in for crowd-sourced
submissions**. With auto-submit on, it sends the 11-character video ID and channel ID to a Supabase
backend on Lovable Cloud; account data includes email, password hash and a display name shown on a
**public scoreboard**. Its Chrome permission disclosures therefore include *authentication
information* and *personally identifiable information*.

**Take:** the SLOP button and the explicit non-coverage list are both worth copying. The
crowd-sourcing design is a warning: it converted a zero-data extension into one that must disclose
PII collection on its store listing, and it bought 10 users for that cost.

---

## 3. Adjacent products that matter more than some of the seven

**AI Content Shield** — the actual category leader. ~20,000 users, Chrome + Firefox + Edge,
featured on the Chrome Web Store. Coverage is enormous: YouTube, TikTok, Google/Bing/DuckDuckGo,
X, Facebook, Instagram, Threads, Reddit, Pinterest, LinkedIn, Spotify/Apple Music/SoundCloud/YouTube
Music, Gmail, Amazon, eBay. Pricing is a **subscription: $6/month, or $4.95/month billed annually,
with a 7-day trial on the yearly plan**. Pro gates AI-voice detection, LinkedIn/Facebook text
filtering, custom keywords, scheduling and Gmail.

Its Firefox reviews (3.7★, 48 reviews: 25×5, 8×4, 1×3, 2×2, **12×1**) are the single most useful
document found in this research:

> *"Inconsistent in the content it blocks. Had a video flagged for mentioning the term 'AI' in the
> captions… several other videos containing actual usage of AI slipped past."* — 1★

> *"kind of ironic that I used this to block over-reaching AI, only for the AI-blocker to itself
> become over-reaching."* — 3★

> *"Great idea, questionable execution… NOT Open-Source plus immediately & obnoxiously greeted by
> 'PRO'-Vers…."* — 2★

> *"Does nothing if you don't pay to upgrade. Worthless"* — 1★

Independent testing cited around the product put it at 88% accuracy / 8% false positives / 12% false
negatives. One FAQ detail worth copying: it deliberately **does not block on pages where the user is
actively seeking AI** — ChatGPT, Claude, Gemini, and AI-related searches.

**SlopBlock** (slopblock.cc, 133 users) — crowdsourced marking of AI YouTube videos with a
**community trust threshold**: warning icons appear on thumbnails once enough people have flagged a
video, and non-reporting users still receive the community's verdicts. This is the crowd-sourcing
model done without forcing an account on the consuming side.

**DeSlop** (Pineido, LinkedIn, 11 users) — the best false-positive UX in the category, and it is not
close. It **never filters first-degree connections or accounts you follow**; every hidden post has a
"Why hidden" explanation naming the signal; every hidden post has "Show anyway" and "Always show this
person"; sensitivity is Lenient / Balanced / Strict; and the listing explicitly says it protects
"real human writing, including non-native English, from false positives".

**AI Slop Filter** (105 users) — detects LinkedIn AI slop by looking for **the em-dash**. Included
here as the category's reductio ad absurdum, and as a reminder of what "stylistic detection" often
means in practice.

**Pangram** — a real ML detector with a browser extension; University of Chicago research reported
essentially zero false positives and false negatives on medium-to-long passages. It is the existence
proof that credible *text* detection is possible — and that it requires a research team, not a
regex list.

---

## 4. The category's reputation problem

DomainTools published research titled *"Deceptive Browser Extensions within the Google Store: A Study
in AI Slop"*, documenting ~20 extensions from what appears to be a single actor. The relevant
findings for us:

- **Review funnelling.** Code intercepted the rating flow: 1–3★ was redirected to a private feedback
  form on an attacker-controlled domain, while 4–5★ was routed to the Chrome Web Store. Public
  ratings in this category are therefore not trustworthy at face value.
- Chat histories and user inputs exfiltrated to external servers; IP and browser fingerprint
  collected via Yandex tracking cookies; install/uninstall events tracked through redirect pages.
- Misleading branding implying association with legitimate AI services.
- Permission requests unrelated to the stated function.

Its advice to users — scrutinise the review-count-to-rating ratio, research the developer and their
domains, read the permissions — is exactly the checklist a cautious user will run against *us*, and
we request `<all_urls>`.

**This is the strategic fact of the category:** "AI slop blocker" is now a keyword that scammers
farm. Every honest entrant is guilty by association until it proves otherwise, and the only proofs
that scale are a real identity, a real privacy policy, minimal permissions, and readable source.

---

## 5. Platform reality in 2026 — the tailwind

Our entire detection model rests on platforms doing the labelling. That bet is paying off:

- **TikTok** integrated C2PA Content Credentials in January 2025 — the first major platform to
  auto-detect and label AI content from embedded metadata — and joined the C2PA Steering Committee in
  July 2026. It reports having labelled **over 3 billion pieces of content**, including 1.3 billion+
  AI-generated videos, via Content Credentials, invisible watermarking and detection models.
- **YouTube** auto-applies the altered-or-synthetic label when its systems detect significant
  photorealistic AI even without creator disclosure. The label is **permanent and non-disputable**
  for content made with Veo or Dream Screen, and for content carrying C2PA metadata flagging it as
  fully generative.
- **Meta** requires disclosure for realistic AI content via the "AI info" tag, and rolled out an
  optional **AI-creator account-level label in May 2026**.
- **YouTube, Meta and LinkedIn all now surface Content Credentials to users.**

Two consequences for our roadmap. First, the disclosure surface is *growing*, which means a
disclosure-reading detector gets better over time for free while a stylistic classifier does not.
Second, there are **signals we do not yet consume**: Meta's account-level AI-creator label (a
creator-list signal the platform hands us for free) and LinkedIn's Content Credentials surfacing.

---

## 6. What to take from each

| Source | Idea | Verdict |
| --- | --- | --- |
| wiksiapps (1,000 users) | Google AI Overviews / AI Mode removal | **Adopt.** The demand magnet of the category. |
| Damnright | Hide feed cards in home / search / related | **Adopt.** Our biggest functional gap. |
| Damnright | "SLOP" button on the watch page (block video *or* channel) | **Adopt.** We only block authors, not individual items. |
| Damnright | Explicit "what this does NOT cover" list in the listing | **Adopt.** Cheap trust. |
| Brian Munene | Three modes: blur / hide / label | **Adopt.** We have blur+label; feeds need hide. |
| Brian Munene | Sensitivity as a first-class slider | **Adopt** — we already have `threshold`, it is just buried. |
| Brian Munene | One-time price, not subscription | **Adopt if we ever monetise.** |
| Glossity Labs | Independently toggleable filter categories | **Adopt.** Better than one global threshold. |
| Glossity Labs | Optional local-LLM deep-check at `127.0.0.1` | **Consider (M3).** Aggressive detection without owning the accuracy claim. |
| DeSlop | Never filter accounts you follow / are connected to | **Adopt.** Structural FP elimination. |
| DeSlop | "Why hidden" + "Show anyway" + "Always show this person" | **Mostly have it** — surface it better. |
| AI Content Shield | Don't block on pages where the user is actively seeking AI | **Adopt.** Obvious in hindsight. |
| AI Content Shield | Firefox + Edge builds | **Adopt (M3).** |
| SlopBlock | Community verdicts consumed without an account | **Consider.** The right shape *if* we ever crowdsource. |
| gammy | User-trainable personal model | **Consider (M3).** Fills SPEC §13's classifier slot. |
| mt211211 | Stated limitation in the store listing | **Adopt.** |
| infatoshi | Automation off by default; real trader disclosure | **Adopt.** |
| Damnright | Google sign-in + public scoreboard for crowdsourcing | **Reject.** Turns a zero-data product into a PII-collecting one. |
| Brian Munene | "94.8% accuracy" | **Reject.** Unfalsifiable; we will not publish a number we cannot reproduce. |
| AI Slop Filter | Em-dash as an AI signal | **Reject.** |
| DomainTools' subjects | Review funnelling | **Reject.** Also a CWS policy violation. |
| AI Content Shield | Free tier that does nothing without payment | **Reject.** Directly responsible for its 1★ reviews. |

---

## 7. Honest assessment of where we stand

**Where we are already ahead of all seven:**

- Evidence-first detection with a stated confidence tier per signal, and a policy that signals do not
  stack into a higher tier. Nobody else in the group draws that distinction.
- Disclosure strings matched *only inside adapter-declared disclosure containers*, never in titles or
  captions. This is the exact defect generating the category's worst reviews.
- A container-restricted byte-level provenance scanner (PNG/JPEG/WebP/ISOBMFF) that never reads pixel
  data. Only Glossity Labs does anything comparable, and its policy suggests a simpler probe.
- Auto-pause of a disclosed video before playback. Nobody else does this.
- RU/EN localisation with locale-aware disclosure strings and Unicode-aware keyword boundaries.
- A written spec, ADRs, a test suite including a real-Chrome smoke test, and a privacy policy that
  documents the byte budget. No competitor ships anything close.
- `lists/creators.json` deliberately empty, for a defensible reason.

**Where we are behind:**

- **Not shipped.** All seven are live; we have one commit and no listing.
- **No selector has been verified against a live page.** Our own README says so.
- **No feed coverage.** YouTube watch + Shorts only; no home, search, sidebar or channel pages, no
  Google AI Overviews, no AI-UI-chrome hiding.
- **No "hide" mode.** Covering a feed card with an overlay is the wrong affordance for a feed.
- **No text detection at all.** Defensible, but it means we are invisible to everyone searching for
  a LinkedIn/X slop filter.
- **Chrome only.**
- **Not open source, not published, no identity, no support channel.** In a category with a
  documented scam problem, we currently look exactly like the scams from the outside.

---

## Sources

- [AI Slop Blocker — wiksiapps](https://chromewebstore.google.com/detail/ai-slop-blocker/jlkgdflbbmajejkhdnoghekpkclnaelc)
- [Slop Blocker — infatoshi](https://chromewebstore.google.com/detail/slop-blocker/jkakgacmpideciakhncaepblfbbbfkgb) · [privacy policy](https://gist.github.com/Infatoshi/93b58a630eae978ce5e7222204b662f7)
- [AI Slop Blocker — mt211211](https://chromewebstore.google.com/detail/ai-slop-blocker/cndicgfmgedmlhnaglnmehofkfnnbpmc) · [privacy policy](https://mt211211.github.io/ai-slop-blocker/privacy.html)
- [YouTube Slop Blocker — gammy](https://chromewebstore.google.com/detail/youtube-slop-blocker/jhjfdbogefccnijlfbhdebmpoaindeil) · [privacy policy](https://www.slopblocker.io/privacy-policy)
- [AI Blocker — local slop filter, Glossity Labs](https://chromewebstore.google.com/detail/ai-blocker-—-local-slop-f/jhjcocdkhjehnapnahnmebeinegbmbhl) · [privacy policy](https://gist.github.com/SugoiCode/d7bf181ea8610341a6e32d9adabcaeca)
- [AI Slop Blocker — Brian Munene](https://chromewebstore.google.com/detail/ai-slop-blocker/cnibfnnnmlbhhmojfnlpdiddfbmobdan) · [product page](https://www.brianmunene.me/ai-slop-blocker)
- [AI Slop Blocker – Hide YouTube AI Videos, Damnright](https://chromewebstore.google.com/detail/ai-slop-blocker-hide-yout/fiacffinfngjiingoiimhgonigoppknp) · [privacy policy](https://slopblocker.app/privacy)
- [AI Content Shield](https://www.aicontentshield.app/) · [FAQ](https://www.aicontentshield.app/faq) · [Firefox reviews](https://addons.mozilla.org/en-US/firefox/addon/ai-content-shield/reviews/)
- [SlopBlock](https://chromewebstore.google.com/detail/slopblock/gaaodejmfnmlodlglkcdnaamomlkdbbc)
- [DeSlop](https://chromewebstore.google.com/detail/deslop-ai-slop-filter-for/ceeofbgdnlfkbmejalfggfkigjmkdkib)
- [AI Slop Filter](https://chromewebstore.google.com/detail/ai-slop-filter/iadgbaofmeldcmhogdpemkndldjkbnbc)
- [DomainTools — Deceptive Browser Extensions within the Google Store: A Study in AI Slop](https://dti.domaintools.com/research/deceptive-browser-extensions-google-store-ai-slop)
- [C2PA welcomes TikTok to Steering Committee](https://c2pa.org/c2pa-welcomes-tiktok-to-steering-committee/) · [Platform AI labeling in 2026](https://billo.app/blog/ai-labeling/) · [AI content disclosure rules 2026](https://www.socialscalehub.com/academy/ai-content-disclosure-rules-2026-tiktok-instagram-youtube)
- [Pangram Chrome extension review](https://www.popdust.com/pangram-ai-detector-chrome-extension-review)
