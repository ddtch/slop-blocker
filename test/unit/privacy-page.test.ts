// The Markdown-to-HTML converter behind the published privacy policy.
//
// This one is worth testing more than it looks. The output is a legal document
// that people are told to read, and a converter that quietly drops a clause or
// mangles a permission name produces a policy that says something the source
// does not — which is precisely the failure this project keeps warning about.

import { describe, expect, it } from 'vitest';

import { convert, inline } from '../../scripts/build-privacy.mjs';

const REPO = 'https://github.com/ddtch/slop-blocker';

describe('inline formatting', () => {
  it('renders code spans and escapes their contents', () => {
    expect(inline('the `<all_urls>` permission')).toBe(
      'the <code>&lt;all_urls&gt;</code> permission',
    );
  });

  /*
   * The bug this file was written for. Code spans are lifted out and replaced
   * by a marker holding their index; an earlier version wrapped that index in
   * spaces, which made every bare number in the prose a candidate for being
   * replaced by a code span that does not exist. "the first 256 KB" is a real
   * line in PRIVACY.md.
   */
  it('leaves a bare number in the prose alone', () => {
    expect(inline('ask for only the first 256 KB of a file')).toBe(
      'ask for only the first 256 KB of a file',
    );
  });

  it('leaves a bare number alone even next to a code span', () => {
    expect(inline('`Range` asks for 256 KB, then 8 MB')).toBe(
      '<code>Range</code> asks for 256 KB, then 8 MB',
    );
  });

  it('does not read underscores inside code as emphasis', () => {
    expect(inline('`chrome.storage.local` and `<all_urls>`')).not.toContain('<em>');
  });

  it('renders bold and italic', () => {
    expect(inline('is **not** requested')).toBe('is <strong>not</strong> requested');
    expect(inline('_Last updated: 2026-09-03_')).toBe('<em>Last updated: 2026-09-03</em>');
  });

  it('escapes stray angle brackets outside code', () => {
    expect(inline('a < b and c > d')).toBe('a &lt; b and c &gt; d');
  });

  // A relative link is a path inside the repository. Left alone it would
  // resolve against the site and 404.
  it('rewrites a relative link to the repository', () => {
    expect(inline('see [`SECURITY.md`](SECURITY.md)')).toBe(
      `see <a href="${REPO}/blob/main/SECURITY.md"><code>SECURITY.md</code></a>`,
    );
  });

  it('leaves an absolute link alone', () => {
    expect(inline('[docs](https://example.com/x)')).toBe('<a href="https://example.com/x">docs</a>');
  });

  it('turns an autolink into a link', () => {
    expect(inline('at <https://example.com/issues>')).toBe(
      'at <a href="https://example.com/issues">https://example.com/issues</a>',
    );
  });
});

describe('document structure', () => {
  const source = [
    '# Privacy policy',
    '',
    '_Last updated: 2026-01-01_',
    '',
    '## The short version',
    '',
    'It does nothing with your data.',
    '',
    '## Lists',
    '',
    '- One item.',
    '- A second item that wraps',
    '  onto the next line.',
    '',
    '## Permissions',
    '',
    '| Permission | Why |',
    '| --- | --- |',
    '| `storage` | Saves settings. |',
    '',
    'Closing paragraph.',
    '',
  ].join('\n');

  const result = convert(source);

  it('lifts the title and the updated line out of the body', () => {
    expect(result.title).toBe('Privacy policy');
    expect(result.updated).toBe('Last updated: 2026-01-01');
    expect(result.body).not.toContain('Last updated');
  });

  it('gives every heading an id to link to', () => {
    expect(result.body).toContain('<h2 id="the-short-version">The short version</h2>');
    expect(result.body).toContain('<h2 id="permissions">Permissions</h2>');
  });

  it('joins a wrapped bullet back into one item', () => {
    expect(result.body).toContain('<li>A second item that wraps onto the next line.</li>');
    expect(result.body).toContain('<li>One item.</li>');
  });

  it('renders the table with a header row and no separator row', () => {
    expect(result.body).toContain('<th>Permission</th><th>Why</th>');
    expect(result.body).toContain('<td><code>storage</code></td><td>Saves settings.</td>');
    expect(result.body).not.toContain('---');
  });

  it('keeps the paragraph that follows the table', () => {
    expect(result.body).toContain('<p>Closing paragraph.</p>');
  });

  it('marks the opening summary so it can be styled as one', () => {
    expect(result.body).toContain('<p class="lead">It does nothing with your data.</p>');
  });

  // Silently dropping a clause is the failure that matters here, so anything
  // the converter does not understand has to stop the build.
  it('refuses a heading level it cannot render', () => {
    expect(() => convert('# Title\n\n### Too deep\n')).toThrow(/heading level/);
  });

  it('refuses a document with no title', () => {
    expect(() => convert('some text\n')).toThrow(/no top-level heading/);
  });
});

describe('the real policy', () => {
  it('carries every clause of PRIVACY.md into the page', async () => {
    const { readFile } = await import('node:fs/promises');
    const markdown = await readFile(new URL('../../PRIVACY.md', import.meta.url), 'utf8');
    const { body } = convert(markdown);

    // Every heading in the source has to appear in the output.
    const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(headings.length).toBeGreaterThan(5);
    for (const heading of headings) expect(body).toContain(`>${heading}</h2>`);

    // And the load-bearing claims, which are the reason anyone reads it.
    for (const claim of [
      'no server',
      'credentials: "omit"',
      '256 KB',
      'declarativeNetRequestFeedback',
      'no advertising',
    ]) {
      expect(body).toContain(claim);
    }
  });
});
