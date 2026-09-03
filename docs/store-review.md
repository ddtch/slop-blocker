# Chrome Web Store review notes

Prepared answers for the listing form and for a reviewer's likely questions. Nothing here should be
news to anyone who read `PRIVACY.md`; this is the same information in the shape the store asks for.

## Single purpose

> Detect content that is disclosed or labelled as AI-generated, and hide it behind a warning the user
> can click through.

Everything in the extension serves that purpose. The tracker counter is the one feature that needs
justifying on its own — see below.

## Permission justifications

**`storage`** — Stores the user's settings, their personal block/trust lists, and blocked-item
counters. Local only; nothing syncs.

**`tabs`** — Used to associate detections with the tab that produced them, so the popup and the
toolbar badge show the current page's results, and to clear a tab's state when it navigates or
closes. The extension does not enumerate or record browsing history.

**`contextMenus`** — Adds two right-click items, "block this author" and "trust this author", which
are the primary way users build their own lists.

**`declarativeNetRequest`** — Optional tracker blocking, off by default. Rules are built from a
bundled list of hostnames and installed as dynamic rules; enforcement is entirely inside the browser.
The extension deliberately does **not** request `declarativeNetRequestFeedback`, so it cannot observe
matched requests.

**Host permission `<all_urls>`** — Two reasons:

1. AI-generated content appears on every kind of site, so the detector has to be able to run
   anywhere. A fixed site list would silently miss exactly the pages users care about.
2. Reading a file's C2PA / IPTC metadata is a cross-origin read of media the page already loaded.
   That has to happen in the service worker, which needs host access to read the response bytes.

Mitigations a reviewer may want to hear: the user can disable the extension globally or per site from
the popup; scanning is limited to media near the viewport; metadata reads request only the first
256 KB and are sent without credentials; and there is no remote endpoint of any kind.

**If broad host access is a blocker for the listing**, the fallback is to ship with an explicit host
list for the supported platforms plus `optional_host_permissions` for everything else, gated behind an
"enable everywhere" toggle. That is a manifest-and-onboarding change, not an architectural one.

## Remote code

None. There is no `eval`, no remotely hosted script, no WASM, and no remote configuration. All
detection lists are bundled JSON in the package. The remote-list-update setting described in
`SPEC.md` is not implemented and is forced to `false` in `getSettings()`.

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
