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
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './lib/parser.mjs';
import { normalizeRecords } from './lib/normalizer.mjs';
import { resolveMorphemeRelationships } from './lib/morphemeResolution.mjs';
import { attachDialectSynonyms, buildDialectSets, parseVarietyMetadata } from './lib/dialectSynonyms.mjs';
import { buildTableMarkers, EMPTY_MARKERS } from './lib/relationDebris.mjs';

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
const dialectSnapshotPath = path.join(rootDir, 'data', 'dialect-synonyms.json');

// The snapshot is written by src/fetch-dialect-synonyms.mjs and committed, so
// the build stays offline and reproducible. Without it the build still
// succeeds - relation lists just keep the flattened table text, exactly as
// before this feature - so a fetch outage degrades rather than fails.
function loadDialectSnapshot() {
  if (!existsSync(dialectSnapshotPath)) return null;
  return JSON.parse(readFileSync(dialectSnapshotPath, 'utf8'));
}

function main() {
  console.log(`[1/3] Parsing ${path.relative(rootDir, inputPath)} ...`);
  const { records, errors: parseErrors } = parseJsonl(inputPath);
  console.log(`      ${records.length} records parsed, ${parseErrors.length} parse errors`);
  if (parseErrors.length > 0) {
    for (const err of parseErrors.slice(0, 10)) {
      console.log(`      line ${err.line}: ${err.message}`);
    }
  }

  const snapshot = loadDialectSnapshot();
  let dialectMetadata = null;
  let dialectSets = [];
  if (snapshot) {
    dialectMetadata = parseVarietyMetadata(snapshot.metadataContent);
    const built = buildDialectSets(snapshot.pages, dialectMetadata);
    dialectSets = built.sets;
    console.log(
      `[2/4] Dialect source: ${dialectSets.length} datasets, ` +
        `${dialectSets.reduce((n, s) => n + s.termCount, 0)} terms, ` +
        `${dialectMetadata.varieties.size} varieties indexed`
    );
    for (const warning of built.warnings) console.log(`      warning: ${JSON.stringify(warning)}`);
  } else {
    console.log(`[2/4] Dialect source: ${path.relative(rootDir, dialectSnapshotPath)} absent - skipping`);
  }

  console.log('[3/4] Normalizing records into canonical entries ...');
  const tableTextDrops = [];
  const entries = normalizeRecords(records, {
    markers: dialectMetadata ? buildTableMarkers(dialectMetadata) : EMPTY_MARKERS,
    onTableText: (drop) => tableTextDrops.push(drop),
  });
  const droppedFields = new Map();
  for (const drop of tableTextDrops) droppedFields.set(drop.field, (droppedFields.get(drop.field) || 0) + 1);
  console.log(
    `      dropped ${tableTextDrops.length} rendered-table relation list(s)` +
      (droppedFields.size ? ` (${[...droppedFields].map(([f, n]) => `${f} ${n}`).join(', ')})` : '')
  );

  console.log('[4/4] Resolving etymology-morpheme and dialect relationships ...');
  resolveMorphemeRelationships(entries);
  const dialectReport = attachDialectSynonyms(entries, dialectSets);
  console.log(
    `      dialect sets attached to ${dialectReport.attached}/${dialectReport.datasets} entries` +
      (dialectReport.unmatched.length ? `, ${dialectReport.unmatched.length} unmatched` : '')
  );
  for (const miss of dialectReport.unmatched) console.log(`      unmatched: ${miss.page}`);
  for (const amb of dialectReport.ambiguous) {
    console.log(`      ambiguous: ${amb.page} -> ${amb.chose} (of ${amb.candidates.length}, gloss overlap ${amb.glossOverlap})`);
  }

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
