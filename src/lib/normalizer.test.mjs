import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './parser.mjs';
import { normalizeRecord, normalizeRecords } from './normalizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleFixturePath = path.resolve(__dirname, '..', '..', 'data', 'sample.jsonl');

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
