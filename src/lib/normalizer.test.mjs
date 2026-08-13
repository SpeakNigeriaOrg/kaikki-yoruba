import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './parser.mjs';
import { normalizeRecord, normalizeRecords, SENSE_RELATION_FIELD_NAMES } from './normalizer.mjs';
import { buildTableMarkers } from './relationDebris.mjs';
import { parseVarietyMetadata } from './dialectSynonyms.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleFixturePath = path.resolve(__dirname, '..', '..', 'data', 'sample.jsonl');

// Same helper as relationDebris.test.mjs. Without markers the debris filter is
// a no-op, which is the trap in every assertion about how much data survives.
function markersFromSnapshot() {
  const snapshotPath = path.resolve(__dirname, '..', '..', 'data', 'dialect-synonyms.json');
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  return buildTableMarkers(parseVarietyMetadata(snapshot.metadataContent));
}

test('normalizeRecord preserves canonicalForm shape (shared with yoruba-student-dict/shared)', () => {
  const record = {
    word: 'ilé',
    pos: 'noun',
    forms: [{ form: 'ilé', tags: ['canonical'] }],
    senses: [{ id: 's1', glosses: ['home'] }],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.canonicalForm, {
    value: 'ilé',
    inferenceMethod: 'explicit_canonical_tag',
    confidence: 1.0,
    originalValue: 'ilé',
  });
});

test('normalizeRecord falls back to the raw headword when no form is tagged canonical', () => {
  const record = { word: 'X', pos: 'character', forms: [], senses: [{ id: 's1', glosses: ['a letter'] }] };
  const entry = normalizeRecord(record, 0);
  assert.equal(entry.canonicalForm.inferenceMethod, 'fallback_headword');
  assert.equal(entry.canonicalForm.value, 'X');
  assert.equal(entry.canonicalForm.confidence, 0.5);
});

test('normalizeRecord extracts etymologyTemplates raw and unfiltered - the extension this repo adds', () => {
  const record = {
    word: 'dòdò',
    pos: 'noun',
    senses: [{ id: 's1', glosses: ['fried plantain'] }],
    etymology_templates: [
      { name: 'compound', args: { 1: 'yo', 2: 'di', 3: 'odò' }, expansion: 'ignored - not part of the canonical shape' },
      { name: 'etymid', args: { 1: 'yo', 2: 'some concept' } },
    ],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.etymologyTemplates, [
    { name: 'compound', args: { 1: 'yo', 2: 'di', 3: 'odò' } },
    { name: 'etymid', args: { 1: 'yo', 2: 'some concept' } },
  ]);
});

test('normalizeRecord defaults etymologyTemplates to an empty array when the record has none', () => {
  const record = { word: 'x', pos: 'noun', senses: [] };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.etymologyTemplates, []);
});

test("normalizeRecord extracts each sense's altOf raw - the other extension this repo adds", () => {
  const record = {
    word: 'wó',
    pos: 'verb',
    senses: [{ id: 's1', glosses: ['alternative form of wò'], alt_of: [{ word: 'wò', extra: 'to look at' }] }],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.senses[0].altOf, [{ word: 'wò', extra: 'to look at' }]);
});

test('normalizeRecord defaults a sense with no alt_of to an empty array', () => {
  const record = { word: 'x', pos: 'noun', senses: [{ id: 's1', glosses: ['a thing'] }] };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.senses[0].altOf, []);
});

test('normalizeRecords on the real sample fixture produces 16 entries, all with the new fields present', () => {
  const { records } = parseJsonl(sampleFixturePath);
  const entries = normalizeRecords(records);
  assert.equal(entries.length, 16);
  for (const entry of entries) {
    assert.ok(Array.isArray(entry.etymologyTemplates), `${entry.id} is missing etymologyTemplates`);
    for (const sense of entry.senses) {
      assert.ok(Array.isArray(sense.altOf), `${entry.id} has a sense missing altOf`);
    }
  }
});

