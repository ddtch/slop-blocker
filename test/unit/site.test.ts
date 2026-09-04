// The published site: that its page list, its canonical tags and its sitemap
// all agree.
//
// These drift silently. A new page that nobody added to the sitemap, or a
// canonical pointing at a URL the sitemap does not list, produces no error
// anywhere — it just quietly stops being found, or gets indexed under two
// names. So the three sources are compared against each other here.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOCS = new URL('../../docs/', import.meta.url).pathname;
const SITE = 'https://slopblocker.nnnada.com';

/** Every index.html under docs/, as the URL it is served at. */
function pageUrls(): string[] {
  const urls: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), `${prefix}${entry.name}/`);
      } else if (entry.name === 'index.html') {
        urls.push(`${SITE}/${prefix}`);
      }
    }
  };
  walk(DOCS, '');
  return urls.sort();
}

const read = (path: string) => readFileSync(join(DOCS, path), 'utf8');
const sitemap = read('sitemap.xml');
const robots = read('robots.txt');

const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!).sort();

describe('sitemap', () => {
  it('lists exactly the pages that exist, no more and no fewer', () => {
    expect(sitemapUrls).toEqual(pageUrls());
  });

  it('is well-formed enough to be parsed', () => {
    expect(sitemap).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(sitemap.match(/<url>/g)?.length).toBe(sitemapUrls.length);
  });

  it('lists only absolute https URLs on the site\'s own host', () => {
    for (const url of sitemapUrls) expect(url.startsWith(`${SITE}/`)).toBe(true);
  });

  // A page whose canonical disagrees with the sitemap is telling search engines
  // two different things about where it lives.
  it('agrees with every page\'s canonical tag', () => {
    for (const url of sitemapUrls) {
      const path = url.slice(SITE.length + 1);
      const html = read(`${path}index.html`);
      const canonical = /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
      expect(canonical, `canonical of /${path}`).toBe(url);
    }
  });
});

describe('robots.txt', () => {
  it('points at the sitemap, at its real URL', () => {
    expect(robots).toContain(`Sitemap: ${SITE}/sitemap.xml`);
  });

  it('lets crawlers in', () => {
    expect(robots).toMatch(/User-agent:\s*\*/);
    expect(robots).toMatch(/^Allow: \/$/m);
  });

  // GitHub Pages serves everything in docs/. The repository's own Markdown
  // lives there too, and would otherwise be indexed as plain-text duplicates of
  // pages that already exist on GitHub.
  it('keeps the repository documents out of search results', () => {
    const served = readdirSync(DOCS).filter((name) => name.endsWith('.md'));
    expect(served.length).toBeGreaterThan(0);
    for (const name of served) expect(robots).toContain(`Disallow: /${name}`);
  });

  // The og:image is fetched by link-preview crawlers; blocking it would break
  // every share of the page.
  it('does not block the screenshots', () => {
    expect(robots).not.toMatch(/Disallow:.*screenshots/);
    const og = /<meta property="og:image" content="([^"]+)"/.exec(read('index.html'))?.[1];
    expect(og).toContain('/screenshots/');
  });
});
