// src/lib/dialectSynonyms.mjs
//
// Wiktionary's Yoruba dialect tables, imported from source instead of salvaged
// from Kaikki's output.
//
// `{{dialect synonyms|yo|inú}}` on a Wiktionary page transcludes
// Module:dialect synonyms/yo/inú, a Lua table of region -> terms plus a gloss;
// the region hierarchy and display names live in Module:dialect synonyms/yo.
// wiktextract expands that template, flattens the rendered HTML table to text,
// and emits every text run - table caption, footnotes and all - as a separate
// `synonyms` item, gluing cells together with an arbitrary Wiktionary page
// title as separator. The result is unusable (see relationDebris.mjs), while
// the data behind it is perfectly structured. So we read the source.
//
// This module is pure: fetching lives in src/fetch-dialect-synonyms.mjs, which
// writes the snapshot these functions consume.

import { parseLuaModule, stripWikiLinks } from './luaLiteral.mjs';
import { glossOverlapScore } from './morphemeResolution.mjs';

export const DATA_PAGE_PREFIX = 'Module:dialect synonyms/yo/';
export const METADATA_PAGE = 'Module:dialect synonyms/yo';

// ---------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------

// Terms carry optional inline annotations in Wiktionary's link syntax:
// `fà<t:to pull>` is a term plus its own gloss, `x<q:...>` a qualifier. 41 of
// 6,426 terms use them, and a term-specific gloss ("small axe" where the entry
// glosses "axe") is worth keeping rather than stripping.
function parseTermAnnotations(raw) {
  const out = { term: raw, gloss: null, qualifier: null };
  out.term = raw
    .replace(/<t:([^>]*)>/g, (_, gloss) => {
      out.gloss = stripWikiLinks(gloss);
      return '';
    })
    .replace(/<q(?:q)?:([^>]*)>/g, (_, qualifier) => {
      out.qualifier = stripWikiLinks(qualifier);
      return '';
    })
    .trim();
  return out;
}

// A per-term data page: { gloss, syns: { region: [{term, gloss, qualifier}] } }.
// Empty-string terms are placeholders for "no data for this variety" and are
// dropped rather than shipped as blank pills.
export function parseDialectDataPage(src) {
  const { fields, unsupported } = parseLuaModule(src);
  const syns = Object.create(null);

  for (const [region, value] of Object.entries(fields.syns?.map || {})) {
    const terms = (value?.array || [])
      .filter((t) => typeof t === 'string')
      .map((t) => parseTermAnnotations(stripWikiLinks(t.trim())))
      .filter((t) => t.term);
    if (terms.length > 0) syns[region] = terms;
  }

  return {
    gloss: fields.gloss ? stripWikiLinks(fields.gloss) : null,
    syns,
    unsupported,
  };
}

// Walks the variety tree, indexing every node by its `name` - which is what a
// data page's region keys refer to. Depth carries the meaning the table's own
// columns describe: family > group > variety > subdialect > location. Leaves
// win on name collisions (an L3 "Ijebu" and its L4 leaf "Ijebu" both exist),
// because that is the level a region key denotes.
export function parseVarietyMetadata(src) {
  const { fields, unsupported } = parseLuaModule(src);
  const index = new Map();
  let order = 0;

  const walk = (node, path) => {
    const name = node.map?.name;
    // `text__diplay` is a typo present in the upstream source; honour both.
    const display = stripWikiLinks(node.map?.text_display ?? node.map?.text__diplay ?? name ?? '');
    const here = name ? [...path, { name, display }] : path;
    const children = node.array || [];

    if (name) {
      const isLeaf = children.length === 0;
      const existing = index.get(name);
      if (!existing || (isLeaf && !existing.isLeaf)) {
        index.set(name, {
          name,
          display: display || name,
          family: here[0]?.display || null,
          group: here[1]?.display || null,
          variety: here[2]?.display || null,
          subdialect: here.length > 4 ? here[3].display : null,
          lat: typeof node.map?.lat === 'number' ? node.map.lat : null,
          long: typeof node.map?.long === 'number' ? node.map.long : null,
          isLeaf,
          order: order++,
        });
      }
    }

    for (const child of children) if (child && child.map) walk(child, here);
  };

  for (const family of fields.varieties?.array || []) if (family && family.map) walk(family, []);

  const titlePattern = typeof fields.title === 'string' ? fields.title : null;

  return {
    titlePattern,
    // "Yoruba varieties and languages: %s" -> the caption prefix wiktextract
    // emits as a bogus synonym. Derived, not hardcoded, so an upstream
    // rewording keeps working.
    titlePrefix: titlePattern ? titlePattern.replace(/%s.*$/, '').trim() : null,
    columns: (fields.columns?.array || []).filter((c) => typeof c === 'string'),
    notes: (fields.notes?.array || []).filter((n) => typeof n === 'string'),
    varieties: index,
    unsupported,
  };
}

// ---------------------------------------------------------------
// Assembling
// ---------------------------------------------------------------

