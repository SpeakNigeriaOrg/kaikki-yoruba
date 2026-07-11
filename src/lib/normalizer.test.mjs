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
    { form: 'à-', gloss: 'nominalizing prefix', bound: true },
    { form: 'mọ̀', gloss: 'to know', bound: false },
    { form: 'tó', gloss: 'that', bound: false },
    { form: 'tó', gloss: 'is equal to, similar to', bound: false },
    { form: 'ẹkùn', gloss: 'leopard', bound: false },
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
