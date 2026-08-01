// src/lib/dialectSynonyms.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  attachDialectSynonyms,
  buildDialectSets,
  parseDialectDataPage,
  parseVarietyMetadata,
  splitDataPageTitle,
} from './dialectSynonyms.mjs';
import { parseLuaModule, stripWikiLinks } from './luaLiteral.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshot = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', '..', 'data', 'dialect-synonyms.json'), 'utf8')
);
const pageByTitle = new Map(snapshot.pages.map((p) => [p.title, p]));
const metadata = parseVarietyMetadata(snapshot.metadataContent);

test('luaLiteral parses tables that are array and hash at once', () => {
  const { fields } = parseLuaModule(`
    local export = {}
    -- a comment
    export.title = "Yoruba varieties and languages: %s"
    export.varieties = {
      { name = "Family", { name = "Group", lat = 7.5, long = -1.25, "positional" } },
    }
    return export
  `);
  assert.equal(fields.title, 'Yoruba varieties and languages: %s');
  const family = fields.varieties.array[0];
  assert.equal(family.map.name, 'Family');
  assert.equal(family.array[0].map.lat, 7.5);
  assert.equal(family.array[0].map.long, -1.25);
  assert.equal(family.array[0].array[0], 'positional');
});

test('luaLiteral reports a value outside the subset instead of guessing', () => {
  const { fields, unsupported } = parseLuaModule(`
    export.gloss = "kept"
    export.computed = require("Module:elsewhere")
  `);
  assert.equal(fields.gloss, 'kept');
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].key, 'computed');
});

test('stripWikiLinks reduces wikitext to plain text', () => {
  assert.equal(stripWikiLinks('[[stomach]], [[inside]]'), 'stomach, inside');
  assert.equal(stripWikiLinks('[[Ikarẹ Akoko|Ìkàrẹ́ Àkókó]]'), 'Ìkàrẹ́ Àkókó');
});

test('a data page yields a gloss and region -> terms, discarding empty cells', () => {
  const page = pageByTitle.get('Module:dialect synonyms/yo/inú');
  const parsed = parseDialectDataPage(page.content);
  assert.equal(parsed.gloss, 'stomach, inside, interior, etc.');
  assert.deepEqual(parsed.syns.Ijebu, [{ term: 'unọ́', gloss: null, qualifier: null }]);
  assert.deepEqual(parsed.syns['Ekiti-Ado'].map((t) => t.term), ['ụnụ́', 'ịnụ́']);
  // "Ao" is `{ "" }` upstream: no data for that variety, so it is absent
  // rather than present as a blank term.
  assert.equal('Ao' in parsed.syns, false);
  assert.equal(parsed.unsupported.length, 0);
});

test('variety metadata indexes leaves with their ancestry and coordinates', () => {
  assert.ok(metadata.varieties.size > 200);
  assert.equal(metadata.titlePrefix, 'Yoruba varieties and languages:');
  assert.equal(metadata.notes.length, 1);

  const ijebu = metadata.varieties.get('Ijebu');
  assert.equal(ijebu.group, 'Southeast Yoruba');
  assert.equal(typeof ijebu.lat, 'number');

  // A leaf wins over a same-named ancestor, since that is the level a data
  // page's region key denotes.
  const akungba = metadata.varieties.get('Akoko-E-Akungba');
  assert.equal(akungba.display, 'Àkùngbá Àkókó');
  assert.equal(akungba.isLeaf, true);
});

test('splitDataPageTitle separates the sense id', () => {
  assert.deepEqual(splitDataPageTitle('Module:dialect synonyms/yo/ilé'), { term: 'ilé', senseId: null });
  assert.deepEqual(splitDataPageTitle('Module:dialect synonyms/yo/funfun/white'), {
    term: 'funfun',
    senseId: 'white',
  });
});

