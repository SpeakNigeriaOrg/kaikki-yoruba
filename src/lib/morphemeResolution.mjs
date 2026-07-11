// src/lib/morphemeResolution.mjs
//
// Stage 3 (morphemes only): resolves each entry's free-standing etymology
// morphemes (from normalizer.mjs's extractEtymologyMorphemes) against every
// other entry's spellings, and synthesizes the reciprocal "used in"
// direction. Deliberately narrower than yorubadict's own relationships.mjs,
// which additionally resolves derivedTerms/relatedTerms/synonyms/antonyms/
// descendants - those relation types stay each consumer's own concern (see
// README); this stage only covers what's genuinely self-contained given
// just entries + their etymologyMorphemes, with no dependency on those
// other relation types at all.
//
// Ported from yorubadict's build/lib/relationships.mjs, where this exact
// logic (tonal-exact-match preference, gloss-overlap tiebreak, "used in"
// reciprocal synthesis) was originally built and fixed. Moved here so
// yoruba_student_dict_platform's own port doesn't have to independently
// re-derive - and re-fix - the same two bugs (missing af/affix/prefix,
// all-or-nothing hyphen check) that motivated fixing this in the first
// place.

import { spellingsForEntry } from './orthography.mjs';

function buildAliasIndex(entries) {
  const index = new Map(); // spelling -> Set(entryId)
  const add = (spelling, id) => {
    if (!spelling) return;
    if (!index.has(spelling)) index.set(spelling, new Set());
    index.get(spelling).add(id);
  };
  for (const entry of entries) {
    for (const spelling of spellingsForEntry(entry)) add(spelling, entry.id);
  }
  return index;
}

function normalizeGlossWords(text) {
  return new Set(
    (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  );
}

// How well a candidate entry's own sense glosses overlap with the
// morpheme's own gloss text - used to break ties among entries that are
// exact spelling/tone matches (true homographs, e.g. 3 senses of "gbà"),
// where spelling alone can't say which one an etymology template meant.
function glossOverlapScore(morphemeGloss, entry) {
  if (!morphemeGloss) return 0;
  const mWords = normalizeGlossWords(morphemeGloss);
  let best = 0;
  for (const sense of entry.senses || []) {
    for (const gloss of sense.glosses || []) {
      let overlap = 0;
      for (const w of normalizeGlossWords(gloss)) if (mWords.has(w)) overlap++;
      if (overlap > best) best = overlap;
    }
  }
  return best;
}

export function resolveMorphemeRelationships(entries) {
  const aliasIndex = buildAliasIndex(entries);
  const byId = new Map(entries.map((e) => [e.id, e]));

  // Resolve free-standing etymology morphemes - a bound morpheme (à-, ẹ-)
  // is never looked up, since it can't meaningfully match a real headword;
  // it's tagged unresolved directly rather than via a failed alias lookup.
  for (const entry of entries) {
    entry.etymologyMorphemes = (entry.etymologyMorphemes || []).map((m) => {
      if (m.bound) return { ...m, resolved: false, entryIds: [] };
      const matches = aliasIndex.get(m.form);
      if (!matches || matches.size === 0) return { ...m, entryIds: [], resolved: false };
      const all = [...matches];
      // A morpheme's spelling frequently coincides with another entry's
      // raw, untoned Wiktionary headword (the page titled "mọ" is also
      // indexed here even though its real canonical spelling is "mọ̀" or
      // "mọ́") - an entry whose OWN canonical spelling exactly matches
      // must always win over one that only matched via that looser
      // headword/alt-form alias.
      const exact = all.filter((id) => byId.get(id)?.canonicalForm.value === m.form);
      const chosen = exact.length > 0 ? exact : all;
      // Among exact spelling ties (true homographs, e.g. gbà's 3 senses),
      // prefer whichever candidate's own glosses best overlap with this
      // morpheme's gloss - a stable sort, so untied candidates keep their
      // current order.
      const ranked = chosen.length > 1
        ? [...chosen].sort((a, b) => glossOverlapScore(m.gloss, byId.get(b)) - glossOverlapScore(m.gloss, byId.get(a)))
        : chosen;
      return { ...m, entryIds: ranked, resolved: true };
    });
  }

  // Reciprocal "used in": if entry A's etymology decomposes to include
  // entry B as a free-standing component, B's own page should show A as
  // something it's a building block for - purely etymology-template-
  // driven, so (unlike a derivedTerms-list-based reciprocal) it doesn't
  // depend on Wiktionary's editors having also filled in a "derived" list
  // on B's own page. Every entry gets the field, even if empty - a
  // published data artifact for external consumers should have a uniform
  // shape, not an absent-vs-empty distinction.
  for (const entry of entries) entry.usedInCompounds = entry.usedInCompounds || [];

  for (const entry of entries) {
    for (const m of entry.etymologyMorphemes || []) {
      if (m.bound || !m.resolved) continue;
      for (const targetId of m.entryIds) {
        const target = byId.get(targetId);
        if (!target) continue;
        const already = target.usedInCompounds.some((u) => u.entryId === entry.id);
        if (!already) {
          target.usedInCompounds.push({
            entryId: entry.id,
            text: entry.canonicalForm.value,
            provenance: 'synthesized_from_etymology',
          });
        }
      }
    }
  }

  return entries;
}
