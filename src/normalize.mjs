#!/usr/bin/env node
// src/normalize.mjs
//
// Orchestrator: Kaikki JSONL -> Parser -> Normalizer -> morpheme resolution
// -> canonical artifact. Mostly stops there - reciprocal relationship
// synthesis for derivedTerms/relatedTerms/synonyms/antonyms/descendants,
// validation reporting, and search-index building are each consumer's own
// specialized concern (yorubadict's build/lib/{relationships,validator,
// search-index}.mjs stay in yorubadict; yoruba_student_dict_platform's
// componentCandidates/altOfTargets/standardForms derivation stays in its
// own ingestion step). The one exception is etymology-morpheme resolution
// (lib/morphemeResolution.mjs) - genuinely self-contained given just
// entries + their etymologyMorphemes, and previously duplicated (with the
// same two bugs) across both downstream consumers - see this repo's
// README for the full rationale.
//
// Usage:
//   node src/normalize.mjs [path-to-jsonl] [--source-date=YYYY-MM-DD]
//
// Defaults to data/sample.jsonl (a 16-record smoke-test fixture, not the
// real corpus - the real dictionary-Yoruba.jsonl is fetched by the
// scheduled workflow, not committed to this repo). Writes:
//   dist/entries.json    - id-keyed object, one canonical entry per record
//   dist/metadata.json   - generatedAt, recordCount, parseErrorCount,
//                          contentHash, sourceDate (if provided)

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './lib/parser.mjs';
import { normalizeRecords } from './lib/normalizer.mjs';
import { resolveMorphemeRelationships } from './lib/morphemeResolution.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const sourceDateArg = args.find((a) => a.startsWith('--source-date='));
const sourceDate = sourceDateArg ? sourceDateArg.split('=')[1] : null;

const inputPath = positional[0] ? path.resolve(process.cwd(), positional[0]) : path.join(rootDir, 'data', 'sample.jsonl');

const outDir = path.join(rootDir, 'dist');
const outEntriesPath = path.join(outDir, 'entries.json');
const outMetadataPath = path.join(outDir, 'metadata.json');

function main() {
  console.log(`[1/3] Parsing ${path.relative(rootDir, inputPath)} ...`);
  const { records, errors: parseErrors } = parseJsonl(inputPath);
  console.log(`      ${records.length} records parsed, ${parseErrors.length} parse errors`);
  if (parseErrors.length > 0) {
    for (const err of parseErrors.slice(0, 10)) {
      console.log(`      line ${err.line}: ${err.message}`);
    }
  }

  console.log('[2/3] Normalizing records into canonical entries ...');
  const entries = normalizeRecords(records);

  console.log('[3/3] Resolving etymology-morpheme relationships ...');
  resolveMorphemeRelationships(entries);

  // Entries are shipped as an id-keyed object for O(1) lookup, matching
  // yorubadict's own convention for its equivalent artifact.
  const entriesById = Object.fromEntries(entries.map((e) => [e.id, e]));
  const entriesJson = JSON.stringify(entriesById);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outEntriesPath, entriesJson);

  const metadata = {
    generatedAt: new Date().toISOString(),
    sourceDate,
    sourceFile: path.basename(inputPath),
    recordCount: entries.length,
    parseErrorCount: parseErrors.length,
    contentHash: createHash('sha256').update(entriesJson).digest('hex'),
  };
  writeFileSync(outMetadataPath, JSON.stringify(metadata, null, 2));

  const sizeKb = (statSync(outEntriesPath).size / 1024).toFixed(1);
  console.log('\nDone.');
  console.log(`  entries.json   ${sizeKb} KB, ${entries.length} entries`);
  console.log(`  contentHash    ${metadata.contentHash.slice(0, 12)}...`);
}

main();
