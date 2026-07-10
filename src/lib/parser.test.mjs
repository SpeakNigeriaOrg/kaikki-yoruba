import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseJsonl } from './parser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function withTempFile(contents, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'kaikki-yoruba-test-'));
  const filePath = path.join(dir, 'input.jsonl');
  writeFileSync(filePath, contents, 'utf-8');
  try {
    return fn(filePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseJsonl parses one JSON object per line', () => {
  withTempFile('{"a":1}\n{"b":2}\n', (filePath) => {
    const { records, errors } = parseJsonl(filePath);
    assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(errors, []);
  });
});

test('parseJsonl skips blank lines without error', () => {
  withTempFile('{"a":1}\n\n\n{"b":2}\n', (filePath) => {
    const { records, errors } = parseJsonl(filePath);
    assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
    assert.deepEqual(errors, []);
  });
});

test('parseJsonl reports the 1-indexed line number of a malformed line, and still parses the rest', () => {
  withTempFile('{"a":1}\nnot json\n{"b":2}\n', (filePath) => {
    const { records, errors } = parseJsonl(filePath);
    assert.deepEqual(records, [{ a: 1 }, { b: 2 }]);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, 2);
  });
});

test('parseJsonl on the real sample fixture parses all 16 records with no errors', () => {
  const fixturePath = path.resolve(__dirname, '..', '..', 'data', 'sample.jsonl');
  const { records, errors } = parseJsonl(fixturePath);
  assert.equal(records.length, 16);
  assert.deepEqual(errors, []);
});
