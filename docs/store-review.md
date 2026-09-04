# Chrome Web Store review notes

Prepared answers for the listing form and for a reviewer's likely questions. Nothing here should be
news to anyone who read `PRIVACY.md`; this is the same information in the shape the store asks for.

## Single purpose

Paste into **Single purpose description**:

> Slop Blocker hides content that is disclosed or labelled as AI-generated behind a warning the user
> can click through.
>
> It does not guess from pixels. It reads the AI disclosures the platforms already publish —
> YouTube's "altered or synthetic content" label, TikTok's AI-generated badge, Instagram's "AI info"
> tag — together with the C2PA Content Credentials and IPTC/XMP metadata that generators embed in
> the media files themselves. On YouTube it pauses a labelled video before it plays.
>
> Every other part of the extension serves that one purpose: the popup lists what was hidden on the
> current page and which signal caused it, the options page sets the confidence threshold, and the
> personal lists let the user block or trust individual authors and videos.

## Permission justifications

One box per permission in the submission form. Each is written to answer the reviewer's actual
question: what does this do for the user, and why can the single purpose not be met without it.

**`storage`**

> Stores locally, in the browser, only what the user creates by using the extension: their settings
> (protection on/off, the confidence threshold at which content is hidden, automatic pausing of
> labelled videos, tracker mode, and the sites they have switched the extension off on), their
> personal block and trust lists of authors and videos, and counters of how many items have been
> hidden. The counters are plain numbers — no URLs, titles or timestamps are kept. Per-tab detection
> results are held in session storage so the popup and the toolbar badge can show the current page's
> results, and are discarded when the tab closes. Nothing is synced and nothing is transmitted; the
> extension has no server.

**`tabs`**

> Used to attribute detections to the tab that produced them, so the popup and the toolbar badge show
> results for the page the user is looking at, and to discard a tab's results when it navigates away
> or closes. Concretely: reading the id and hostname of the active tab so the popup can show that
> tab's results and offer "turn off on this site"; clearing stored state on tabs.onUpdated and
> tabs.onRemoved; and messaging already-open tabs when the user changes a setting, so the change
> takes effect without reloading. Browsing history is never read, recorded or transmitted.

**`contextMenus`**

> Adds exactly two right-click items, "Slop Blocker: block this author" and "Slop Blocker: trust this
> author". They are one of the two ways a user builds their own lists — the other is a button in the
> popup — and each acts only on the element the user right-clicked. No other menu items are created.

**`declarativeNetRequest`**

> Optional tracker blocking. It is off by default and becomes active only if the user selects "Count
> and block" in the options page. When enabled, the extension registers dynamic rules built from a
> list of analytics and ad-tech hostnames bundled inside the package; the browser enforces them. The
> list is never fetched or updated remotely. The extension deliberately does not request
> declarativeNetRequestFeedback, so it cannot observe which requests matched.

**Host permission (`<all_urls>`)**

> Two things require it, both part of the single purpose.
>
> 1. Content that is labelled as AI-generated appears on every kind of website, so the content script
> has to be able to run anywhere in order to find the platform's label or the file's metadata. A
> fixed list of sites would silently miss the pages users care about.
>
> 2. Deciding whether an image is AI-generated means reading that image's C2PA Content Credentials or
> IPTC/XMP metadata. The image is served by a third-party host, so this is a cross-origin read and it
> has to happen in the service worker, which needs host access to read the response bytes.
>
> Limits already in place: only media near the viewport is examined; a metadata read requests just
> the first 256 KB of the file and is sent with credentials omitted, so no cookies are attached;
> verdicts are cached so a file is read once; and the user can switch the extension off per site or
> globally from the popup. The only requests the extension makes are to the host already serving the
> media on the page being viewed. There is no server belonging to this extension.

## Remote code

Answer **"No, I am not using remote code."**

Verified against the built package, not from memory: it contains no `eval`, no `new Function`, no
`importScripts`, no WebAssembly, and no `<script>` pointing at an external file. The only URLs that
appear anywhere in `dist/` are the SVG namespace string and `youtube.com`, both used for parsing and
building URLs rather than loading anything. There are exactly two `fetch` calls in the source: one
reads a JSON list bundled inside the package via `chrome.runtime.getURL`, and one reads the bytes of
media already displayed on the page being viewed.

Re-check before each submission:

```bash
npm run build
grep -nE "\beval\(|new Function\(|importScripts\(|WebAssembly|<script[^>]+src=\"http" dist/*.js dist/*.html
```

## Data handling disclosures

Every category in the store's form should be answered **no**: no personally identifiable information,
no health information, no financial information, no authentication information, no personal
communications, no location, no web history, no user activity, no website content collected,
transmitted or sold. The extension has no network destination other than the media host of the page
being viewed.

## Content that a reviewer might flag

- **The overlay covers third-party content.** That is the extension's stated function, it is
  user-initiated (installing it) and fully reversible per item, per site and globally.
- **`lists/creators.json` ships empty.** Intentional: labelling a named account as an AI-content
  publisher is a factual claim about a real person. Users populate it themselves.
- **The tracker counter** is secondary to the single purpose. Its justification is that the same
  content script already observes what the page loaded, and users judging a page's quality reasonably
  want to know what else it is doing. If a reviewer considers it out of scope for the single-purpose
  policy, it can be removed without touching detection: delete `background/trackers.ts`,
  `content/trackers.ts`, the tracker section of the popup, and the `declarativeNetRequest`
  permission.

## Listing copy

**Short description (132 char limit)**

> Hides AI-generated images and video behind a warning you can click through. Pauses labelled AI
> videos on YouTube.

**Detailed description**

> Slop Blocker covers content that is disclosed or labelled as AI-generated, and shows you what it
> found and why.
>
> It does not guess from pixels. It reads the disclosures platforms already publish — YouTube's
> altered-or-synthetic-content label, TikTok's AI-generated badge, Instagram's AI info tag — plus the
> C2PA Content Credentials and IPTC metadata that generators like Firefly, DALL·E and Midjourney
> embed in the files themselves. On YouTube it pauses a labelled video before you start watching.
>
> Every block tells you which signal fired and how sure it is, and one click reveals the content.
> Items it is only unsure about are marked, not hidden. You can trust or block individual authors,
> switch it off per site, and see how much has been blocked over time.
>
> Everything runs locally. No account, no server, no analytics, no telemetry.

## Version and support

- Version: see `manifest_version` / `version` in `src/manifest.json`.
- Minimum Chrome: 120 (needed for `world: "MAIN"` content scripts and current
  `declarativeNetRequest` behaviour).
- Support and privacy policy: link to the repository and to `PRIVACY.md`.
