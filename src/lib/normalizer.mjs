// src/lib/normalizer.mjs
//
// Lifted from yorubadict's build/lib/normalizer.mjs (Stage 2: converts one
// raw Kaikki record into one canonical lexical entry), extended with fields
// yorubadict's own normalizer didn't originally keep but downstream
// consumers need:
//   - etymologyTemplates: raw etymology_templates, kept unfiltered - needed
//     by yoruba_student_dict_platform's componentCandidates derivation.
//   - senses[].altOf: raw alt_of, needed to derive altOfTargets
//     (cross-reference following) the same way.
//   - etymologyMorphemes: unlike the two above, this ISN'T raw passthrough -
//     it's the corrected per-morpheme extraction (which template names
//     count, per-morpheme bound/free filtering) originally built and fixed
//     in yorubadict's own normalizer.mjs. Both yorubadict's independent copy
//     and yoruba_student_dict_platform's separate TS port shared the same
//     two bugs (missing af/affix/prefix, an all-or-nothing hyphen check)
//     until this was fixed once, here - see README for the full rationale
//     on why this crossed the line from "raw preservation" to "shared
//     derivation," while the cross-entry RESOLUTION of these morphemes
//     (which specific entry a free morpheme's spelling matches) still
//     happens in morphemeResolution.mjs, not here.
// Every inferred value still records its inference method, confidence, and
// the original source value - original data is never discarded, only
// supplemented.

import { allForms } from './orthography.mjs';
import { classifyRelationList, EMPTY_MARKERS } from './relationDebris.mjs';

// Templates whose numeric args decompose a word into its constituent
// morphemes. "af"/"affix"/"prefix" were previously excluded entirely on
// the assumption they only ever mark a single bound prefix - real data
// disproves that: of 1,043 real af/affix templates in the corpus, 100%
// have 2+ numeric args, and 388 (37%) have 3-6, mixing bound prefixes
// with several free-standing real words (e.g. àmọ̀tẹ́kùn = à- + mọ̀ + tó +
// tó + ẹkùn). Cross-language templates (cog/bor/inh/der/doublet/calque)
// are excluded by design - their numeric arg is a language code, not a
// Yoruba word - and non-decomposition relations (clipping, etymid, etc.)
// are simply not in this set. Originally built and fixed in yorubadict's
// build/lib/normalizer.mjs; ported here so both consumers get the
// correction without re-deriving it independently (see README).
const MORPHEME_TEMPLATE_NAMES = new Set([
  'compound', 'com', 'compound+', 'reduplication', 'blend',
  'af', 'affix', 'prefix',
]);

// {{reduplication}} does NOT follow the multi-term shape the rest of that set
// does, and reading it as if it did was corrupting every one of the 93 in the
// corpus. Per Wiktionary's own template documentation it takes ONE term:
//
//   |1=  language code
//   |2=  the term this word was reduplicated from
//   |3=  alternate display text for that same term (NOT a second morpheme)
//   |4=  a gloss, also spellable as |t=  (NOT a third morpheme)
//
// Read as a multi-term template that meant: wówó "mushroom"
// ({{reduplication|yo|wó|wó|t=to crumble, to break}}) decomposed into two
// identical "wó" morphemes with their gloss dropped, because the gloss was
// looked up as t1; and dáadáa ({{reduplication|yo|dáa||4=to be good}})
// produced a morpheme whose *form* was the English string "to be good".
// Kaikki's own rendered `expansion` confirms the single-term reading:
// "Reduplication of wó (“to crumble, to break”)".
//
// Losing those glosses mattered beyond the display: gloss overlap is the only
// signal that picks between identically-spelled roots, and reduplications are
// exactly where several compete (gbígbá is listed under all five gbá verbs).
const SINGLE_TERM_MORPHEME_TEMPLATES = new Set(['reduplication']);

/** Extracts every morpheme a word's etymology_templates decompose it
 * into, tagging each as bound (a grammatical prefix/suffix like à-, ẹ- -
 * never an independent word) or free (a real word, potentially already in
 * this dictionary). This is a PER-MORPHEME filter, not per-template: a
 * template mixing one bound prefix with several free words (the common
 * real shape for af/affix) keeps all its free morphemes rather than
 * discarding the whole template because of the one bound one. */
