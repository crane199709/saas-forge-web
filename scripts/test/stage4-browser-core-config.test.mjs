import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadStage4BrowserCoreConfig } from '../stage4-browser-core-config.mjs';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'sf-stage4-browser-core-'));
  const handoff = join(directory, 'handoff.json');
  const adminPassword = join(directory, 'admin-password');
  const memberPassword = join(directory, 'member-password');
  for (const file of [handoff, adminPassword, memberPassword]) writeFileSync(file, 'private', { mode: 0o600 });
  const config = {
    handoff,
    tenantAdmin: { email: 'admin@example.test', passwordFile: adminPassword },
    ordinaryMember: { email: 'member@example.test', passwordFile: memberPassword }
  };
  const path = join(directory, 'config.json');
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  return { config, path, adminPassword };
}

test('accepts only private Fresh browser actor references', () => {
  const { config, path } = fixture();
  assert.deepEqual(loadStage4BrowserCoreConfig(path), config);
});

test('rejects an insecure credential file before launching Chrome', () => {
  const { path, adminPassword } = fixture();
  chmodSync(adminPassword, 0o644);
  assert.throws(() => loadStage4BrowserCoreConfig(path), /INPUT_NOT_PRIVATE/);
});

test('rejects the same identity in both actor slots', () => {
  const { path, config } = fixture();
  config.ordinaryMember.email = config.tenantAdmin.email;
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  assert.throws(() => loadStage4BrowserCoreConfig(path), /ACTORS_MUST_DIFFER/);
});
