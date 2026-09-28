import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = new URL('../scripts/verify-browser.mjs', import.meta.url).pathname;
test('browser entry validates the prepared handoff before loading Chrome or reading credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'frontend-handoff-'));
  try {
    const path = join(root, 'handoff.json');
    const receipt = {
      schemaVersion: 1,
      runId: '75a812cc-bf14-610c-bf4f-169d15ed648e',
      status: 'ready',
      readyAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      consoleOrigin: 'https://console.example.test',
      apiOrigin: 'https://api.example.test',
      backend: { commit: 'a'.repeat(40), dirty: false, versionSource: 'source-checkout-only-runtime-unverified' },
      isolation: { kind: 'existing-environment' },
      cleanup: { owner: 'environment-preparer', automatic: false },
      jwksSha256: 'b'.repeat(64)
    };
    const run = () => spawnSync(process.execPath, [cli, '--check-handoff', '--', path], { encoding: 'utf8' });
    writeFileSync(path, JSON.stringify(receipt));
    const valid = run();
    assert.equal(valid.status, 0, valid.stderr);
    for (const invalid of [
      { status: 'prepared' },
      { expiresAt: '2000-01-01T00:00:00Z' },
      { expiresAt: 'invalid' },
      { consoleOrigin: 'https://user:private-secret@console.example.test' },
      { apiOrigin: 'http://api.example.test' },
      { schemaVersion: 2 },
      { cleanup: { owner: 'frontend', automatic: true } },
      { isolation: { kind: 'fresh-compose' } }
    ]) {
      writeFileSync(path, JSON.stringify({ ...receipt, ...invalid }));
      const result = run();
      assert.equal(result.status, 1);
      assert.ok(!`${result.stdout}${result.stderr}`.includes('private-secret'));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
