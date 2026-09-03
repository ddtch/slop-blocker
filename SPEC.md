# Slop Blocker — Browser Extension Specification

**Version:** 1.0 (draft for implementation)
**Date:** 2026-09-03
**Status:** Implemented — M0 and M1 are built, plus the TikTok/Instagram/X adapters originally scheduled for M2. Sections marked `[M2]`/`[M3]` are still open.

> **This document is the design as written before implementation, and is kept unedited as the record of intent.** Four decisions changed while building — the build tool, the C2PA approach, the keyword tiering, and how overlays are positioned — and two mistakes in this spec were corrected. Each is written up with its reasoning in `README.md` → "Decisions that differ from SPEC.md". **Read that section before treating anything below as current**, and see `README.md` → "What is not done yet" for the remaining gaps (most importantly: no selector here has been verified against a live page).

---

## 1. Overview

Slop Blocker is a browser extension (Chrome, Manifest V3) that detects AI-generated content ("slop") on web pages and hides it behind a click-to-reveal warning overlay. It keeps counters of everything it blocked, surfaces per-page detections in the extension popup, and on YouTube automatically pauses videos that are disclosed as AI-generated.

### 1.1 Core insight

We do **not** attempt pixel-level "is this AI?" classification. In 2026 the major platforms already label AI content themselves, and generation tools embed provenance metadata:

- **YouTube** shows an "Altered or synthetic content" disclosure in the expanded description, and a more prominent label on the player itself for sensitive topics (news, health, elections, finance).
- **TikTok** reads C2PA Content Credentials and auto-labels AI videos ("AI-generated" badge) even without creator disclosure; over a billion videos labeled.
- **Meta (Instagram/Facebook)** shows "AI info" tags and auto-detects via C2PA embedded by DALL-E, Firefly, Photoshop generative fill, Canva, etc.
- **Images/files** from major generators carry **C2PA manifests** and/or **IPTC `digitalSourceType: trainedAlgorithmicMedia`** metadata, readable in the browser via the official `c2pa-web` (WASM) library.

The extension's job is to **aggregate these existing signals**, add cheap text/list heuristics on top, and turn them into a consistent blocking UX. This makes detection reliable, fast, and fully local.

### 1.2 Goals

1. Detect AI-generated media (video, images, audio posts) using platform labels, provenance metadata, and heuristics.
2. Replace/cover detected content with a warning overlay; reveal only on explicit click.
3. On YouTube: auto-pause a playing video the moment it is identified as AI-generated, and show the overlay.
4. Per-tab and lifetime counters ("blocked N items"), visible on the toolbar badge and in the popup.
5. Popup shows *what exactly* was detected on the current page (type, reason, confidence).
6. Secondary: count known trackers on the page (detect-only in MVP; optional blocking later).
7. 100% local processing. No telemetry, no external API calls with page data.

### 1.3 Non-goals (v1)

- No ML/neural "AI-image detector" models (unreliable, heavy). Architecture must leave a slot for one as a future signal provider.
- No server component of any kind.
- No Firefox/Safari builds in v1 (keep code WebExtension-portable; Firefox is M3).
- No attempt to detect AI-generated *text* (LLM articles/comments) beyond simple keyword/disclosure heuristics — pixel/prose classification is out of scope.
- Not an ad blocker. Tracker handling is a counter/awareness feature, not a full content-blocking suite.

---

## 2. Detection model

Every detection produces a `Detection` record:

```ts
type SignalSource =
  | "platform-label"    // the platform itself marked it (YouTube/TikTok/Meta disclosure)
  | "c2pa"              // C2PA manifest declares AI generation
  | "iptc-metadata"     // XMP/IPTC digitalSourceType = trainedAlgorithmicMedia (or compositeWithTrainedAlgorithmicMedia)
  | "creator-list"      // channel/account/domain is on a known-AI-slop blocklist
  | "keyword"           // hashtags / title / alt-text heuristics
  | "user-marked";      // user manually marked this creator/domain as slop

type Confidence = "confirmed" | "likely" | "suspected";

interface Detection {
  id: string;                  // stable hash of (tabId, mediaUrl or elementFingerprint)
  tabId: number;
  url: string;                 // page URL
  mediaUrl?: string;           // src of the blocked media if any
  mediaType: "video" | "image" | "post" | "audio" | "embed" | "page";
  source: SignalSource[];      // all signals that fired
  confidence: Confidence;
  reason: string;              // human-readable, shown in overlay & popup, e.g. `YouTube disclosure: "Altered or synthetic content"`
  detectedAt: number;          // epoch ms
  revealed: boolean;           // user clicked through
}
```