test('normalizeRecord extracts etymologyMorphemes, tagging bound vs free per-morpheme (not per-template)', () => {
  const record = {
    word: 'àmọ̀tẹ́kùn',
    pos: 'noun',
    senses: [{ id: 's1', glosses: ['leopard'] }],
    etymology_templates: [
      {
        name: 'af',
        args: {
          1: 'yo', 2: 'à-', 3: 'mọ̀', 4: 'tó', 5: 'tó', 6: 'ẹkùn',
          t1: 'nominalizing prefix', t2: 'to know', t3: 'that', t4: 'is equal to, similar to', t5: 'leopard',
        },
      },
    ],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.etymologyMorphemes, [
    { form: 'à-', gloss: 'nominalizing prefix', bound: true, analysis: 0, analysisTemplate: 'af' },
    { form: 'mọ̀', gloss: 'to know', bound: false, analysis: 0, analysisTemplate: 'af' },
    { form: 'tó', gloss: 'that', bound: false, analysis: 0, analysisTemplate: 'af' },
    { form: 'tó', gloss: 'is equal to, similar to', bound: false, analysis: 0, analysisTemplate: 'af' },
    { form: 'ẹkùn', gloss: 'leopard', bound: false, analysis: 0, analysisTemplate: 'af' },
  ]);
});

test('normalizeRecord recognizes af/affix/prefix templates for etymologyMorphemes (previously wholesale excluded elsewhere)', () => {
  for (const name of ['af', 'affix', 'prefix']) {
    const record = {
      word: 'x', pos: 'noun', senses: [{ id: 's1', glosses: ['thing'] }],
      etymology_templates: [{ name, args: { 1: 'yo', 2: 'a-', 3: 'b' } }],
    };
    const entry = normalizeRecord(record, 0);
    assert.equal(entry.etymologyMorphemes.length, 2, `expected ${name} template to be recognized`);
  }
});

test('normalizeRecord reads {{reduplication}} as a single-term template (arg 3 is display text, arg 4/t is a gloss)', () => {
  // wówó "mushroom" - the common shape: arg 3 repeats arg 2, gloss in |t=.
  // Read as multi-term this produced two identical "wó" morphemes, both with
  // a null gloss, because the gloss was looked up as t1.
  const repeated = normalizeRecord({
    word: 'wówó', pos: 'noun', senses: [{ id: 's1', glosses: ['mushroom'] }],
    etymology_templates: [{ name: 'reduplication', args: { 1: 'yo', 2: 'wó', 3: 'wó', t: 'to crumble, to break' } }],
  }, 0);
  assert.deepEqual(repeated.etymologyMorphemes, [
    { form: 'wó', gloss: 'to crumble, to break', bound: false, analysis: 0, analysisTemplate: 'reduplication' },
  ]);

  // dáadáa - positional |4= gloss with an empty |3=. Read as multi-term this
  // emitted a morpheme whose *form* was the English string "to be good".
  const positional = normalizeRecord({
    word: 'dáadáa', pos: 'adv', senses: [{ id: 's1', glosses: ['well'] }],
    etymology_templates: [{ name: 'reduplication', args: { 1: 'yo', 2: 'dáa', 3: '', 4: 'to be good' } }],
  }, 0);
  assert.deepEqual(positional.etymologyMorphemes, [
    { form: 'dáa', gloss: 'to be good', bound: false, analysis: 0, analysisTemplate: 'reduplication' },
  ]);

  // No gloss supplied at all is still one morpheme, not two.
  const bare = normalizeRecord({
    word: 'pẹtẹpẹtẹ', pos: 'noun', senses: [{ id: 's1', glosses: ['mud'] }],
    etymology_templates: [{ name: 'reduplication', args: { 1: 'yo', 2: 'pẹtẹ', 3: 'pẹtẹ' } }],
  }, 0);
  assert.deepEqual(bare.etymologyMorphemes, [
    { form: 'pẹtẹ', gloss: null, bound: false, analysis: 0, analysisTemplate: 'reduplication' },
  ]);
});

test('normalizeRecord still reads multi-term templates positionally (the single-term branch must not leak into them)', () => {
  const entry = normalizeRecord({
    word: 'x', pos: 'noun', senses: [{ id: 's1', glosses: ['thing'] }],
    etymology_templates: [{ name: 'compound', args: { 1: 'yo', 2: 'a', 3: 'b', t1: 'first', t2: 'second' } }],
  }, 0);
  assert.deepEqual(entry.etymologyMorphemes, [
    { form: 'a', gloss: 'first', bound: false, analysis: 0, analysisTemplate: 'compound' },
    { form: 'b', gloss: 'second', bound: false, analysis: 0, analysisTemplate: 'compound' },
  ]);
});

