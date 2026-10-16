import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import process from 'node:process';

function privateFile(path, maxBytes) {
  assert.ok(typeof path === 'string' && isAbsolute(path), 'CONFIG_PATH_INVALID');
  const file = lstatSync(path);
  assert.ok(
    file.isFile() && file.uid === process.getuid() && file.mode % 64 === 0 && file.size > 0 && file.size <= maxBytes,
    'INPUT_NOT_PRIVATE'
  );
}

/** Only file references and actor identifiers cross the CLI boundary; passwords never enter a report. */
export function loadStage4BrowserCoreConfig(path) {
  privateFile(path, 4096);
  const config = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(Object.keys(config).sort(), ['handoff', 'ordinaryMember', 'tenantAdmin']);
  privateFile(config.handoff, 65536);
  for (const actor of [config.tenantAdmin, config.ordinaryMember]) {
    assert.deepEqual(Object.keys(actor).sort(), ['email', 'passwordFile']);
    assert.match(actor.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    privateFile(actor.passwordFile, 4096);
  }
  assert.notEqual(
    config.tenantAdmin.email.toLowerCase(),
    config.ordinaryMember.email.toLowerCase(),
    'ACTORS_MUST_DIFFER'
  );
  return config;
}