**Confidence mapping (fixed policy, not configurable in v1):**

| Signal | Confidence |
|---|---|
| `platform-label` | confirmed |
| `c2pa` with AI-generation assertion | confirmed |
| `iptc-metadata` | confirmed |
| `user-marked` | confirmed |
| `creator-list` | likely |
| `keyword` (≥2 independent hits) | likely |
| `keyword` (1 hit) | suspected |

**Default action policy:** `confirmed` and `likely` → block (overlay). `suspected` → do not block; show a small corner badge on the element ("possibly AI") and count it in the popup under "suspected". User setting can raise/lower this threshold (§8).

### 2.1 Signal providers

Each provider is an independent module implementing:

```ts
interface SignalProvider {
  id: SignalSource;
  /** Called with candidate elements; returns detections (may be async). Must be idempotent per element. */
  scan(candidates: Element[], ctx: PageContext): Promise<PartialDetection[]>;
}
```

The **detection engine** (per-page, in the content script) merges partial detections per element, computes confidence, dedupes, and dispatches to the blocker + background.

#### Provider: `platform-label`

Reads the platform's own AI disclosure from the DOM. Implemented per site adapter (§5). This is the primary and most reliable signal. **Never key off CSS class names alone** — platforms churn them. Prefer, in order: stable `aria-label`s, data attributes, structured data (`ytInitialPlayerResponse` and similar page JSON blobs), then text content of known disclosure strings (localized list, §5.5).

#### Provider: `c2pa`

- Uses `c2pa-web` (the current library from the `c2pa-js` monorepo at contentauthenticity.org; WASM). Note: the old `c2pa` npm package is legacy/deprecated — use `c2pa-web`.
- Runs **in the service worker** (offscreen document if WASM-in-SW proves problematic in the target Chrome version — implementer verifies and picks; document the choice in README).
- Content script sends candidate image URLs → worker fetches bytes (host permissions cover cross-origin) → parses manifest → checks assertions for AI generation: `c2pa.actions` containing `c2pa.created`/`c2pa.edited` with `digitalSourceType` of `trainedAlgorithmicMedia` or `compositeWithTrainedAlgorithmicMedia`, and generator claims (e.g. DALL-E, Firefly, Sora in `claim_generator`).
- **Budget rules (mandatory):**
  - Only fetch images that are in/near the viewport (IntersectionObserver, `rootMargin: 200%`), rendered size ≥ 96×96 px, and not already cached.
  - Fetch with `Range: bytes=0-262143` first (JUMBF/C2PA boxes for JPEG/PNG/WebP typically live near the start); fall back to full fetch ≤ 8 MB only if the parser reports truncated-but-present manifest. Never full-fetch videos; for MP4, one 256 KB range probe of the head is allowed `[M2]`.
  - LRU result cache in `chrome.storage.session` keyed by URL (cap 2 000 entries): `"ai" | "clean" | "no-manifest" | "error"`.
  - Global concurrency: max 3 in-flight fetches; drop the queue on tab navigation.

#### Provider: `iptc-metadata`

Same fetched bytes as C2PA (share the byte cache): parse XMP packet for `Iptc4xmpExt:DigitalSourceType` ending in `trainedAlgorithmicMedia` / `compositeWithTrainedAlgorithmicMedia`, and PNG `tEXt`/JPEG APP segments where generators (e.g. Google "Made with Google AI", SynthID-adjacent IPTC tags) write source info. A small hand-rolled scanner over the first 256 KB is enough — no heavyweight EXIF library.

#### Provider: `creator-list`

- Bundled JSON lists + user-extendable: `{ youtubeChannels: [...], tiktokUsers: [...], instagramUsers: [...], xUsers: [...], domains: [...] }`.
- Ship with a small seed list (implementer: seed from public community "AI slop channel" lists; keep it in `lists/creators.json` with a comment header naming the source; do not hardcode into logic).
- Update mechanism `[M2]`: fetch list updates from a GitHub raw URL, opt-in setting, off by default (privacy: this is the only network call besides media fetches, and it contains no user data).