test('normalizeRecord groups etymologyMorphemes by decomposition, so competing analyses stay apart', () => {
  // nìtorí: Wiktionary records two ways of breaking the same word down. Flat,
  // they read as one four-part word; they are alternatives.
  const entry = normalizeRecord({
    word: 'nítorí', pos: 'prep', senses: [{ id: 's1', glosses: ['because of'] }],
    etymology_templates: [
      { name: 'compound', args: { 1: 'yo', 2: 'ní', 3: 'ìtorí' } },
      { name: 'compound', args: { 1: 'yo', 2: 'ní', 3: 'ti', 4: 'orí', t1: 'on, at', t2: 'of', t3: 'head, reason' } },
    ],
  }, 0);
  assert.deepEqual(
    entry.etymologyMorphemes.map((m) => [m.analysis, m.form]),
    [[0, 'ní'], [0, 'ìtorí'], [1, 'ní'], [1, 'ti'], [1, 'orí']]
  );

  // Templates that produce no morphemes must not consume an analysis number,
  // or the groups downstream come out sparse and misnumbered.
  const skipped = normalizeRecord({
    word: 'x', pos: 'noun', senses: [{ id: 's1', glosses: ['thing'] }],
    etymology_templates: [
      { name: 'cog', args: { 1: 'ig', 2: 'something' } },
      { name: 'compound', args: { 1: 'yo', 2: 'a', 3: 'b' } },
    ],
  }, 0);
  assert.deepEqual(skipped.etymologyMorphemes.map((m) => m.analysis), [0, 0]);
});

test('normalizeRecord excludes cross-language templates from etymologyMorphemes (numeric arg is a language code, not a Yoruba word)', () => {
  const record = {
    word: 'x', pos: 'noun', senses: [{ id: 's1', glosses: ['thing'] }],
    etymology_templates: [{ name: 'cog', args: { 1: 'en', 2: 'something' } }],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.etymologyMorphemes, []);
});

test('normalizeRecord folds every sense-level relation list onto the sense, under the entry-level names', () => {
  const record = {
    word: 'sun',
    pos: 'verb',
    senses: [
      { id: 's1', glosses: ['to roast'], synonyms: [{ word: 'yan' }, { word: 'wì' }] },
      {
        id: 's2',
        glosses: ['to burn; to set on fire'],
        synonyms: [{ word: 'jó' }, { word: 'jóná' }],
        derived: [{ word: 'ibùsùn' }],
        related: [{ word: 'iná' }],
        antonyms: [{ word: 'pa' }],
        coordinate_terms: [{ word: 'rè' }],
        hyponyms: [{ word: 'dáná' }],
        hypernyms: [{ word: 'ṣe' }],
      },
    ],
  };
  const entry = normalizeRecord(record, 0);

  assert.deepEqual(
    entry.senses[0].synonyms.map((s) => s.text),
    ['yan', 'wì']
  );
  // Each meaning keeps its OWN list. Pooling them onto the entry is what threw
  // away which definition a synonym belongs to.
  assert.deepEqual(
    entry.senses[1].synonyms.map((s) => s.text),
    ['jó', 'jóná']
  );
  assert.deepEqual(entry.senses[1].derivedTerms.map((s) => s.text), ['ibùsùn']);
  assert.deepEqual(entry.senses[1].relatedTerms.map((s) => s.text), ['iná']);
  assert.deepEqual(entry.senses[1].antonyms.map((s) => s.text), ['pa']);
  assert.deepEqual(entry.senses[1].coordinateTerms.map((s) => s.text), ['rè']);
  assert.deepEqual(entry.senses[1].hyponyms.map((s) => s.text), ['dáná']);
  assert.deepEqual(entry.senses[1].hypernyms.map((s) => s.text), ['ṣe']);

  // Identical item shape to an entry-level list, so downstream resolution and
  // rendering is one code path rather than two.
  assert.deepEqual(entry.senses[0].synonyms[0], {
    type: 'term',
    text: 'yan',
    english: null,
    lang: null,
    langCode: null,
    roman: null,
  });
});

