# kaikki-yoruba

Shared Kaikki/Wiktionary normalization for Yoruba - one canonical artifact
feeding two sibling projects, [`yorubadict`](../yorubadict) (a static
dictionary website) and
[`yoruba_student_dict_platform`](../yoruba_student_dict_platform) (a
curation platform for a student dictionary/curriculum, cross-checked
against Kaikki as a reference source).

## What this is, in plain terms

[Kaikki](https://kaikki.org) is a project that extracts Wiktionary's
dictionary content into clean, machine-readable data - instead of the raw
wiki-markup Wiktionary pages are actually written in, Kaikki publishes one
JSON object per dictionary entry, as a plain text file where each line is
one entry (this format is called **JSONL** - "JSON Lines"). We use the
slice of that data covering Yoruba words, currently 6,273 entries.

But Kaikki's raw JSON is still messy and inconsistent in places - a word's
"real" spelling isn't always tagged the same way twice, cross-references
point at other words by plain text rather than a stable link, and useful
data is scattered across differently-shaped fields depending on the entry.
**"Normalizing" here means taking each of those raw, inconsistent records
and rewriting it into one predictable, consistent shape** - same fields,
same structure, every time - that other code can rely on without needing
to know Kaikki's own quirks. Concretely, for one real (abbreviated) example,
the raw Kaikki record for the letter "A":

```json
{
  "word": "A", "pos": "character", "lang_code": "yo",
  "forms": [{"form": "a", "tags": ["lowercase"]}],
  "sounds": [{"ipa": "/a/", "tags": ["phoneme"]}],
  "senses": [{"glosses": ["The first letter of the Yoruba alphabet..."], "tags": ["letter", "uppercase"]}]
}
```

becomes this repo's normalized entry:

```json
{
  "id": "en-A-yo-character-9n~aNY1j",
  "headword": "A",
  "lang": "Yoruba", "langCode": "yo", "pos": "character",
  "canonicalForm": { "value": "A", "inferenceMethod": "fallback_headword", "confidence": 0.5, "originalValue": "A" },
  "altForms": [{ "form": "a", "tags": ["lowercase"] }],
  "ipa": [{ "ipa": "/a/", "tags": ["phoneme"], "note": null }],
  "senses": [{ "glosses": ["The first letter of the Yoruba alphabet..."], "tags": ["letter", "uppercase"], "examples": [], "altOf": [] }],
  "derivedTerms": [], "relatedTerms": [], "synonyms": [], "antonyms": [], "descendants": [],
  "forms": { "exact": "A", "toneInsensitive": "a", "orthographyInsensitive": "a" }
}
```

Same information, but now every entry - no matter how Kaikki happened to
record it - has the same fields in the same shape, with every inferred
value (like `canonicalForm` here, since this record had no explicit
"canonical" tag to go on) recording *how* it was inferred, not just the
result.

### Final result: format and location

The output of a run is two files:
- **`entries.json`** - the actual dictionary data: a single JSON object
  keyed by entry id, one normalized entry (shaped like the example above)
  per Kaikki record. Currently ~7 MB for all 6,273 Yoruba entries.
- **`metadata.json`** - a small summary of the run itself: when it ran,
  how many entries, how many parse errors, and a content hash (so a
  consumer can tell whether the data actually changed since last time).

**Neither file lives in this repo's git history** - they're build output,
regenerated fresh every run. Instead, each run of the scheduled workflow
publishes them as the two file attachments on a new **GitHub Release**
(visible under this repo's "Releases" on GitHub, one release per run,
tagged `build-<run number>`). That's where the actual current data lives -
`yorubadict` and `yoruba_student_dict_platform` are each meant to download
the latest release's files, not clone this repo's history.

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
one canonical entry per record (the example above). That's it.

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

Real end-to-end run, exactly what the scheduled workflow does:

```
curl -fsSL "https://kaikki.org/dictionary/Yoruba/kaikki.org-dictionary-Yoruba.jsonl" -o data/dictionary-Yoruba.jsonl
node src/normalize.mjs data/dictionary-Yoruba.jsonl --source-date="$(date -u +%F)"
# -> dist/entries.json, dist/metadata.json
```

## How to trigger a real run / test it end-to-end

The workflow (`.github/workflows/refresh.yml`) runs automatically every
Monday, but you don't have to wait for that to test it:

1. On GitHub, open this repo → **Actions** tab → **Refresh Kaikki lexicon**
   (in the left sidebar) → **Run workflow** button (top right) → **Run
   workflow** again to confirm. That's a manual trigger of the same
   `workflow_dispatch` event the schedule uses.
2. Watch the run: each step (fetch → sanity-check → normalize → publish)
   shows its own log; the sanity-check step in particular prints the
   fetched file's size/line count so you can see it's real data, not an
   error page.
3. On success, check this repo's **Releases** page (right sidebar on the
   repo's main page, or `github.com/<org>/kaikki-yoruba/releases`) - a new
   release tagged `build-<N>` should appear with `entries.json` and
   `metadata.json` attached. That's the actual deliverable - download those
   two files to confirm, or open `metadata.json` directly to see the run's
   stats.

If you have the `gh` CLI installed locally (it isn't available in this
dev environment, so this hasn't been exercised): `gh workflow run
refresh.yml` triggers the same thing from a terminal, and `gh run watch`
follows the live log.

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
right-sized-but-wrong-shape response. The `contents: write` permission the
release-publish step needs is declared directly in the workflow file, not
left to a repo settings default.

**Open items, not yet resolved:**
- **Not yet integrated with either consumer.** `yorubadict`'s build hasn't
  been retargeted to consume this repo's artifact yet (still runs its own
  parser/normalizer). `yoruba_student_dict_platform`'s downstream ingestion
  step (the Postgres schema + componentCandidates/altOfTargets/
  standardForms derivation) hasn't been built yet either.
- **The workflow itself hasn't had a real scheduled/dispatched run yet** -
  the fetch+sanity-check+normalize chain was verified by running each part
  locally (see "Status" above), not by an actual GitHub Actions execution.
  See "How to trigger a real run" above.