#### Provider: `keyword`

- Scans text adjacent to the media element (title, caption, alt, hashtags, channel byline) within the media's site-adapter-defined container.
- Bundled keyword list `lists/keywords.json`, two tiers:
  - strong: `#aiart`, `#aigenerated`, `#madewithai`, `#sora`, `#veo`, `#midjourney`, `#stablediffusion`, "AI-generated", "generated with AI", localized RU strings («сгенерировано ИИ», «нейросеть сгенерировала»), etc.
  - weak: "AI video", "нейросеть", tool names in isolation.
- Strong hit = 2 points, weak = 1; ≥2 points → likely, 1 → suspected. Case-insensitive, word-boundary matching; hashtags matched exactly.

#### Provider: `user-marked`

User right-clicks (context menu item "Slop Blocker → Mark creator as AI slop") or clicks "always block this creator" in an overlay → adds creator/domain to the personal list in `chrome.storage.local`. Personal list is checked before bundled lists and wins.

---

## 3. Blocking UX

### 3.1 Overlay ("shroud")

When a detection with `confidence ≥ block threshold` fires on a media element:

1. **Cover, don't remove.** Insert an absolutely-positioned overlay in a **closed shadow DOM** host appended to the media element's positioned ancestor (adapter provides the anchor). Never `display:none` the original media (breaks layout and player state); instead:
   - Images: overlay covers the img box; additionally apply `filter: blur(24px)` to the media element itself as a fallback layer in case overlay is removed by the page.
   - Videos: pause (§3.2), overlay covers the player.
2. **Overlay content** (all text localized, RU + EN in v1):
   - Icon + heading: **"AI-контент заблокирован"** / "AI content blocked"
   - Reason line: the `Detection.reason` (e.g. `YouTube: метка «Изменённый или синтетический контент»`, `C2PA: создано DALL·E`).
   - Buttons:
     - **«Показать»/"Show"** (primary) — reveals this one item for this page-session.
     - **«Показывать всегда от этого автора»** (secondary, only when a creator is identifiable) — adds to personal allowlist.
   - Small ⚙ link → opens popup/options.
3. **Reveal:** click "Show" → overlay fades out (150 ms), blur removed, video stays paused (user presses play themselves). Detection stays in the popup list marked `revealed`. Reveal is remembered per `(page URL, mediaUrl)` in `chrome.storage.session` — re-render of the same element (SPA re-mount, infinite scroll recycling) must not re-block a revealed item.
4. **Suspected-tier badge:** a 20 px corner chip on the element, tooltip shows the reason; clicking it opens a mini-menu: "Block it / Ignore / Always trust this creator".
5. Overlay must survive page CSS (shadow DOM + all styles inline/adopted), must not intercept scroll, and must clean itself up if the underlying element is removed (MutationObserver on the anchor).

### 3.2 YouTube auto-pause (headline feature)

- On watch pages (`/watch`, `/shorts/…`), the adapter checks disclosure **before or at playback start**:
  - Read `ytInitialPlayerResponse` (and on SPA navigation, the response captured from the `yt-navigate-finish` event payload / updated page data) — look for the synthetic-content disclosure structures; **fallback**: DOM check of the player-attached label and the expanded-description disclosure section text.
  - Timing: run at `yt-navigate-finish` + a 3 s late re-check (label sometimes renders late).
- If disclosed AI:
  1. `video.pause()` on the `<video>` element; set a guard: listen for `play` events for the next 5 s and re-pause **once** (YouTube may auto-resume) — after the user reveals, never pause again for this video ID.
  2. Show the shroud over the player with reason "YouTube: Altered or synthetic content disclosure".
  3. Increment counters; popup entry appears.
- Shorts feed: also pre-scan upcoming rendered items; pause-on-entry when a disclosed short scrolls into view.
- Thumbnails/home feed `[M2]`: badge (not block) home-feed items whose channel is on a creator list.

### 3.3 Whole-page mode