test('a sense with no relation lists gets every field as an empty array, not undefined', () => {
  const record = { word: 'ilé', pos: 'noun', senses: [{ id: 's1', glosses: ['house'] }] };
  const entry = normalizeRecord(record, 0);
  for (const field of SENSE_RELATION_FIELD_NAMES) {
    assert.deepEqual(entry.senses[0][field], [], `expected ${field} to be []`);
  }
});

test('normalizeRecord extracts the entry-level coordinate/hyponym/hypernym lists that were never wired up', () => {
  const record = {
    word: 'màlúù',
    pos: 'noun',
    senses: [{ id: 's1', glosses: ['cow'] }],
    coordinate_terms: [{ word: 'ewúrẹ́' }],
    hyponyms: [{ word: 'akọ màlúù' }],
    hypernyms: [{ word: 'ẹranko' }],
  };
  const entry = normalizeRecord(record, 0);
  assert.deepEqual(entry.coordinateTerms.map((r) => r.text), ['ewúrẹ́']);
  assert.deepEqual(entry.hyponyms.map((r) => r.text), ['akọ màlúù']);
  assert.deepEqual(entry.hypernyms.map((r) => r.text), ['ẹranko']);
});

test('a sense-level list that is rendered-table text is dropped whole and reported', () => {
  const record = {
    word: 'sun',
    pos: 'verb',
    senses: [
      { id: 's1', glosses: ['to roast'], synonyms: [{ word: 'yan' }] },
      {
        id: 's2',
        glosses: ['to sleep'],
        // One marker condemns the list: this is the caption of a flattened
        // {{dialect synonyms}} table, arriving as a peer of the real terms.
        synonyms: [
          { english: 'to sleep', translation: 'to sleep', word: 'Yoruba varieties and languages: sùnview map' },
          { word: 'Ìjẹ̀bú' },
          { word: 'sùn' },
        ],
      },
    ],
  };
  const drops = [];
  const entry = normalizeRecord(record, 0, {
    markers: markersFromSnapshot(),
    onTableText: (drop) => drops.push(drop),
  });

  assert.deepEqual(entry.senses[0].synonyms.map((s) => s.text), ['yan']);
  assert.deepEqual(entry.senses[1].synonyms, [], 'the table list is dropped whole, including the real sùn in it');
  assert.equal(drops.length, 1);
  // Index-free field label, so normalize.mjs's tally stays one line per field.
  assert.equal(drops[0].field, 'sense synonyms');
  assert.equal(drops[0].senseIndex, 1);
  assert.equal(drops[0].id, 's1');
});

// deriveEntryId was changed to read the raw record instead of the normalized
// senses, so the reporter closure could be built before extractSenses runs. It
// is the one part of this change that could silently renumber every entry in the
// artifact, so it gets its own test rather than relying on the corpus check.
test('deriveEntryId still takes the first sense id that exists, and still falls back when there is none', () => {
  const withIds = normalizeRecord(
    { word: 'fa', pos: 'verb', senses: [{ glosses: ['to pull'] }, { id: 'en-fa-yo-verb-XYZ', glosses: ['to suck'] }] },
    0
  );
  assert.equal(withIds.id, 'en-fa-yo-verb-XYZ', 'skips the sense with no id, takes the next one');

  const noIds = normalizeRecord({ word: 'Àkàrà', pos: 'noun', senses: [{ glosses: ['bean cake'] }] }, 0);
  assert.match(noIds.id, /^generated-akara-noun-\d+$/);
});

test('normalizeRecords on the real full Kaikki corpus finds real component-decomposition templates and real alt_of cross-references', () => {
  const realCorpusPath = path.resolve(__dirname, '..', '..', '..', 'yorubadict', 'data', 'dictionary-Yoruba.jsonl');
  let records;
  try {
    ({ records } = parseJsonl(realCorpusPath));
  } catch {
    // The real corpus is a sibling-repo dev fixture, not part of this
    // repo and not guaranteed to exist in every environment (e.g. CI) -
    // skip rather than fail if it's not present.
    return;
  }
  const entries = normalizeRecords(records);
  assert.equal(entries.length, 6273);

  const componentTemplateNames = new Set(['compound', 'com', 'compound+', 'reduplication', 'blend']);
  const hasComponentTemplate = entries.some((e) => e.etymologyTemplates.some((t) => componentTemplateNames.has(t.name)));
  assert.ok(hasComponentTemplate, 'expected at least one real compound/component etymology template in the real corpus');

  const hasAltOf = entries.some((e) => e.senses.some((s) => s.altOf.length > 0));
  assert.ok(hasAltOf, 'expected at least one real alt_of cross-reference in the real corpus');
});

