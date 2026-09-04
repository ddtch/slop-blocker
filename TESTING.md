# Testing

## Automated

```bash
npm run check      # typecheck (both tsconfigs) + vitest + build
npm run check:all  # the above, plus the real-Chrome smoke test
```

What the suite covers:

| File | Covers |
| --- | --- |
| `test/unit/keywords.test.ts` | Keyword tiering against the shipped list, Unicode word boundaries, the "talking about AI" case |
| `test/unit/confidence.test.ts` | Tier ordering, the block threshold, that signals do not stack |
| `test/unit/provenance.test.ts` | C2PA / XMP / IPTC detection on generated fixtures, PNG + JPEG containers, that pixel data is never scanned, truncated-read handling |
| `test/unit/creators.test.ts` | Handle normalisation, id/handle matching, domain suffix matching |
| `test/unit/trackers.test.ts` | Hostname suffix matching, bare-TLD guard, shape of the shipped list |
| `test/unit/disclosure.test.ts` | Locale fallback, and that disclosure strings outside a disclosure container are ignored |
| `test/integration/youtube.test.ts` | Disclosed video → covered, paused, reported; one auto-resume undone; reveal is permanent; trusted authors exempt; the off switches |
| `test/unit/badge-adapter.test.ts` | The fallback for renamed containers, and that it neither doubles up nor reads captions as labels |
| `test/unit/observer.test.ts` | When a rescan happens, and that a `pushState` navigation is noticed at all |
| `test/unit/site.test.ts` | That the sitemap, the pages that exist, and their canonical tags all agree, and that robots.txt keeps the repository's Markdown out of search |
| `test/unit/privacy-page.test.ts` | The Markdown converter behind the published privacy policy, including that it refuses what it cannot render |
| `test/unit/locales.test.ts` | Every locale covers every key and keeps every placeholder |
| `test/unit/items.test.ts` | Per-item refs: exact (case-sensitive) id matching, round-tripping the options-page format |
| `test/unit/subject.test.ts` | What the popup's quick actions act on, per platform, including that a feed yields nothing |
| `test/unit/storage-lists.test.ts` | Personal lists, and that two concurrent quick actions do not discard each other |
| `test/integration/generic.test.ts` | Provenance verdicts → confidence; small images skipped; streams not fetched; duplicate images each covered; domain blocklist |

Media fixtures are generated, not downloaded — regenerate with `npm run fixtures`.

## Automated: real Chrome

```bash
npm run smoke
```

This is the only test that exercises the built extension in a browser: it serves the fixture
directory, launches headless Chrome, loads `dist/`, waits for detection to settle, and asserts that
exactly five items are covered and one is chipped. It also checks that the service worker is
actually running — the failure mode it was written to catch is an extension that loads but whose
worker dies on startup, which no jsdom test can see.

Two things it has to work around, worth knowing if you touch it:

- **Neither way of loading an unpacked extension works everywhere.** `--load-extension` does nothing
  on Chrome M137 and later, and fails silently: you get a browser with no extension, and a test that
  reports zero detections as if the code were broken. The CDP `Extensions.loadUnpacked` command that
  replaced it does not exist on Chrome before that, where it fails with `Method not available`. The
  script passes `--enable-unsafe-extension-debugging` *and* `--load-extension`, tries the CDP
  command, and falls back to the flag — deriving the extension id from the SHA-256 of the `dist/`
  path, because the flag reports nothing back.
- **`--dump-dom` is useless here.** It snapshots before scans debounce and before provenance reads
  return, so it always sees an untouched page. The script drives Chrome over the DevTools Protocol
  and waits.

Run `node scripts/smoke.mjs --keep-open` to leave the browser up and attach DevTools to poke at it.

## Manual: the local fixture page

This needs no account and no network.

```bash
npm run build
python3 -m http.server 8000 --directory test/fixtures
```

Load `dist/` as an unpacked extension, then open <http://localhost:8000/provenance.html>. Each
caption states the expected outcome. Serve over HTTP rather than opening the `file://` path — content
scripts do not run on local files unless you also enable "Allow access to file URLs" on the extension
card.

Check, in order:

- [ ] The two AI-declared images are covered, reason mentions Content Credentials, tier is *confirmed*.
- [ ] The generator-only image is covered with tier *likely*.
- [ ] The camera-captured and metadata-free images are untouched.
- [ ] The `#aiart` and Russian-disclosure images are covered; the "AI-generated slop is ruining the
      web" image gets only a small chip.
- [ ] All three copies of the repeated image are covered, not just the first.
- [ ] Nothing is blocked because of the disclosure strings in the closing paragraph.
- [ ] The toolbar badge shows the number of covered items, and the popup lists them with reasons.
- [ ] Clicking **Show** reveals one item, the badge drops by one, and it stays revealed after
      scrolling and reloading nothing (a reload legitimately re-blocks).
- [ ] Turning **Off on this site** in the popup clears every overlay immediately.

## Manual: live platforms

Everything here is unverified — this is the checklist that turns the adapters from guesses into
something you can trust. Record what you find in the adapter's `NOTES.md` and set its
`LAST_VERIFIED`.

### YouTube — the headline feature

