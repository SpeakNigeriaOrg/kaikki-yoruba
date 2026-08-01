// src/lib/relationDebris.test.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildTableMarkers,
  classifyRelationList,
  describeSuspicion,
  EMPTY_MARKERS,
  isTableMarker,
} from './relationDebris.mjs';
import { parseVarietyMetadata } from './dialectSynonyms.mjs';
import { normalizeRecord } from './normalizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = path.resolve(__dirname, '..', '..', 'data', 'dialect-synonyms.json');

function markersFromSnapshot() {
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  return buildTableMarkers(parseVarietyMetadata(snapshot.metadataContent));
}

const markers = markersFromSnapshot();

test('markers are derived from the metadata module, not hardcoded', () => {
  assert.ok(markers.phrases.some((p) => p.startsWith('Yoruba varieties and languages')));
  assert.ok(markers.phrases.some((p) => p.includes('now deemed dialects of Yorùbá in Nigeria')));
  assert.ok(markers.headers.has('Southeast Yoruba'));
  assert.ok(markers.headers.has('Proto-Yoruba'));
});

test('table captions, footnote fragments and header cells are markers', () => {
  // The caption wiktextract emits, with the headword and "view map" glued on.
  assert.equal(isTableMarker('Yoruba varieties and languages: fàview map', markers), true);
  // Fragments of the footnote paragraph, split at ". " by wiktextract.
  assert.equal(isTableMarker('now deemed dialects of Yorùbá in Nigeria', markers), true);
  assert.equal(isTableMarker('nor the Èdè Languages of Benin and Togo', markers), true);
  // A leaked header cell from the comparative tables.
  assert.equal(isTableMarker('Proto-Itsekiri-SEY', markers), true);
  // An empty-cell placeholder.
  assert.equal(isTableMarker('—', markers), true);
  // The placeholder text of the escape hatch this module replaces.
  assert.equal(isTableMarker('Dialect link', markers), true);
});

test('real Yoruba terms are never markers', () => {
  for (const term of ['ulé', 'inú', 'ẹja àpátámàjà', 'Ìbìní', 'ń', 'máa', 'inɔ̃́']) {
    assert.equal(isTableMarker(term, markers), false, term);
  }
});

test('a list is classified whole: one marker condemns it, none spares it', () => {
  const tableText = [
    { word: 'Yoruba varieties and languages: gaview map' },
    { word: 'ga慵Ǹcàgù慵' },
    { word: 'Ɔ̀hɔ̀rí' },
  ];
  assert.equal(classifyRelationList(tableText, markers).isTableText, true);

  const genuine = [{ word: 'ẹja àpátámàjà' }, { word: 'Ìbìní' }];
  assert.equal(classifyRelationList(genuine, markers).isTableText, false);
});

test('a mixed-script item alone does not condemn a list', () => {
  // Deliberate: the separator is an arbitrary page title and cannot be
  // recognised reliably, so the item-level signal is a diagnostic only. Such
  // items are dropped because their *list* carries a marker, not because of
  // how they look.
  const noMarker = [{ word: 'ga慵Ǹcàgù慵' }];
  assert.equal(classifyRelationList(noMarker, markers).isTableText, false);
  // Only mixed-script: the separator is category Lo, so it breaks the
  // lowercase-to-uppercase adjacency that `run-together` looks for.
  assert.deepEqual(describeSuspicion('ga慵Ǹcàgù慵'), ['mixed-script']);
  assert.deepEqual(describeSuspicion('Ɔ̀hɔ̀rí-ÌjèỌ̀họ̀rí'), ['run-together']);
});

test('regression: content the old length/sentence heuristics destroyed', () => {
  // The previous filter was `includes('庽') || length > 50 || includes('. ')`.
  // These are real relation items from the corpus that it dropped, and then
  // misreported as "complex dialect data".
  const casualties = [
    'T. A. (2021)', // a bibliography entry on the `maa` page
    'L. O. (1991)',
    'Èmi yóò máa lọ.I will be leaving any time from now.', // 51 chars
    'kì í and tí ì are sometimes written without spaces: kìí and tíì', // 63 chars
    '[preceding vowel repeated for mono­syllabic verbs]', // 50 chars, soft hyphen
  ];
  for (const text of casualties) {
    assert.equal(isTableMarker(text, markers), false, text);
  }
});