If ≥ N (default 5) confirmed detections on one page, or the domain is on the `domains` slop list → show a full-page interstitial (same shroud design, page-level) with "Continue to page". Off by default; setting «Блокировать страницы целиком».

---

## 4. Architecture (Chrome MV3)

```
┌─────────────────────────────── page ───────────────────────────────┐
│ content script (per frame, ISOLATED world)                          │
│  ├─ engine.ts        — orchestrates providers, merges detections    │
│  ├─ adapters/<site>  — site adapter (selectors, disclosure parsing) │
│  ├─ providers/*      — keyword, creator-list (local, sync)          │
│  ├─ shroud.ts        — overlay UI (shadow DOM)                      │
│  └─ observer.ts      — MutationObserver + IntersectionObserver      │
│ main-world script (only where an adapter needs page JS objects,     │
│  e.g. ytInitialPlayerResponse) — posts data via CustomEvent         │
└────────────────────────────────────────────────────────────────────┘
                    │ chrome.runtime messages (typed protocol §6)
┌────────────────── service worker (background) ─────────────────────┐
│  ├─ registry.ts   — per-tab detection registry, badge updates      │
│  ├─ c2pa.ts       — c2pa-web WASM, byte fetching, caches           │
│  ├─ trackers.ts   — DNR rules + matched-rule counting              │
│  └─ storage.ts    — settings, lists, lifetime stats                │
└────────────────────────────────────────────────────────────────────┘
        │                                   │
   popup (per-tab view, counters)      options page (settings, lists)
```

**Key rules:**

- Content scripts do all DOM work; the worker does all fetching, parsing, and state. Content scripts hold no long-lived state beyond the current page.
- The worker is ephemeral (MV3): the per-tab registry must be rebuilt from `chrome.storage.session` on wake. No in-memory-only state that the popup depends on.
- All frames: content script runs with `all_frames: true`, `match_about_blank: true` (embedded players live in iframes).
- Badge: `chrome.action.setBadgeText` per tab = count of non-revealed blocked items on that tab; badge color: red for confirmed present, amber if only likely/suspected.

### 4.1 Tech stack

