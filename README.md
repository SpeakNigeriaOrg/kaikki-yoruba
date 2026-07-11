# kaikki-yoruba

Shared Kaikki/Wiktionary normalization for Yoruba - one canonical artifact
feeding two sibling projects, [`yorubadict`](../yorubadict) (a static
dictionary website) and
[`yoruba_student_dict_platform`](../yoruba_student_dict_platform) (a
curation platform for a student dictionary/curriculum, cross-checked
against Kaikki as a reference source).

## Why this exists

Both projects had their own independent Kaikki-processing pipeline, both
built from the *identical* raw extract (`dictionary-Yoruba.jsonl`,
confirmed byte-identical between the two repos, md5
`888149f2319f6b3087085d9c5613aa9e`), and both manual with no refresh
cadence - neither had ever actually been refreshed. Designing server-side
verification for one of `yoruba_student_dict_platform`'s decisions (whether
a curator's "adopt Kaikki's spelling" choice actually matches real Kaikki
data) surfaced this, and made clear the right fix was shared, not
platform-only.

## What this repo owns - and deliberately does not

This repo is Stage 1+2 only: **parse** raw Kaikki JSONL, **normalize** into
one canonical entry per record. That's it.

The normalizer here is lifted close to verbatim from `yorubadict`'s own
`build/lib/{parser,normalizer}.mjs` (functional code unchanged, only
comments differ - `git diff --ignore-blank-lines` against those files
shows only the header comments differing) - it was already the fuller,
less-opinionated of the two projects' shapes (dialect/archaic senses kept
and tagged rather than dropped, full etymology text/IPA/examples kept,
relation types beyond just morphological components), so it's the natural
shared foundation. Extended with exactly two additions, both raw and
unopinionated - preserving Kaikki fields that existed in the source data
but neither pipeline was reading, not new derived semantics:

- `etymologyTemplates: [{name, args}]` per entry - raw `etymology_templates`,
  needed downstream for `yoruba_student_dict_platform`'s
  `componentCandidates` (etymological decomposition) derivation.
- `senses[].altOf: [{word, extra}]` - raw `alt_of`, needed downstream for
  `yoruba_student_dict_platform`'s `altOfTargets` (cross-reference
  following) derivation.

Everything each project does *with* this data stays in that project, not
here, because each already has its own working, tested logic that doesn't
need to become "shared" just because the input does:

- `yorubadict`'s reciprocal relationship synthesis (across `derivedTerms`/
  `relatedTerms`/`synonyms`/`antonyms`/`descendants`), validation reporting,
  and BM25 search-index building (`build/lib/{relationships,validator,
  search-index}.mjs`) - unchanged, retargeted to consume this repo's
  canonical artifact instead of running its own parser/normalizer first.
- `yoruba_student_dict_platform`'s `componentCandidates` extraction (from
  `etymologyTemplates`, filtered to same-language compound/reduplication/
  blend templates) + its own reciprocal synthesis (from `derivedTerms`),
  `altOfTargets` (from `altOf`), `standardForms` filtering (from
  `altForms`/tags), and dialect-sense exclusion - a new downstream
  ingestion step in that platform's own repo, reusing the *existing*
  Python filtering logic (`generate_kaikki_lexicon.py`), just retargeted to
  read this canonical shape instead of raw Kaikki records.

## Usage

```
npm run build              # data/sample.jsonl -> dist/entries.json + dist/metadata.json
npm run build:sample       # explicit alias for the above
node src/normalize.mjs path/to/dictionary-Yoruba.jsonl --source-date=2026-07-06
npm test                   # node --test - runs against both a synthetic
                            # fixture and (if present as a sibling checkout)
                            # the real corpus in ../yorubadict/data/
```

`dist/` is never committed - it's the build output, published as a
versioned GitHub Release by the scheduled workflow
(`.github/workflows/refresh.yml`).

## Status

Normalizer lifted and extended, verified against both the 16-record sample
fixture and the real 6,273-record corpus (found 3,843 entries with real
`etymologyTemplates` data, 386 senses with real `altOf` cross-references,
1,334 real component-decomposition templates - `compound`/`com`/
`compound+`/`reduplication`/`blend` - among them). 12/12 tests passing
(`node --test`).

**Resolved since the initial scaffold**: the fetch URL is confirmed live -
`https://kaikki.org/dictionary/Yoruba/kaikki.org-dictionary-Yoruba.jsonl`
(linked from `https://kaikki.org/dictionary/Yoruba/index.html`), verified
by actually downloading it and running it through `src/normalize.mjs`
end-to-end (6,273 records, 0 parse errors, real `etymologyTemplates`/
`altOf` data present). kaikki.org's own page marks this specific link
"DEPRECATED - will be removed in the near future" - if the scheduled
workflow starts failing, check
<https://kaikki.org/dictionary/Yoruba/index.html> and
<https://kaikki.org/dictionary/rawdata.html> for its replacement before
assuming it's transient. The workflow's fetch step is followed by a
sanity-check step (file size/line count bounds, first-record shape check)
before normalizing - verified locally to correctly pass on the real file
and correctly fail on a truncated/error-page-sized response and on a
right-sized-but-wrong-shape response.

**Open items, not yet resolved:**
- **Not yet integrated with either consumer.** `yorubadict`'s build hasn't
  been retargeted to consume this repo's artifact yet (still runs its own
  parser/normalizer). `yoruba_student_dict_platform`'s downstream ingestion
  step (the Postgres schema + componentCandidates/altOfTargets/
  standardForms derivation) hasn't been built yet either.
- **The workflow itself hasn't had a real scheduled/dispatched run yet** -
  the fetch+sanity-check+normalize chain was verified by running each part
  locally (see above), not by an actual GitHub Actions execution. Worth
  triggering a manual `workflow_dispatch` run once pushed, to confirm the
  release-publish step too.