// `Module:dialect synonyms/yo/funfun/white` -> { term: 'funfun', senseId: 'white' }
export function splitDataPageTitle(title) {
  const rest = title.startsWith(DATA_PAGE_PREFIX) ? title.slice(DATA_PAGE_PREFIX.length) : title;
  const slash = rest.indexOf('/');
  if (slash < 0) return { term: rest, senseId: null };
  return { term: rest.slice(0, slash), senseId: rest.slice(slash + 1) };
}

// One dataset -> the grouped shape the UI renders, ordered by the metadata's
// own tree order so the geography reads coherently rather than alphabetically.
// Regions absent from the metadata are kept under a null group so data is
// never silently dropped; the count is reported.
function groupRegions(syns, metadata) {
  const rows = [];
  for (const [region, terms] of Object.entries(syns)) {
    const meta = metadata.varieties.get(region);
    rows.push({
      name: region,
      display: meta?.display || region,
      variety: meta?.variety || null,
      subdialect: meta?.subdialect || null,
      family: meta?.family || null,
      group: meta?.group || null,
      lat: meta?.lat ?? null,
      long: meta?.long ?? null,
      order: meta?.order ?? Number.MAX_SAFE_INTEGER,
      known: Boolean(meta),
      terms,
    });
  }
  rows.sort((a, b) => a.order - b.order);

  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.family === row.family && last.group === row.group) {
      last.varieties.push(row);
    } else {
      groups.push({ family: row.family, group: row.group, varieties: [row] });
    }
  }

  // Drop the bookkeeping fields from the shipped artifact.
  for (const g of groups) {
    g.varieties = g.varieties.map(({ order, known, family, group, ...keep }) => keep);
  }
  return { groups, unknownRegions: rows.filter((r) => !r.known).map((r) => r.name) };
}

export function buildDialectSets(dataPages, metadata) {
  const sets = [];
  const warnings = [];

  for (const page of dataPages) {
    const parsed = parseDialectDataPage(page.content);
    if (parsed.unsupported.length > 0) {
      warnings.push({ page: page.title, unsupported: parsed.unsupported });
    }
    const regionCount = Object.keys(parsed.syns).length;
    if (regionCount === 0) continue; // the blank `/yo/` template, or an empty page

    const { term, senseId } = splitDataPageTitle(page.title);
    const { groups, unknownRegions } = groupRegions(parsed.syns, metadata);
    if (unknownRegions.length > 0) {
      warnings.push({ page: page.title, unknownRegions });
    }

    sets.push({
      term,
      senseId,
      gloss: parsed.gloss,
      sourcePage: page.title,
      groups,
      termCount: Object.values(parsed.syns).reduce((n, terms) => n + terms.length, 0),
    });
  }

  return { sets, warnings };
}

// ---------------------------------------------------------------
// Attaching to entries
// ---------------------------------------------------------------

// A dataset is keyed by page title, which is a spelling, not an entry: "ga"
// is both a verb and a noun, and `id=`-qualified pages target one sense of a
// headword. Where spelling alone is ambiguous, fall back to gloss overlap -
// the same tie-break etymology-morpheme resolution already uses for
// homographs (glossOverlapScore).
export function attachDialectSynonyms(entries, sets) {
  const bySpelling = new Map();
  const add = (key, entry) => {
    if (!key) return;
    if (!bySpelling.has(key)) bySpelling.set(key, []);
    bySpelling.get(key).push(entry);
  };
  for (const entry of entries) {
    add(entry.headword, entry);
    if (entry.canonicalForm?.value !== entry.headword) add(entry.canonicalForm?.value, entry);
  }

  // Every entry gets the field, even when empty, so consumers never have to
  // distinguish "absent" from "none" (matching resolveMorphemeRelationships).
  for (const entry of entries) entry.dialectSynonyms = [];

  const report = { attached: 0, datasets: sets.length, unmatched: [], ambiguous: [] };

  for (const set of sets) {
    const candidates = bySpelling.get(set.term) || [];
    if (candidates.length === 0) {
      report.unmatched.push({ page: set.sourcePage, term: set.term });
      continue;
    }

    let target = candidates[0];
    if (candidates.length > 1) {
      // Score against the dataset's own gloss, highest overlap wins. On a tie,
      // prefer a candidate that hasn't been claimed yet: two datasets that
      // differ only by sense id (funfun "to be white" vs "white") denote two
      // senses, so they belong on two entries wherever the glosses can't tell
      // them apart. Corpus order settles what's still tied.
      let best = -1;
      let bestClaims = Infinity;
      for (const candidate of candidates) {
        const score = glossOverlapScore(set.gloss, candidate);
        const claims = candidate.dialectSynonyms.length;
        if (score > best || (score === best && claims < bestClaims)) {
          best = score;
          bestClaims = claims;
          target = candidate;
        }
      }
      report.ambiguous.push({
        page: set.sourcePage,
        candidates: candidates.map((c) => c.id),
        chose: target.id,
        glossOverlap: best,
      });
    }

    // A headword can carry several datasets (one per sense id), so this is a
    // list rather than a single object.
    target.dialectSynonyms.push({
      gloss: set.gloss,
      senseId: set.senseId,
      sourcePage: set.sourcePage,
      groups: set.groups,
    });
    report.attached += 1;
  }

  return report;
}
