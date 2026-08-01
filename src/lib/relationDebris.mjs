// src/lib/relationDebris.mjs
//
// Recognising wiktextract's flattened tables in relation lists.
//
// When a relation section is a table-generating template
// (`{{dialect synonyms}}`, or the Itsekiri/SE-Yoruba comparative tables),
// wiktextract renders the table and emits every text run in it as a separate
// relation item: the caption, the footnotes, and the body cells glued together
// with a separator. What we get is not a damaged list of terms, it is the
// text of a table. There is nothing in it to salvage - the real data is
// imported from source instead (see dialectSynonyms.mjs).
//
// Detection is therefore at the level of the LIST, not the item:
//
//   If a list contains any of the table's own marker strings, the list is
//   that table's text.
//
// This matters because the item-level signal is unusable. The cell separator
// is an arbitrary Wiktionary page title, substituted by an expansion-index
// desync, and it changes every build:
//
//   build-6  ga -> 慵    inu -> SPACE SHUTTLE   (also UNITED ARAB EMIRATES, VIFÖ, FA, T)
//   build-5  ga -> 礀    inu -> 啀              (also ACCRUAL, IPSE DIXIT, ROOK)
//   build-2  ga -> 荙    inu -> 愑              (also PREDICATE, BELLY DANCE)
//
// Some are Han ideographs and some are plain ASCII, so no character class
// catches them: `lẹ̀ghẹ̀FAÌwẹrẹfà ()FA` and `sọnPOINTÌwẹrẹsọPOINT` are both
// table text. The markers, by contrast, are stable across every build sampled,
// and they are read from the metadata module rather than hardcoded, so an
// upstream rewording keeps working.
//
// The heuristics this replaces - `includes('庽') || length > 50 ||
// includes('. ')` - failed in both directions on the real corpus: they missed
// 277 table items while destroying real content (bibliography entries like
// "T. A. (2021)", example sentences like "Èmi yóò máa lọ.I will be leaving any
// time from now."). Length and character tests are kept here only as
// diagnostics, never as a drop rule: dropping on non-Latin script would cost
// the four legitimate foreign-script descendants (Mandarin 阿哥哥, Japanese
// イロコ / イディグボ, Arabic يُوفِي) and every Ajami headword.

const LEGACY_MARKERS = [
  // The placeholder text of the escape-hatch item this module makes obsolete;
  // recognised so a list built by an older release is still classified.
  'Dialect link',
];

function squash(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// Markers derived from Module:dialect synonyms/yo:
//   - the caption prefix, from `export.title`
//   - the footnote paragraph, from `export.notes` (wiktextract splits it at
//     ". " into several items, so fragments are matched by containment)
//   - the family and variety-group labels, which are the header cells the
//     comparative tables leak (Proto-Yoruba, Southeast Yoruba, ...)
export function buildTableMarkers(metadata) {
  const phrases = [];
  const headers = new Set();

  if (metadata?.titlePrefix) phrases.push(squash(metadata.titlePrefix));
  for (const note of metadata?.notes || []) phrases.push(squash(note));
  for (const variety of (metadata?.varieties || new Map()).values()) {
    if (variety.family) headers.add(squash(variety.family));
    if (variety.group) headers.add(squash(variety.group));
  }
  for (const legacy of LEGACY_MARKERS) headers.add(legacy);

  return { phrases, headers };
}

export const EMPTY_MARKERS = { phrases: [], headers: new Set() };

// Does one relation item betray that its list is table text?
export function isTableMarker(text, markers) {
  const value = squash(text);
  if (!value) return false;

  // A bare dash is a "no data for this variety" cell, never a term.
  if (value === '-' || value === '—' || value === '–') return true;

  if (markers.headers.has(value)) return true;

  for (const phrase of markers.phrases) {
    // Either direction: the item may be the caption prefix plus a headword
    // ("Yoruba varieties and languages: fàview map"), or a fragment cut out
    // of the footnote paragraph.
    if (value.startsWith(phrase) || (value.length > 12 && phrase.includes(value))) return true;
  }

  return false;
}

// Diagnostics only - reported, never used to drop anything. Kept so a future
// upstream change shows up in the validation report instead of silently
// reappearing in the UI.
const FOREIGN_SCRIPT = /[㐀-䶿一-鿿぀-ヿ가-힯؀-ۿ]/u;
const LATIN_LETTER = /[A-Za-zÀ-ɏḀ-ỿ]/u;

export function describeSuspicion(text) {
  const value = String(text ?? '');
  const reasons = [];
  // A leaked separator sits *inside* a token; a genuine foreign-script
  // relation is foreign all through.
  if (FOREIGN_SCRIPT.test(value) && LATIN_LETTER.test(value.replace(FOREIGN_SCRIPT, ''))) {
    reasons.push('mixed-script');
  }
  if (/\p{Ll}\p{Lu}/u.test(value)) reasons.push('run-together');
  if (/[A-Z]{2,}/.test(value) && LATIN_LETTER.test(value)) reasons.push('caps-run');
  return reasons;
}

// The whole point: a verdict for the list, not per item.
export function classifyRelationList(list, markers) {
  if (!Array.isArray(list) || list.length === 0) return { isTableText: false, markers: [] };
  const hits = [];
  for (const item of list) {
    const text = typeof item?.word === 'string' ? item.word : item?.text;
    if (isTableMarker(text, markers)) hits.push(squash(text));
  }
  return { isTableText: hits.length > 0, markers: hits };
}
