#!/usr/bin/env node
// src/fetch-dialect-synonyms.mjs
//
// Downloads Wiktionary's Yoruba dialect-synonym source modules and writes a
// snapshot to data/dialect-synonyms.json.
//
// Run separately from the build, not inside it, for two reasons: the build
// stays offline and reproducible, and the snapshot is a reviewable diff - a
// Wiktionary edit shows up as a commit rather than silently changing a
// release. The scheduled refresh workflow runs this immediately before
// normalize.mjs, exactly as it already does for the Kaikki extract.
//
// Usage:
//   node src/fetch-dialect-synonyms.mjs [--out=path]

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { DATA_PAGE_PREFIX, METADATA_PAGE } from './lib/dialectSynonyms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const API = 'https://en.wiktionary.org/w/api.php';
// Module namespace. Anonymous API access is fine, but a real UA is required
// by Wikimedia's policy for automated clients.
const MODULE_NS = 828;
const USER_AGENT = 'kaikki-yoruba dialect-synonym fetcher (https://github.com/SpeakNigeriaOrg/kaikki-yoruba)';
const TITLES_PER_REQUEST = 50;

async function api(params) {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ format: 'json', formatversion: '2', ...params })) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url.pathname}${url.search}`);
  const json = await res.json();
  if (json.error) throw new Error(`API error: ${json.error.code} ${json.error.info}`);
  return json;
}

async function listDataPages() {
  const titles = [];
  let cont;
  do {
    const json = await api({
      action: 'query',
      list: 'allpages',
      apnamespace: String(MODULE_NS),
      apprefix: DATA_PAGE_PREFIX.replace(/^Module:/, ''),
      aplimit: '500',
      ...(cont || {}),
    });
    for (const page of json.query.allpages) titles.push(page.title);
    cont = json.continue;
  } while (cont);
  // The bare ".../yo/" blank template is a create-prompt stub, not a term.
  return titles.filter((t) => t !== DATA_PAGE_PREFIX).sort();
}

async function fetchContent(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += TITLES_PER_REQUEST) {
    const batch = titles.slice(i, i + TITLES_PER_REQUEST);
    const json = await api({
      action: 'query',
      prop: 'revisions',
      rvprop: 'content|ids',
      rvslots: 'main',
      titles: batch.join('|'),
    });
    for (const page of json.query.pages) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (typeof content === 'string') out.set(page.title, { content, revid: page.revisions[0].revid });
    }
    process.stdout.write(`      fetched ${Math.min(i + batch.length, titles.length)}/${titles.length}\r`);
  }
  process.stdout.write('\n');
  return out;
}

async function main() {
  const outArg = process.argv.slice(2).find((a) => a.startsWith('--out='));
  const outPath = outArg
    ? path.resolve(process.cwd(), outArg.split('=')[1])
    : path.join(rootDir, 'data', 'dialect-synonyms.json');

  console.log(`[1/3] Listing ${DATA_PAGE_PREFIX}* ...`);
  const titles = await listDataPages();
  console.log(`      ${titles.length} data pages`);

  console.log(`[2/3] Fetching ${METADATA_PAGE} ...`);
  const metadata = await fetchContent([METADATA_PAGE]);
  const metadataPage = metadata.get(METADATA_PAGE);
  if (!metadataPage) throw new Error(`${METADATA_PAGE} not found - the module may have moved`);

  console.log(`[3/3] Fetching data pages in batches of ${TITLES_PER_REQUEST} ...`);
  const pages = await fetchContent(titles);
  const missing = titles.filter((t) => !pages.has(t));
  if (missing.length > 0) console.log(`      warning: ${missing.length} page(s) returned no content: ${missing.join(', ')}`);

  // Sorted keys and no timestamp: two runs over an unchanged Wiktionary
  // produce byte-identical output, so the snapshot only ever shows real edits.
  const snapshot = {
    source: 'en.wiktionary.org',
    metadataPage: METADATA_PAGE,
    metadataRevid: metadataPage.revid,
    metadataContent: metadataPage.content,
    pages: [...pages.entries()]
      .filter(([title]) => title !== METADATA_PAGE)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([title, { content, revid }]) => ({ title, revid, content })),
  };

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log('\nDone.');
  console.log(`  ${path.relative(rootDir, outPath)}   ${snapshot.pages.length} data pages + metadata r${snapshot.metadataRevid}`);
}

main().catch((err) => {
  console.error(`fetch-dialect-synonyms failed: ${err.message}`);
  process.exit(1);
});