function extractEtymologyMorphemes(record) {
  const templates = Array.isArray(record.etymology_templates) ? record.etymology_templates : [];
  const morphemes = [];
  // Which decomposition each morpheme came from. A page can record more than
  // one way of breaking the same word down - 81 in the corpus do - and they
  // are alternatives, not parts of a single longer analysis. nìtorí is
  // ní + ìtorí *or* ní + ti + orí; mùwé is mọ̀ + ùwé in Èkìtì/Oǹdó *or*
  // mù + ùwé in Ìjẹ̀bú. Returned flat, they read as one four-part word
  // ("mọ̀ + ùwé + mù + ùwé"), which is not a thing anyone said. Consumers
  // need the grouping to render them as the alternatives they are, and it
  // has to come from here: it is only knowable while the templates are being
  // walked, and re-deriving it downstream would mean copying these rules.
  let analysis = -1;
  for (const t of templates) {
    if (!MORPHEME_TEMPLATE_NAMES.has(t.name)) continue;
    const args = t.args || {};
    if (args['1'] !== 'yo') continue;
    analysis += 1;

    // Single-term templates: one morpheme, arg 3 being display text for the
    // same term rather than another of them. Preferred over arg 2 when it's
    // present and non-empty, since an editor who bothered to supply it
    // usually did so to give the properly-toned form.
    if (SINGLE_TERM_MORPHEME_TEMPLATES.has(t.name)) {
      const form = args['3'] || args['2'];
      if (!form) continue;
      morphemes.push({
        form,
        gloss: args.t || args['4'] || null,
        bound: form.startsWith('-') || form.endsWith('-'),
        analysis,
        analysisTemplate: t.name,
      });
      continue;
    }

    const numericKeys = Object.keys(args)
      .filter((k) => /^\d+$/.test(k) && k !== '1')
      .sort((a, b) => Number(a) - Number(b));
    numericKeys.forEach((key, i) => {
      const form = args[key];
      if (!form) return;
      // Glosses are keyed by POSITION in the content-morpheme sequence
      // (t1, t2, ...), not by the raw arg number - confirmed against real
      // data: àmọ̀tẹ́kùn's 5 morphemes are args 2-6, but their glosses are
      // t1-t5 (one per morpheme, in order), not t2-t6.
      const gloss = args[`t${i + 1}`] || null;
      morphemes.push({
        form,
        gloss,
        bound: form.startsWith('-') || form.endsWith('-'),
        analysis,
        analysisTemplate: t.name,
      });
    });
  }
  return morphemes;
}

function pickCanonicalForm(record) {
  const forms = Array.isArray(record.forms) ? record.forms : [];
  const tagged = forms.find((f) => Array.isArray(f.tags) && f.tags.includes('canonical'));

  if (tagged) {
    return {
      value: tagged.form,
      inferenceMethod: 'explicit_canonical_tag',
      confidence: 1.0,
      originalValue: record.word,
    };
  }

  // Fallback: no explicit canonical tag (common for "character"/letter
  // entries and some function words). Use the raw headword itself.
  return {
    value: record.word,
    inferenceMethod: 'fallback_headword',
    confidence: 0.5,
    originalValue: record.word,
  };
}

function extractAltForms(record, canonicalValue) {
  const forms = Array.isArray(record.forms) ? record.forms : [];
  return forms
    .filter((f) => f.form && f.form !== canonicalValue)
    .map((f) => ({ form: f.form, tags: f.tags || [] }));
}

function extractIpa(record) {
  const sounds = Array.isArray(record.sounds) ? record.sounds : [];
  return sounds
    .filter((s) => s.ipa)
    .map((s) => ({ ipa: s.ipa, tags: s.tags || [], note: s.note || null }));
}

function extractSenses(record) {
  const senses = Array.isArray(record.senses) ? record.senses : [];
  return senses.map((sense) => ({
    id: sense.id || null,
    glosses: sense.glosses || [],
    rawGlosses: sense.raw_glosses || sense.glosses || [],
    tags: sense.tags || [],
    examples: (sense.examples || []).map((ex) => ({
      text: ex.text || null,
      translation: ex.translation || ex.english || null,
    })),
    // Some senses carry their own nested relation lists (e.g. a
    // sense-specific "derived" list distinct from the entry-level one).
    // We fold these into the sense so nothing from the source is lost.
    links: (sense.links || []).map((l) => (Array.isArray(l) ? l[0] : l)),
    // Raw Kaikki cross-reference data ("this sense is an inflected/
    // alternative form of X") - not extracted by yorubadict's original
    // normalizer, added for yoruba_student_dict_platform's altOfTargets
    // derivation (see generate_diagnostics.py's resolve_definition_source,
    // which follows this one hop to find the real defining record).
    altOf: (sense.alt_of || []).map((a) => ({ word: a.word || null, extra: a.extra || null })),
  }));
}

