# Security policy

## Reporting

Report privately through GitHub's **Report a vulnerability** button on the Security tab, which opens
a private advisory. Please do not open a public issue for a vulnerability.

Include what an attacker can do, the page or content that triggers it, and the extension version.

## What is in scope

The extension holds a broad host permission and reads bytes from media on the pages you visit, so
the things worth reporting are:

- **Injection through page-derived text.** Reason strings contain platform labels and matched
  keywords, both taken from the page. They are written with `textContent` and the overlay lives in a
  closed shadow root; anything that gets page content evaluated as markup or script is in scope.
- **A page reading or influencing extension state** — settings, personal lists, counters, or another
  tab's detections.
- **Requests to any destination other than the media host of the page being viewed.** The extension
  is supposed to have no other network destination at all; a path that produces one is a bug of this
  class even if it looks harmless.
- **Credentials or cookies attached to a provenance read.** These are sent with `credentials:
  "omit"`; anything that defeats that is in scope.
- **The provenance parser** (`src/core/provenance.ts`) reading outside the buffer, looping
  unboundedly, or being made to consume unbounded memory by a crafted file.

## What is not in scope

- **A missed detection.** Unlabelled AI content is out of reach by design — see the README.
- **A false positive.** Real and important, but it is a correctness bug: open a normal issue.
- **Selector rot after a platform redesign.** Open a normal issue.
- **The absence of C2PA signature verification.** This is deliberate and documented as ADR-2: the
  extension detects a *declaration* of AI generation, and does not verify that the declaration is
  cryptographically valid. A file can lie about being AI-generated. Do not reuse
  `src/core/provenance.ts` as a trust anchor.

## Supported versions

The latest released version only.