test('regression: legitimate foreign-script relations survive', () => {
  // A naive "contains non-Latin ⇒ corrupt" rule would delete these four real
  // descendants, plus every Ajami (Arabic-script) headword in the corpus.
  for (const text of ['阿哥哥', 'イロコ', 'イディグボ', 'يُوفِي', 'أَيَّ']) {
    assert.equal(isTableMarker(text, markers), false, text);
    assert.deepEqual(describeSuspicion(text), [], text);
  }
});

test('extractRelationList drops table text whole and keeps descendant languages', () => {
  const record = {
    word: 'agogo',
    lang: 'Yoruba',
    lang_code: 'yo',
    pos: 'noun',
    senses: [{ glosses: ['bell'], id: 'en-agogo-yo-noun-test' }],
    descendants: [
      { word: '阿哥哥', lang: 'Mandarin', lang_code: 'zh', roman: 'āgēgē' },
      { word: 'agogô', lang: 'Portuguese', lang_code: 'pt' },
    ],
    synonyms: [
      { word: 'Yoruba varieties and languages: agogoview map' },
      { word: 'agogo慵Ìjẹ̀bú' },
    ],
  };

  const entry = normalizeRecord(record, 0, { markers });

  assert.deepEqual(entry.synonyms, [], 'table text dropped whole');
  assert.equal(entry.descendants.length, 2);
  assert.equal(entry.descendants[0].text, '阿哥哥');
  assert.equal(entry.descendants[0].lang, 'Mandarin', 'descendant language is carried through');
  assert.equal(entry.descendants[0].langCode, 'zh');
  assert.equal(entry.descendants[0].roman, 'āgēgē');
  // No synthetic escape-hatch object is emitted any more.
  assert.equal(entry.synonyms.some?.((r) => r.type === 'external_link'), false);
});

test('with no markers available the build degrades rather than fails', () => {
  const record = {
    word: 'ile',
    senses: [{ glosses: ['house'], id: 'x' }],
    synonyms: [{ word: 'Yoruba varieties and languages: iléview map' }],
  };
  const entry = normalizeRecord(record, 0, { markers: EMPTY_MARKERS });
  // Unfiltered, exactly as before this feature existed - the snapshot being
  // absent must not break a build.
  assert.equal(entry.synonyms.length, 1);
});

// The real corpus lives in the sibling repo; skip silently when absent.
const corpusPath = path.resolve(__dirname, '..', '..', '..', 'yorubadict', 'data', 'dictionary-Yoruba.jsonl');

test('corpus: no relation text survives that matches a table marker', { skip: !existsSync(corpusPath) }, async () => {
  const { parseJsonl } = await import('./parser.mjs');
  const { normalizeRecords } = await import('./normalizer.mjs');
  const { records } = parseJsonl(corpusPath);
  const entries = normalizeRecords(records, { markers });

  const offenders = [];
  for (const entry of entries) {
    for (const field of ['synonyms', 'antonyms', 'derivedTerms', 'relatedTerms', 'descendants']) {
      for (const rel of entry[field] || []) {
        if (isTableMarker(rel.text, markers)) offenders.push({ id: entry.id, field, text: rel.text });
      }
    }
  }
  assert.deepEqual(offenders, []);

  // And the genuine synonyms are still there - proof the sweep is not simply
  // emptying the field.
  const genuine = entries.filter((e) => (e.synonyms || []).length > 0);
  assert.equal(genuine.length, 2);
  assert.deepEqual(
    genuine.map((e) => e.synonyms[0].text).sort(),
    ['Ìbìní', 'ẹja àpátámàjà']
  );
});
