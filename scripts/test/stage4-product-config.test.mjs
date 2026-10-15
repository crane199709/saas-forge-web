import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadStage4ProductConfig } from '../stage4-product-config.mjs';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sf-stage4-product-'));
  const passwordFile = join(dir, 'password');
  const configFile = join(dir, 'config.json');
  const handoff = join(dir, 'handoff.json');
  writeFileSync(passwordFile, 'only-this-round-secret-123\n', { mode: 0o600 });
  writeFileSync(handoff, '{}\n', { mode: 0o600 });
  const value = {
    handoff,
    tenantAdmin: { email: 'admin@example.test', passwordFile },
    invitationEmail: 'invitee@example.test',
    rolePermission: 'example:project:list',
    logoPng: join(dir, 'logo.png'),
    faviconPng: join(dir, 'favicon.png')
  };
  writeFileSync(configFile, JSON.stringify(value), { mode: 0o600 });
  return { configFile, value };
}

test('accepts only private Fresh product inputs without reading credential values into the result', () => {
  const { configFile, value } = fixture();
  assert.deepEqual(loadStage4ProductConfig(configFile), value);
  chmodSync(configFile, 0o644);
  assert.throws(() => loadStage4ProductConfig(configFile), /PRIVATE/);
});

test('rejects shared recipient or injected credential and operation settings', () => {
  const { configFile, value } = fixture();
  writeFileSync(configFile, JSON.stringify({ ...value, invitationEmail: value.tenantAdmin.email }));
  assert.throws(() => loadStage4ProductConfig(configFile), /INVITATION/);
  writeFileSync(configFile, JSON.stringify({ ...value, token: 'do-not-accept' }));
  assert.throws(() => loadStage4ProductConfig(configFile), /CONFIG/);
});

test('rejects a password file readable by anyone beyond its owner', () => {
  const { configFile, value } = fixture();
  chmodSync(value.tenantAdmin.passwordFile, 0o644);
  assert.throws(() => loadStage4ProductConfig(configFile), /PRIVATE/);
});