1. Find a video that carries the "altered or synthetic content" disclosure in its expanded
   description. Public examples change; search for the label text plus a topic.
2. Open it with the extension on. Expected: playback stops, the player is covered, the popup shows
   *Video · confirmed* with the disclosure text as the reason.
3. Press **Show**. Expected: overlay gone, video stays paused until you press play, and it does not
   get paused again.
4. Navigate to another video and back (no reload). Expected: detections reset per video; the popup
   never shows the previous video's items.
5. Confirm the JSON path actually fired, rather than only the DOM fallback:
   ```js
   JSON.stringify(ytInitialPlayerResponse).match(/.{0,80}ynthetic.{0,80}/g)
   ```
   Write the real key paths into `src/adapters/youtube/NOTES.md`.
6. Repeat with the interface language set to Russian and correct
   `lists/disclosure-strings.json`.
7. Check a video *about* AI slop (title mentions "AI-generated"). Expected: not blocked, chip at most.
8. Check a normal video. Expected: nothing at all — no chip, no pause, badge empty.
9. Shorts: scroll a feed containing a disclosed short. Expected: it pauses on entry.
10. Full-screen a covered video. Expected: the overlay is still visible (it re-parents into the
    fullscreen element).

### TikTok

- [ ] A video with the AI-generated badge is covered and paused.
- [ ] Inspect the badge element; put its `data-e2e` or `aria-label` in `selectors.ts` and delete the
      `[class*=...]` fallbacks.
- [ ] A video whose caption merely discusses AI is not blocked.

### Instagram

- [ ] A post with the "AI info" tag has its media covered while the caption stays readable.
- [ ] Confirm whether the tag is a link (record the `href` fragment) or a button (record the exact
      `aria-label`, per locale).

### Performance sanity

- [ ] Scroll a long feed for a minute with DevTools' Performance panel recording. Scans should appear
      as short idle-time tasks, not as continuous work, and scrolling must stay smooth.
- [ ] On a page with many images, check the Network panel: provenance requests should be `206 Partial
      Content`, roughly 256 KB each, at most three in flight, and none for video.

### Trackers

- [ ] Open a news site. The popup's tracker count is non-zero and lists plausible domains.
- [ ] Switch the tracker setting to *count and block*, reload, and confirm the page still works. The
      count legitimately goes **down**, because blocked requests are not counted — that is documented
      behaviour, not a bug.

## Regressions worth a test

If you fix any of these, add a case rather than only fixing it:

- A platform label found in a title or caption instead of a disclosure container.
- An overlay that survives its media being removed, or that fights a page that deletes it (the
  re-insert budget is 3, then it falls back to blur only).
- A revealed item that gets re-blocked by a later scan.
- Provenance requests for media far outside the viewport.

## Screenshots and packaging

```bash
npm run shots   # -> docs/screenshots/, captured from the real extension
npm run pack    # -> slop-blocker-<version>.zip, and its SHA-256
```

`npm run shots` drives the same headless Chrome as the smoke test and captures three 1280x800
frames: `test/fixtures/demo.html` with the overlays in place, the popup, and the options page. The
demo page runs the real detection paths — the images carry real C2PA and XMP metadata, and the
`#aiart` caption is scored by the real keyword tiering — so a change in behaviour shows up in the
screenshots. The only cosmetic liberty is centring the popup on a backdrop, because the Chrome Web
Store accepts 1280x800 and nothing else.

Two things worth knowing if the popup capture looks wrong:

- The popup resolves its tab with `chrome.tabs.query({ active: true, currentWindow: true })`, which
  returns the popup's own tab when it is opened as an ordinary page. `popup.html?tabId=<id>`
  overrides that, and is also the way to inspect the popup with DevTools against a real page.
- `body` in `popup.css` sets `overflow-y: auto`, which CSS *propagates to the viewport* unless the
  root element has its own `overflow`. Without setting `overflow` on `<html>`, the body is not a
  scroll container and the sticky footer falls outside the card.

`npm run privacy` regenerates `docs/privacy/index.html` from `PRIVACY.md`. CI runs it and fails on a
diff, so the published policy and the one in the repository cannot drift apart — edit the Markdown,
never the HTML.

`npm run landing` screenshots `docs/index.html` — the GitHub Pages landing page — at desktop and
phone widths and reports any image that failed to load. It is a look-at-it check, not an assertion:
run it after editing the page, and actually open the two PNGs.

`npm run pack` writes the store zip deterministically — entries sorted by path, all timestamps fixed,
file modes zeroed, every entry stored rather than deflated — so the same commit produces the same
bytes and the same hash on any machine. That hash goes in the release notes. Verify with
`npm ci && npm run pack` on a clean checkout.

Storing rather than compressing is not an optimisation oversight. `zlib.deflate` is not
byte-identical across zlib versions: Node builds differ and some link zlib-ng. CI caught this the
first time it ran, on the icons — `npm run icons` produced different bytes on Node 25 locally and
Node 22 on the runner, from identical pixels. `scripts/gen-icons.mjs` therefore writes its PNGs with
hand-built stored deflate blocks, and `scripts/pack.mjs` stores every zip entry. If you ever
reintroduce compression to either, the reproducible-hash claim in `README.md` and `PRIVACY.md`
stops being true.