test('normalizeRecords recovers the sense-level relation lists that used to be dropped', () => {
  const realCorpusPath = path.resolve(__dirname, '..', '..', '..', 'yorubadict', 'data', 'dictionary-Yoruba.jsonl');
  let records;
  try {
    ({ records } = parseJsonl(realCorpusPath));
  } catch {
    return; // sibling-repo dev fixture; see the note above
  }

  const count = (entries, field) =>
    entries.reduce((n, e) => n + e.senses.reduce((m, s) => m + s[field].length, 0), 0);

  // The source holds 11,084 sense-level relation items, every one of which used
  // to be dropped. Two passes are asserted because how much survives depends on
  // whether markers were supplied, and asserting filtered numbers from an
  // unmarked call is the easy mistake here.
  //
  // With NO markers the debris filter is nearly a no-op - but not entirely one.
  // isTableMarker treats a bare "-" as a marker unconditionally, since a dash is
  // a "no data for this variety" cell and never a term, and that alone condemns
  // 11 synonym lists holding 386 items plus 242 relatedTerms.
  const unmarked = normalizeRecords(records);
  assert.equal(count(unmarked, 'synonyms'), 5678, '6,064 in source, less the 386 in dash-condemned lists');
  assert.equal(count(unmarked, 'derivedTerms'), 2814);
  assert.equal(count(unmarked, 'relatedTerms'), 1646, '1,888 in source, less 242');
  assert.equal(count(unmarked, 'antonyms'), 112);
  assert.equal(count(unmarked, 'coordinateTerms'), 101);
  assert.equal(count(unmarked, 'hyponyms'), 95);
  assert.equal(count(unmarked, 'hypernyms'), 10);

  // With the real markers, the flattened dialect tables go too, and what is left
  // is what downstream actually receives.
  const filtered = normalizeRecords(records, { markers: markersFromSnapshot() });
  const filteredTotal = SENSE_RELATION_FIELD_NAMES.reduce((n, f) => n + count(filtered, f), 0);
  assert.equal(filteredTotal, 9346);
  assert.equal(count(filtered, 'synonyms'), 4569);
  assert.equal(count(filtered, 'derivedTerms'), 2813);

  // Counted over the record array. The id-keyed artifact normalize.mjs writes is
  // two items and one sense lighter, because two records share a sense id
  // (gọlọmiṣọ) and Object.fromEntries collapses them - the same reason 6,273
  // records have always produced 6,272 entries.
  const sensesWithRelations = filtered.reduce(
    (n, e) => n + e.senses.filter((s) => SENSE_RELATION_FIELD_NAMES.some((f) => s[f].length > 0)).length,
    0
  );
  assert.equal(sensesWithRelations, 3655);

  // The motivating case. "sun" is seven separate etymology entries; the second
  // has two meanings whose synonym sets are entirely different, which is the
  // whole reason these belong on the sense and not on the word.
  const sun2 = filtered.find((e) => e.headword === 'sun' && e.etymologyNumber === '2');
  assert.deepEqual(sun2.senses[0].glosses, ['to roast']);
  assert.deepEqual(sun2.senses[0].synonyms.map((s) => s.text), ['yan', 'wì']);
  assert.deepEqual(sun2.senses[1].glosses, ['to burn; to set on fire']);
  assert.deepEqual(sun2.senses[1].synonyms.map((s) => s.text), ['jó', 'jóná', 'dáná sun']);
  // Pooling these onto the entry would claim "yan" is a word for setting fires.

  // And the first etymology's only synonym item is a flattened table caption, so
  // that list correctly ends up empty rather than importing garbage.
  const sun1 = filtered.find((e) => e.headword === 'sun' && e.etymologyNumber === '1');
  assert.deepEqual(sun1.senses[0].glosses, ['to sleep']);
  assert.deepEqual(sun1.senses[0].synonyms, []);
});
