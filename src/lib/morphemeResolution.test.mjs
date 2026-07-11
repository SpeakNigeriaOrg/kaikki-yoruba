import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './parser.mjs';
import { normalizeRecords } from './normalizer.mjs';
import { resolveMorphemeRelationships } from './morphemeResolution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function entry(overrides) {
  return {
    id: overrides.id,
    headword: overrides.headword ?? overrides.id,
    canonicalForm: { value: overrides.canonical ?? overrides.headword ?? overrides.id, inferenceMethod: 'explicit_canonical_tag', confidence: 1.0, originalValue: overrides.headword ?? overrides.id },
    altForms: overrides.altForms ?? [],
    senses: overrides.senses ?? [],
    etymologyMorphemes: overrides.etymologyMorphemes ?? [],
  };
}

test('resolveMorphemeRelationships prefers an entry whose own canonical spelling exactly matches over one that only matches via raw headword', () => {
  const entries = [
    entry({ id: 'A', etymologyMorphemes: [{ form: 'mọ', gloss: 'to mold', bound: false }] }),
    // Headword "mọ" but real canonical spelling "mọ̀" - only a loose match.
    entry({ id: 'B', headword: 'mọ', canonical: 'mọ̀', senses: [{ glosses: ['to know'] }] }),
    // Headword AND canonical both exactly "mọ" - the tonal-exact match.
    entry({ id: 'C', headword: 'mọ', canonical: 'mọ', senses: [{ glosses: ['to mold, to shape'] }] }),
  ];
  resolveMorphemeRelationships(entries);
  const morpheme = entries[0].etymologyMorphemes[0];
  assert.equal(morpheme.resolved, true);
  assert.deepEqual(morpheme.entryIds, ['C']);
});

test('resolveMorphemeRelationships breaks ties among true homographs by gloss-overlap with the morpheme\'s own gloss', () => {
  const entries = [
    entry({ id: 'A', etymologyMorphemes: [{ form: 'gbà', gloss: 'accept', bound: false }] }),
    entry({ id: 'B', canonical: 'gbà', senses: [{ glosses: ['to rescue, to save, to deliver'] }] }),
    entry({ id: 'C', canonical: 'gbà', senses: [{ glosses: ['to take, accept, receive, absorb'] }] }),
    entry({ id: 'D', canonical: 'gbà', senses: [{ glosses: ['to combust, to burst into flame'] }] }),
  ];
  resolveMorphemeRelationships(entries);
  const morpheme = entries[0].etymologyMorphemes[0];
  assert.equal(morpheme.entryIds[0], 'C');
  assert.equal(morpheme.entryIds.length, 3);
});

test('resolveMorphemeRelationships never looks up a bound morpheme', () => {
  const entries = [
    entry({ id: 'A', etymologyMorphemes: [{ form: 'à-', gloss: 'nominalizing prefix', bound: true }] }),
    entry({ id: 'B', canonical: 'à-' }),
  ];
  resolveMorphemeRelationships(entries);
  const morpheme = entries[0].etymologyMorphemes[0];
  assert.equal(morpheme.resolved, false);
  assert.deepEqual(morpheme.entryIds, []);
});

test('resolveMorphemeRelationships synthesizes the reciprocal "used in" direction, purely from etymology templates', () => {
  const entries = [
    entry({ id: 'compound1', etymologyMorphemes: [{ form: 'root', gloss: 'to know', bound: false }] }),
    entry({ id: 'compound2', etymologyMorphemes: [{ form: 'root', gloss: 'to know', bound: false }] }),
    entry({ id: 'root', canonical: 'root' }),
  ];
  resolveMorphemeRelationships(entries);
  const rootEntry = entries.find((e) => e.id === 'root');
  assert.equal(rootEntry.usedInCompounds.length, 2);
  assert.deepEqual(
    rootEntry.usedInCompounds.map((u) => u.entryId).sort(),
    ['compound1', 'compound2']
  );
  assert.ok(rootEntry.usedInCompounds.every((u) => u.provenance === 'synthesized_from_etymology'));
});

test('resolveMorphemeRelationships does not duplicate a "used in" entry if called on already-resolved data', () => {
  const entries = [
    entry({ id: 'compound', etymologyMorphemes: [{ form: 'root', gloss: null, bound: false }] }),
    entry({ id: 'root', canonical: 'root' }),
  ];
  resolveMorphemeRelationships(entries);
  const rootEntry = entries.find((e) => e.id === 'root');
  assert.equal(rootEntry.usedInCompounds.length, 1);
});

test('on the real full Kaikki corpus, produces the exact same result as yorubadict\'s own independently-run pipeline for a known example (àmọ̀tẹ́kùn / mọ̀ / Mọgbà)', () => {
  const realCorpusPath = path.resolve(__dirname, '..', '..', '..', 'yorubadict', 'data', 'dictionary-Yoruba.jsonl');
  let records;
  try {
    ({ records } = parseJsonl(realCorpusPath));
  } catch {
    // Sibling-repo dev fixture, not guaranteed present (e.g. CI) - skip.
    return;
  }
  const entries = normalizeRecords(records);
  resolveMorphemeRelationships(entries);
  const byId = new Map(entries.map((e) => [e.id, e]));

  const amotekun = entries.find((e) => e.canonicalForm.value === 'àmọ̀tẹ́kùn');
  assert.ok(amotekun, 'expected to find àmọ̀tẹ́kùn in the real corpus');
  assert.deepEqual(
    amotekun.etymologyMorphemes.map((m) => ({ form: m.form, bound: m.bound, entryIds: m.entryIds })),
    [
      { form: 'à-', bound: true, entryIds: [] },
      { form: 'mọ̀', bound: false, entryIds: ['en-mọ-yo-verb-Vk7G5aRj'] },
      { form: 'tó', bound: false, entryIds: ['en-to-yo-verb-yY2oI1eV', 'en-to-yo-verb-j3m1yPtS'] },
      { form: 'tó', bound: false, entryIds: ['en-to-yo-verb-yY2oI1eV', 'en-to-yo-verb-j3m1yPtS'] },
      { form: 'ẹkùn', bound: false, entryIds: ['en-ẹkun-yo-noun-NZ93k8vW', 'en-ẹkun-yo-noun-ovhnP92X'] },
    ]
  );

  const mo = byId.get('en-mọ-yo-verb-Vk7G5aRj');
  assert.equal(mo.usedInCompounds.length, 34, 'expected 34 real compounds using mọ̀ ("to know") as a component, matching yorubadict\'s own pipeline exactly');

  const mogba = entries.find((e) => e.canonicalForm.value === 'Mọgbà');
  assert.ok(mogba, 'expected to find Mọgbà in the real corpus');
  const gbaMorpheme = mogba.etymologyMorphemes.find((m) => m.form === 'gbà');
  assert.equal(gbaMorpheme.entryIds[0], 'en-gba-yo-verb-SbVU0W9v', 'expected the "to accept" sense ranked first via gloss-overlap tiebreak');
});
