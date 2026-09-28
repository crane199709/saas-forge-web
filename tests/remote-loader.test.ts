/* eslint-disable no-await-in-loop -- 按版本顺序验证切换与固定制品。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { remoteAssetBase } from '../src/runtime/remote-loader';

test('Remote resources only use fixed versions on the distinct controlled HTTPS origin', () => {
  assert.equal(
    remoteAssetBase('https://console.saas.forge.test', 'v1'),
    'https://remote.saas.forge.test/static-acceptance/v1/'
  );
  for (const origin of [
    'http://console.saas.forge.test',
    'https://api.saas.forge.test',
    'https://remote.saas.forge.test',
    'https://console.saas.forge.test:8443',
    'https://u:p@console.saas.forge.test',
    'https://console.saas.forge.test/path'
  ]) {
    assert.throws(() => remoteAssetBase(origin, 'v1'));
  }
  assert.throws(() => remoteAssetBase('https://console.saas.forge.test', '../v3' as 'v1'));
});

test('migrated static artifacts retain their published immutable bytes', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const root = new URL('../fixtures/static-remote/', import.meta.url);
  const expected = JSON.parse(await readFile(new URL('checksums.json', root), 'utf8'));
  for (const [version, files] of Object.entries(expected) as [string, Record<string, string>][]) {
    for (const [file, checksum] of Object.entries(files)) {
      const data = await readFile(new URL(`${version}/${file}`, root));
      assert.equal(createHash('sha256').update(data).digest('hex'), checksum);
    }
  }
});
