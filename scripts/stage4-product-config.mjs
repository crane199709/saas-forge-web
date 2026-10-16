import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import process from 'node:process';

function privateFile(path) {
  assert.ok(isAbsolute(path), 'CONFIG_PATH_INVALID');
  const file = lstatSync(path);
  assert.ok(file.isFile() && file.uid === process.getuid() && file.mode % 128 === 0, 'INPUT_NOT_PRIVATE');
}

/** Restricted paths only; credential contents never become part of report or config validation. */
export function loadStage4ProductConfig(path) {
  privateFile(path);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(
    Object.keys(config).sort(),
    ['faviconPng', 'handoff', 'invitationEmail', 'logoPng', 'rolePermission', 'tenantAdmin'].sort(),
    'CONFIG_FIELDS_INVALID'
  );
  assert.deepEqual(Object.keys(config.tenantAdmin).sort(), ['email', 'passwordFile']);
  for (const file of [config.handoff, config.tenantAdmin.passwordFile]) privateFile(file);
  for (const assetPath of [config.logoPng, config.faviconPng]) {
    assert.ok(typeof assetPath === 'string' && isAbsolute(assetPath), 'CONFIG_ASSET_PATH_INVALID');
  }
  assert.match(config.tenantAdmin.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  assert.match(config.invitationEmail, /^[^\s@]+@[^\s@]+\.test$/);
  assert.equal(config.invitationEmail, config.invitationEmail.toLowerCase(), 'INVITATION_TARGET_INVALID');
  assert.notEqual(config.invitationEmail, config.tenantAdmin.email, 'INVITATION_TARGET_INVALID');
  assert.match(config.rolePermission, /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/);
  return config;
}
