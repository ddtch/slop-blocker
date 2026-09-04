// Renders PRIVACY.md into docs/privacy/index.html.
//
// Generated rather than hand-written because two copies of a privacy policy is
// not a formatting problem, it is a policy problem: the published page and the
// one in the repository disagreeing is exactly the kind of thing this project
// tells people to check for. One source, and CI fails if the output drifts.
//
// The converter handles only the Markdown that PRIVACY.md actually uses:
// headings, paragraphs, bullet lists, one pipe table, and inline code, bold,
// italic and links. It is not a Markdown implementation, and it throws on a
// construct it does not recognise rather than silently dropping it.
//
// Usage: node scripts/build-privacy.mjs

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path, { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const SOURCE = join(ROOT, 'PRIVACY.md');
const OUT_DIR = join(ROOT, 'docs', 'privacy');
const REPO = 'https://github.com/ddtch/slop-blocker';
const SITE = 'https://slopblocker.nnnada.com';

/**
 * Marks where a code span was lifted out, written as an escape rather than as
 * the byte itself: this file used to carry raw NUL characters here, which no
 * editor shows and any round-trip could silently eat.
 *
 * It has to be a character that cannot occur in the source document. Wrapping
 * the index in spaces instead would mean any bare number in the prose — "the
 * first 256 KB" — was a candidate for being replaced by a code span that does
 * not exist.
 */
const SENTINEL = '\u0000';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Inline formatting.
 *
 * Code spans are lifted out first and put back last, so the bold and italic
 * rules cannot chew through something like `<all_urls>`, whose underscores
 * would otherwise read as emphasis.
 */
function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
  });

  out = escapeHtml(out);

  // Autolinks, which escaping has just turned into &lt;https://...&gt;.
  out = out.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');

  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    // A relative link points at a file in the repository, not at this site.
    const url = /^(https?:|#|mailto:)/.test(href) ? href : `${REPO}/blob/main/${href}`;
    return `<a href="${url}">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:)])/g, '$1<em>$2</em>');

  return out.replace(
    new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g'),
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`,
  );
}

function renderTable(rows) {
  const cells = (row) =>
    row
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((cell) => cell.trim());

  const [head, , ...body] = rows;
  const th = cells(head)
    .map((cell) => `<th>${inline(cell)}</th>`)
    .join('');
  const tr = body
    .map((row) => `<tr>${cells(row).map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('\n          ');

  return [
    '<div class="table-scroll">',
    '      <table>',
    `        <thead><tr>${th}</tr></thead>`,
    '        <tbody>',
    `          ${tr}`,
    '        </tbody>',
    '      </table>',
    '    </div>',
  ].join('\n');
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function convert(markdown) {
  const html = [];
  let title = '';
  let updated = '';
  let paragraph = [];
  let list = null;
  let table = null;
  let leadPending = false;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p${leadPending ? ' class="lead"' : ''}>${inline(paragraph.join(' '))}</p>`);
    leadPending = false;
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.map((item) => `<li>${inline(item)}</li>`).join('\n      ');
    html.push(`<ul>\n      ${items}\n    </ul>`);
    list = null;
  };
  const flushTable = () => {
    if (!table) return;
    html.push(renderTable(table));
    table = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushTable();
  };

  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd();

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    if (line.startsWith('|')) {
      flushParagraph();
      flushList();
      (table ??= []).push(line);
      continue;
    }
    flushTable();

    if (line.startsWith('# ')) {
      flushAll();
      title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith('## ')) {
      flushAll();
      const heading = line.slice(3).trim();
      html.push(`<h2 id="${slug(heading)}">${inline(heading)}</h2>`);
      // The first paragraph under the opening heading is the summary.
      leadPending = html.length === 1;
      continue;
    }
    if (line.startsWith('#')) throw new Error(`heading level not supported: ${line}`);

    // The "_Last updated: ..._" line, which sits directly under the title.
    if (!updated && html.length === 0 && /^_[^_]+_$/.test(line.trim())) {
      updated = line.trim().slice(1, -1);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      (list ??= []).push(line.slice(2).trim());
      continue;
    }
    // An indented continuation of the bullet above it.
    if (list && /^\s{2,}\S/.test(raw)) {
      list[list.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }
  flushAll();

  if (!title) throw new Error('PRIVACY.md has no top-level heading');
  return { title, updated, body: html.join('\n    ') };
}

const MARK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='22' fill='%230b0b0f'/%3E%3Cpath d='M50 8C53 34 66 47 92 50C66 53 53 66 50 92C47 66 34 53 8 50C34 47 47 34 50 8Z' fill='%23ff3b30'/%3E%3C/svg%3E";

function page({ title, updated, body }) {
  const description =
    'How Slop Blocker handles your data: it does not. No server, no account, no analytics, no telemetry.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${SITE}/privacy/" />

    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${SITE}/privacy/" />
    <meta property="og:image" content="${SITE}/screenshots/01-blocked-page.png" />
    <meta property="og:site_name" content="Slop Blocker" />
    <meta property="og:locale" content="en" />
    <meta name="twitter:card" content="summary_large_image" />

    <!-- Same set as the landing page; all four come from scripts/gen-icons.mjs. -->
    <link rel="icon" href="${MARK}" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png" />
    <link rel="icon" href="/favicon-16.png" sizes="16x16" type="image/png" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
    <link rel="alternate icon" href="/favicon.ico" sizes="32x32" />
    <meta name="theme-color" content="#0b0b0f" />
    <link rel="stylesheet" href="../style.css" />
  </head>

  <body>
    <nav class="nav">
      <div class="wrap nav-inner">
        <a class="brand" href="../">
          <svg width="22" height="22" viewBox="0 0 100 100" aria-hidden="true">
            <rect width="100" height="100" rx="22" fill="#0b0b0f" />
            <path
              d="M50 8C53 34 66 47 92 50C66 53 53 66 50 92C47 66 34 53 8 50C34 47 47 34 50 8Z"
              fill="#ff3b30"
            />
            <line x1="18" y1="82" x2="82" y2="18" stroke="#0b0b0f" stroke-width="9" />
          </svg>
          Slop Blocker
        </a>
        <div class="nav-links">
          <a class="hide-sm" href="../#how">How it works</a>
          <a class="hide-sm" href="../#install">Install</a>
          <a href="${REPO}">GitHub</a>
        </div>
      </div>
    </nav>

    <main class="wrap prose">
      <a class="backlink" href="../">&larr; Back to Slop Blocker</a>
      <h1>${escapeHtml(title)}</h1>
      ${updated ? `<p class="updated">${inline(updated)}</p>` : ''}
      ${body}
    </main>

    <footer>
      <div class="wrap foot-inner">
        <span>Slop Blocker &middot; MIT licensed &middot; no analytics on this page either.</span>
        <span class="foot-links">
          <a href="../">Home</a>
          <a href="${REPO}/blob/main/PRIVACY.md">Markdown source</a>
          <a href="${REPO}/blob/main/SECURITY.md">Security</a>
          <a href="${REPO}">GitHub</a>
        </span>
      </div>
    </footer>
  </body>
</html>
`;
}

export { convert, inline, page };

/** Writes files only when run directly, so tests can import the converter. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const markdown = await readFile(SOURCE, 'utf8');
  await mkdir(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, 'index.html');
  await writeFile(out, page(convert(markdown)));
  console.log(`[privacy] ${path.relative(ROOT, out)} <- ${path.relative(ROOT, SOURCE)}`);
}