test('sets are grouped in the metadata tree order, not alphabetically', () => {
  const { sets } = buildDialectSets(
    [pageByTitle.get('Module:dialect synonyms/yo/ilé')],
    metadata
  );
  assert.equal(sets.length, 1);
  const [ile] = sets;
  assert.equal(ile.term, 'ilé');
  assert.equal(ile.gloss, 'house');

  // Southeast comes first in the module's own ordering.
  assert.equal(ile.groups[0].group, 'Southeast Yoruba');
  const first = ile.groups[0].varieties[0];
  assert.equal(first.display, 'Ìdóàní');
  assert.deepEqual(first.terms.map((t) => t.term), ['ulí']);

  // Every region resolved to a known variety, so nothing landed in a null group.
  assert.equal(ile.groups.every((g) => g.group !== null), true);
});

test('inline <t:> and <q:> annotations become gloss and qualifier, not part of the term', () => {
  const { sets } = buildDialectSets([pageByTitle.get('Module:dialect synonyms/yo/fà')], metadata);
  const annotated = sets[0].groups
    .flatMap((g) => g.varieties)
    .flatMap((v) => v.terms)
    .filter((t) => t.gloss);
  assert.ok(annotated.length > 0, 'the fà dataset has term-level glosses');
  for (const t of annotated) {
    assert.equal(/[<>]/.test(t.term), false, `wikitext leaked into a term: ${t.term}`);
  }
  assert.ok(annotated.some((t) => t.gloss === 'to pull'));
});

test('the whole snapshot parses: 140 datasets, no unsupported constructs', () => {
  const { sets, warnings } = buildDialectSets(snapshot.pages, metadata);
  assert.equal(sets.length, 140);
  assert.ok(sets.reduce((n, s) => n + s.termCount, 0) > 6000);
  // The only expected warning is an upstream typo in a region key on `orí`.
  for (const w of warnings) assert.ok(w.unknownRegions, `unexpected warning: ${JSON.stringify(w)}`);
});

test('attachment disambiguates homographs by gloss overlap', () => {
  const entries = [
    {
      id: 'funfun-verb',
      headword: 'funfun',
      canonicalForm: { value: 'funfun' },
      senses: [{ glosses: ['to be white'] }],
    },
    {
      id: 'funfun-noun',
      headword: 'funfun',
      canonicalForm: { value: 'funfun' },
      senses: [{ glosses: ['the colour white'] }],
    },
  ];
  const { sets } = buildDialectSets(
    [
      pageByTitle.get('Module:dialect synonyms/yo/funfun/to be white'),
      pageByTitle.get('Module:dialect synonyms/yo/funfun/white'),
    ],
    metadata
  );

  const report = attachDialectSynonyms(entries, sets);
  assert.equal(report.attached, 2);
  const verb = entries.find((e) => e.id === 'funfun-verb');
  assert.equal(verb.dialectSynonyms.length, 1);
  assert.equal(verb.dialectSynonyms[0].senseId, 'to be white');
});

test('a headword with several datasets keeps all of them', () => {
  const entries = [
    { id: 'only', headword: 'funfun', canonicalForm: { value: 'funfun' }, senses: [] },
  ];
  const { sets } = buildDialectSets(
    [
      pageByTitle.get('Module:dialect synonyms/yo/funfun/to be white'),
      pageByTitle.get('Module:dialect synonyms/yo/funfun/white'),
    ],
    metadata
  );
  attachDialectSynonyms(entries, sets);
  assert.equal(entries[0].dialectSynonyms.length, 2);
});

test('every entry gets the field, and an unmatched dataset is reported not dropped silently', () => {
  const entries = [{ id: 'x', headword: 'zzz', canonicalForm: { value: 'zzz' }, senses: [] }];
  const { sets } = buildDialectSets([pageByTitle.get('Module:dialect synonyms/yo/ilé')], metadata);
  const report = attachDialectSynonyms(entries, sets);

  assert.deepEqual(entries[0].dialectSynonyms, [], 'field present even when empty');
  assert.equal(report.attached, 0);
  assert.equal(report.unmatched.length, 1);
  assert.equal(report.unmatched[0].term, 'ilé');
});