- TypeScript, strict mode.
- Build: **WXT** (preferred; batteries-included MV3 dev/build/HMR) or CRXJS+Vite — implementer picks one, WXT recommended.
- UI (popup/options/shroud): Preact or vanilla + lit-html — keep the shroud dependency-free (it's injected everywhere; budget: shroud bundle ≤ 15 KB gzip).
- `c2pa-web` from npm (current package of the c2pa-js monorepo).
- Tests: Vitest for units; Playwright with `--load-extension` for e2e (§11).
- No other runtime dependencies without explicit need.

### 4.2 Manifest & permissions (minimal set)

```jsonc
{
  "manifest_version": 3,
  "permissions": [
    "storage",
    "tabs",
    "contextMenus",
    "declarativeNetRequest",         // tracker module
    "declarativeNetRequestFeedback"  // matched-rule counters (verify availability; else count via content-script resource observation)
  ],
  "host_permissions": ["<all_urls>"],  // required: generic scanning + cross-origin media byte fetches
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [ /* generic + per-site, all_frames: true */ ],
  "action": { "default_popup": "popup.html" }
}
```

If `<all_urls>` is unacceptable for store review friction, fall back to explicit site list + `optional_host_permissions` with an "enable everywhere" toggle. Implementer notes the decision.

---

## 5. Site adapters

An adapter declares: candidate selectors (what is a media unit), where creator identity lives, where adjacent text lives, disclosure-label detection, and the shroud anchor. Generic adapter runs everywhere; site adapters extend/override it.

```ts
interface SiteAdapter {
  matches: string[];                      // host patterns
  candidates(root: ParentNode): Element[];       // media units to consider
  creatorOf(el: Element): CreatorRef | null;     // {platform, id, handle}
  adjacentText(el: Element): string;             // caption/title/hashtags text
  platformLabel(el: Element, ctx: PageContext): PlatformLabelResult | null;
  shroudAnchor(el: Element): HTMLElement;        // positioned ancestor to attach overlay
  onNavigate?(cb: () => void): void;             // SPA nav hook (e.g. yt-navigate-finish)
}
```

### 5.1 YouTube (`youtube.com`, `m.youtube.com`, `youtube-nocookie.com` embeds)

- Candidates: watch-page player, shorts player, (M2: feed items).
- Disclosure detection, in priority order:
  1. Player-response JSON (main-world capture of `ytInitialPlayerResponse` / navigation payloads) — search recursively for the disclosure structure; implementer inspects live pages to pin exact keys and records them in `adapters/youtube/NOTES.md` with a date. Structure names churn — code defensively (search for known disclosure strings/renderer names rather than fixed deep paths).
  2. DOM: player disclosure label element (sensitive-topics variant) and expanded-description "How this content was made / Altered or synthetic content" section — match against the localized-string table (§5.5).
- SPA: subscribe to `yt-navigate-finish`; also re-scan on `yt-page-data-updated`.
- Auto-pause behavior: §3.2.

### 5.2 TikTok (`tiktok.com`)

- Candidates: feed video items.
- Disclosure: "AI-generated" badge on the video / caption tag (`#AIGC` marker, aria-labels). TikTok auto-labels via C2PA, so coverage is good. Also parse `SIGI_STATE`/universal data JSON if present for an `aigcLabelType`-like field (implementer verifies field name on live pages, documents in NOTES.md).
- Auto-pause disclosed videos in feed on entry (same pattern as Shorts).

### 5.3 Instagram / Facebook (`instagram.com`, `facebook.com`)

- Candidates: feed posts, reels.
- Disclosure: "AI info" tag on post header/menu; aria-label / text match. Meta renders it in the post chrome; DOM-only detection (no reliable page JSON).
- Block = shroud over the post's media container, not the whole post text.

### 5.4 X/Twitter (`x.com`) — best-effort

- No consistent platform label → rely on `creator-list`, `keyword` (incl. "Grok" media provenance line if present), and C2PA on images.

### 5.5 Localized disclosure strings

`lists/disclosure-strings.json`: per platform, per locale, the exact disclosure texts (EN + RU shipped; structure supports adding locales). Examples: EN YouTube "Altered or synthetic content", "How this content was made"; RU «Изменённый или синтетический контент». Implementer collects the real strings from live pages for EN/RU at build time; matching is substring, case-insensitive, on the specific disclosure containers only (never the whole page — false-positive guard: a video *about* AI labels would mention these strings in title/description free text, so match only inside the disclosure UI containers, not in title/caption fields).

### 5.6 Generic adapter (all other sites)

- Candidates: `<img>` ≥ 96×96 rendered, `<video>`, `<picture>`, CSS background images `[M3]`.
- Signals: C2PA + IPTC + keyword (alt/figcaption/nearest heading) + domain list.
- No auto-pause guard loop (just pause once if a detected `<video>` is playing).

---

## 6. Message protocol (typed, single source of truth `src/proto.ts`)

```ts
type Msg =
  | { t: "detections/report"; detections: Detection[] }          // CS → SW
  | { t: "detections/revealed"; id: string }                     // CS → SW
  | { t: "c2pa/check"; urls: string[] }                          // CS → SW
  | { t: "c2pa/result"; results: Record<string, C2paVerdict> }   // SW → CS (reply)
  | { t: "tab/state"; tabId?: number }                           // popup → SW
  | { t: "tab/stateResult"; detections: Detection[]; trackers: TrackerStat[]; counters: Counters }
  | { t: "settings/get" } | { t: "settings/set"; patch: Partial<Settings> }
  | { t: "lists/markCreator"; creator: CreatorRef; verdict: "block" | "trust" };
```

Popup subscribes to live updates via `chrome.runtime.connect` port; SW pushes `tab/stateResult` on every registry change for the active tab.

---

## 7. Counters, badge, popup

### 7.1 Counters

```ts
interface Counters {
  lifetimeBlocked: number;          // persistent, chrome.storage.local
  lifetimeByType: Record<MediaType, number>;
  lifetimeTrackers: number;
  sessionBlocked: number;           // since browser start
  // per-tab counts are derived from the registry, not stored
}
```

Increment rules: a Detection counts once when first blocked (not per re-render); revealed items still count as "blocked" historically but are subtracted from the *badge* number.

### 7.2 Popup (single screen, ~360×520)

1. **Header:** logo, master on/off toggle (per-site quick-disable dropdown: "off on this site").
2. **Current page section:** list of detections — icon by mediaType, reason, confidence chip, time; row actions: "Show" (reveal remotely), "Trust creator". Empty state: «На этой странице чисто ✨».
3. **Trackers section (collapsed):** "Найдено трекеров: N" + top domains list.
4. **Footer stats:** «Всего заблокировано: N» lifetime + session, link to options.
5. When a new detection fires while popup is closed → badge count bumps; no OS notifications in v1 (setting `[M2]` for chrome.notifications on YouTube auto-pause events).

### 7.3 Options page

- Blocking threshold (block: confirmed only / confirmed+likely (default) / everything incl. suspected).
- Per-site disable list; personal creator blocklist/trustlist editor (view, add, remove, export/import JSON).
- Whole-page mode toggle + threshold.
- Tracker module: off / count-only (default) / count+block.
- List updates opt-in `[M2]`.
- Reset stats.

---

## 8. Tracker module (secondary feature)

- Bundled compact tracker-domain list (`lists/trackers.json`; implementer seeds from a public domain list such as DuckDuckGo Tracker Radar or an EasyPrivacy domain extraction — record source+license in the file header; keep ≤ 5 000 domains for perf).
- **Count-only mode (default):** content script observes `performance.getEntriesByType("resource")` (+ PerformanceObserver for later entries), matches hostnames against the list (compiled into a Set of eTLD+1 in the worker, checked via message or a shared compiled artifact), reports counts per tab.
- **Block mode (opt-in):** DNR dynamic rules generated from the same list; counts via `declarativeNetRequestFeedback`/`getMatchedRules()` if available to non-dev installs — implementer verifies; if not usable, blocked count falls back to the count-only observer (blocked requests won't appear in resource timing, so in block mode count = matched rules or "blocked (count unavailable)" label; pick honestly and document).
- Tracker stats feed the popup section and `lifetimeTrackers`.

---

## 9. Storage schema

`chrome.storage.local`:
```
settings: Settings
counters: Counters (lifetime fields)
personalLists: { blockCreators: CreatorRef[], trustCreators: CreatorRef[], blockDomains: string[] }
```

`chrome.storage.session`:
```
registry:<tabId>: Detection[]         // rebuilt source of truth for popup/badge
c2paCache: LRU entries (url → verdict)
reveals:<tabId>: string[]             // revealed detection ids
```

Bundled read-only lists live in the extension package under `lists/` and are loaded by the worker at startup.

---

## 10. Performance & robustness budgets

- Content script init (parse + first scan on a loaded page): ≤ 50 ms main-thread on a mid-tier laptop; scanning is chunked via `requestIdleCallback`.
- MutationObserver callback work: batch with 250 ms debounce; never scan detached subtrees.
- Zero layout thrash: read phase (getBoundingClientRect batched) separated from write phase (overlay insertion).
- Memory: per-tab registry capped at 500 detections (drop oldest revealed).
- The extension must **fail open**: any provider error → log to console (prefixed `[slop-blocker]`), skip, never break the page. Wrap every provider `scan` in try/catch.
- Selector fragility: all platform-specific selectors/JSON paths live in one file per adapter (`adapters/<site>/selectors.ts`) with a `LAST_VERIFIED: "YYYY-MM-DD"` constant and NOTES.md, so future fixes are one-file changes.

---

## 11. Testing

1. **Unit (Vitest):** keyword scorer, confidence merger, C2PA verdict mapping (feed stored sample manifests — the C2PA public test-files repo has AI-generated samples), XMP/IPTC scanner against fixture bytes, storage schema migrations.
2. **Fixture pages:** `test/fixtures/*.html` — static saved copies of a YouTube watch page with disclosure, TikTok feed item with AIGC badge, IG post with "AI info", generic page with a C2PA-signed image (bundle a signed test image). e2e (Playwright + loaded extension) asserts: shroud appears, video element is paused, badge text, popup list content, reveal flow, reveal persistence across re-mount.
3. **Live smoke checklist** (manual, documented in `TESTING.md`): one real URL per platform known to carry a disclosure; verify auto-pause on a real disclosed YouTube video.
4. **False-positive guard test:** a page whose *article text* contains "AI-generated" and YouTube disclosure strings in the title must produce at most `suspected`, never a block, when no disclosure container/label exists.

---

## 12. Privacy & store compliance

- No analytics, no remote calls except (a) media byte fetches for C2PA (same resources the page already loads; use `credentials: "omit"`), (b) opt-in list updates `[M2]`.
- Privacy policy text (needed for Chrome Web Store) generated into `PRIVACY.md`: "all detection is local; the extension never transmits browsing data."
- Store listing justifications for `<all_urls>` and DNR prepared in `docs/store-review.md`.

---

## 13. Milestones

**M0 — Skeleton (foundation):** WXT project, manifest, typed message protocol, storage, empty popup with counters wiring, generic adapter scanning + keyword provider + shroud on a fixture page. e2e harness running.

**M1 — MVP (the demo):** YouTube adapter with disclosure detection + auto-pause + shroud; C2PA/IPTC provider for images (generic adapter); popup per-tab list + badge + lifetime counters; personal creator block/trust via overlay & context menu; RU/EN i18n; tracker count-only. *This is the "give it to a friend" release.*

**M2 — Coverage:** TikTok + Instagram adapters; whole-page mode; tracker block mode; list auto-updates (opt-in); YouTube feed badging; chrome.notifications option; MP4 C2PA head-probe.

**M3 — Stretch:** Firefox build; X/Twitter best-effort; CSS background images; pluggable local ML classifier slot; shared community list submission flow.

---

## 14. Repository layout

```
slop-blocker/
├─ SPEC.md                      # this file
├─ README.md
├─ TESTING.md
├─ package.json                 # wxt, typescript, vitest, playwright, c2pa-web
├─ wxt.config.ts
├─ src/
│  ├─ proto.ts                  # message types (single source of truth)
│  ├─ types.ts                  # Detection, Settings, Counters, adapters' interfaces
│  ├─ background/               # registry, c2pa, trackers, storage, badge
│  ├─ content/
│  │  ├─ engine.ts  observer.ts  shroud.ts  shroud.css
│  │  └─ providers/  (keyword.ts, creatorList.ts, c2paClient.ts, iptc.ts)
│  ├─ adapters/ (generic/, youtube/, tiktok/, instagram/, x/ — each: index.ts, selectors.ts, NOTES.md)
│  ├─ popup/  options/
│  └─ i18n/ (en.json, ru.json)
├─ lists/ (keywords.json, creators.json, trackers.json, disclosure-strings.json)
└─ test/ (unit/, fixtures/, e2e/)
```

---

## 15. Implementation notes & known risks (read before coding)

1. **YouTube internals churn.** The exact key names inside `ytInitialPlayerResponse` for the synthetic-content disclosure must be discovered from live pages at implementation time — do not trust any blog post's field names. Search the JSON generically for disclosure-renderer-ish nodes and the known disclosure strings, and always keep the DOM-text fallback working.
2. **C2PA is a declaration, not detection.** It only catches media whose generator embedded credentials and whose bytes survived re-encoding (screenshots/re-uploads strip it). That's fine — platform labels are the primary signal; C2PA is the primary signal only on the open web.
3. **WASM in MV3 service worker:** confirm `c2pa-web` initializes in the SW of the target Chrome; if not, use an offscreen document (`chrome.offscreen`) as the parsing host. Abstract behind `c2pa.ts` so the choice is swappable.
4. **Do not fight the page.** If a platform removes our overlay node, re-insert at most 3 times, then fall back to the blur-only mode and log. Never enter an insert/remove loop.
5. **Localization of disclosure strings** is the top false-negative risk for non-EN/RU users — the strings table must be trivially extendable and the popup should show "detection may be limited on this locale" when the page locale isn't covered.

## 16. References

- YouTube disclosure feature: https://blog.youtube/news-and-events/disclosing-ai-generated-content/
- TikTok C2PA partnership & auto-labeling: https://newsroom.tiktok.com/en-us/partnering-with-our-industry-to-advance-ai-transparency-and-literacy
- c2pa-js / c2pa-web docs: https://opensource.contentauthenticity.org/docs/c2pa-js/
- Reading & validating C2PA in the browser: https://learn.contentauthenticity.org/reading-and-validating-content-credentials
- C2PA spec (digitalSourceType values): https://c2pa.org/specifications/
