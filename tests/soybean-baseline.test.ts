import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import baseline from './browser/soybean-baseline.json';

test('the approved Soybean theme, styles and layout materials remain pinned to their source', () => {
  for (const [file, digest] of Object.entries(baseline.sha256)) {
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), digest, file);
  }
});