// Raw Kaikki etymology-template data ("this word's etymology section cites
// these templates, e.g. {{compound|yo|...}}") - not extracted by
// yorubadict's original normalizer, added for yoruba_student_dict_platform's
// componentCandidates derivation (see generate_kaikki_lexicon.py's
// extract_component_candidates, which filters these same templates by name
// and by args['1'] === 'yo'). Kept raw and unfiltered here - the filtering
// itself is project-specific derivation, not shared normalization.
function extractEtymologyTemplates(record) {
  const templates = Array.isArray(record.etymology_templates) ? record.etymology_templates : [];
  return templates.map((t) => ({ name: t.name || null, args: t.args || {} }));
}

// A relation list is either a list of terms or the text of a rendered table -
// never a mix. classifyRelationList decides which (see relationDebris.mjs for
// why the decision is made per list rather than per item); table text is
// dropped whole, because the data it mangles is imported from source instead
// by dialectSynonyms.mjs.
//
// `english` and `translation` are the same string in all 2,065 items that
// carry both, so the fallback is belt-and-braces rather than a real choice.
// `lang`/`langCode` matter: 311 of 315 descendants are not Yoruba (English
// "dodo", Nigerian Pidgin "werey"), and dropping the language made them render
// as though they were.
function extractRelationList(list, markers, onTableText) {
  if (!Array.isArray(list)) return [];

  const verdict = classifyRelationList(list, markers);
  if (verdict.isTableText) {
    if (onTableText) onTableText(verdict);
    return [];
  }

  const results = [];
  for (const item of list) {
    if (!item || typeof item.word !== 'string' || !item.word.trim()) continue;
    results.push({
      type: 'term',
      text: item.word.trim(),
      english: item.english || item.translation || null,
      lang: item.lang || null,
      langCode: item.lang_code || null,
      roman: item.roman || null,
    });
  }

  return results;
}

let idCounter = 0;

function deriveEntryId(record, senses) {
  // Prefer the first sense's Kaikki-assigned id: it's already a stable,
  // source-derived identifier that doesn't depend on our own spelling
  // normalization decisions.
  const firstSenseId = senses.find((s) => s.id)?.id;
  if (firstSenseId) return firstSenseId;

  // Fallback for records with no sense id at all (shouldn't normally
  // happen with Kaikki data, but the pipeline must not crash on it).
  idCounter += 1;
  const slug = (record.word || 'unknown')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  return `generated-${slug}-${record.pos || 'x'}-${idCounter}`;
}

export function normalizeRecord(record, index, options = {}) {
  const senses = extractSenses(record);
  const canonicalForm = pickCanonicalForm(record);
  const id = deriveEntryId(record, senses);

  const markers = options.markers || EMPTY_MARKERS;
  const relation = (list, field) =>
    extractRelationList(list, markers, (verdict) => options.onTableText?.({ id, field, ...verdict }));

  const entry = {
    id,
    headword: record.word,
    lang: record.lang || null,
    langCode: record.lang_code || null,
    pos: record.pos || null,
    etymologyNumber: record.etymology_number || null,
    etymologyText: record.etymology_text || null,
    etymologyTemplates: extractEtymologyTemplates(record),
    etymologyMorphemes: extractEtymologyMorphemes(record),
    canonicalForm,
    altForms: extractAltForms(record, canonicalForm.value),
    ipa: extractIpa(record),
    senses,
    derivedTerms: relation(record.derived, 'derivedTerms'),
    relatedTerms: relation(record.related, 'relatedTerms'),
    synonyms: relation(record.synonyms, 'synonyms'),
    antonyms: relation(record.antonyms, 'antonyms'),
    descendants: relation(record.descendants, 'descendants'),
    forms: allForms(canonicalForm.value),
    provenance: {
      source: 'kaikki',
      sourceLineIndex: index,
    },
  };

  return entry;
}


export function normalizeRecords(records, options = {}) {
  return records.map((record, i) => normalizeRecord(record, i, options));
}
