// The published site: that its page list, its canonical tags and its sitemap
// all agree.
//
// These drift silently. A new page that nobody added to the sitemap, or a
// canonical pointing at a URL the sitemap does not list, produces no error
// anywhere — it just quietly stops being found, or gets indexed under two
// names. So the three sources are compared against each other here.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
/**
 * The same file with runs of whitespace collapsed. Attributes are wrapped
 * across lines by the formatter, so a regex over the raw text finds a tag on
 * one page and misses the identical tag on another.
 */
const flat = (path: string) => read(path).replace(/\s+/g, ' ');
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

describe('head of every page', () => {
  // 404.html is a page too, and gets the same treatment; it just must not be
  // in the sitemap.
  const pages = ['index.html', 'privacy/index.html', '404.html'];

  it.each(pages)('%s has a title and a description', (page) => {
    const html = flat(page);
    const title = /<title>([^<]+)<\/title>/.exec(html)?.[1];
    expect(title, 'title').toBeTruthy();
    expect(title!.length).toBeLessThan(70);

    const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1];
    expect(description, 'description').toBeTruthy();
  });

  it.each(pages)('%s declares a language and a viewport', (page) => {
    const html = read(page);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<meta charset="utf-8" />');
  });

  /*
   * A favicon link naming a file that is not there is worse than no link: the
   * browser asks, gets a 404, and falls back to nothing. So the assertion is
   * that every icon the markup promises actually exists on disk.
   */
  it.each(pages)('%s only references icons that exist', (page) => {
    const html = flat(page);
    const hrefs = [...html.matchAll(/<link rel="[^"]*icon[^"]*" href="([^"]+)"/g)].map((m) => m[1]!);
    const files = hrefs.filter((href) => !href.startsWith('data:'));

    expect(files.length, 'PNG/ICO icons declared').toBeGreaterThanOrEqual(2);
    for (const href of files) {
      expect(href.startsWith('/'), `${href} must be site-absolute`).toBe(true);
      expect(existsSync(join(DOCS, href.slice(1))), `${href} exists`).toBe(true);
    }
  });

  it.each(pages)('%s sets a theme colour', (page) => {
    expect(read(page)).toContain('name="theme-color"');
  });

  it('keeps the 404 page out of the index and out of the sitemap', () => {
    expect(read('404.html')).toContain('content="noindex, follow"');
    expect(sitemapUrls.some((url) => url.includes('404'))).toBe(false);
  });
});

describe('social previews', () => {
  const pages = ['index.html', 'privacy/index.html'];

  it.each(pages)('%s has the Open Graph tags a preview needs', (page) => {
    const html = flat(page);
    for (const property of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image']) {
      expect(html, property).toContain(`property="${property}"`);
    }
    expect(html).toContain('name="twitter:card"');
  });

  it.each(pages)('%s points og:image at an image that exists', (page) => {
    const html = flat(page);
    const url = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(url.startsWith(`${SITE}/`), 'og:image must be absolute').toBe(true);
    expect(existsSync(join(DOCS, url.slice(SITE.length + 1))), url).toBe(true);
  });

  it('declares the image size, so the preview does not reflow', () => {
    const html = flat('index.html');
    expect(html).toContain('property="og:image:width" content="1280"');
    expect(html).toContain('property="og:image:height" content="800"');
    expect(html).toContain('property="og:image:alt"');
  });

  it('describes the extension as structured data a crawler can read', () => {
    const html = read('index.html');
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(json, 'ld+json block').toBeTruthy();

    const data = JSON.parse(json!);
    expect(data['@type']).toBe('SoftwareApplication');
    expect(data.url).toBe(`${SITE}/`);
    expect(data.privacyPolicy).toBe(`${SITE}/privacy/`);
    // The page says the extension is free and MIT; the structured data must not
    // say something else to a machine.
    expect(data.isAccessibleForFree).toBe(true);
    expect(data.offers.price).toBe('0');
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
