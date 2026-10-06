import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnabledRemoteManifest } from '@crane199709/saas-forge-api-client';
import { businessRemoteSource, loadBusinessRemote } from '../src/runtime/business-remote-loader';

const manifest: EnabledRemoteManifest = {
  id: '0198c9d5-0f25-7b21-8d67-31c8652d4c8f',
  module: 'project',
  version: '1.0.0',
  source: 'https://remote.saas.forge.test/project/1.0.0/remote.js',
  uiVersion: 'shared-ui',
  entrySha256: 'a'.repeat(64)
};

test('business Remote rejects altered source and UI declarations before downloading scripts', () => {
  assert.equal(businessRemoteSource('https://console.saas.forge.test', manifest, 'shared-ui'), manifest.source);
  for (const source of [
    'https://attacker.test/remote.js',
    `${manifest.source}?token=value`,
    `${manifest.source}#fragment`,
    'https://remote.saas.forge.test:8443/project/1.0.0/remote.js',
    'https://remote.saas.forge.test/project/1.0.0/%72emote.js'
  ])
    assert.throws(() => businessRemoteSource('https://console.saas.forge.test', { ...manifest, source }, 'shared-ui'));
  assert.throws(() => businessRemoteSource('https://console.saas.forge.test', manifest, 'other-ui'));
  assert.throws(() => businessRemoteSource('http://console.saas.forge.test', manifest, 'shared-ui'));
  assert.throws(() => businessRemoteSource('https://api.saas.forge.test', manifest, 'shared-ui'));
  assert.throws(() =>
    businessRemoteSource('https://console.saas.forge.test', { ...manifest, version: '../1' }, 'shared-ui')
  );
});

test('download omits credentials and refuses altered bytes or oversized entries before execution', async t => {
  const requests: RequestInit[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    return new Response('export const changed = true;', { headers: { 'Content-Type': 'text/javascript' } });
  });
  const options = {
    consoleOrigin: 'https://console.saas.forge.test',
    uiVersion: 'shared-ui',
    dependencies: {},
    signal: new AbortController().signal
  };
  await assert.rejects(loadBusinessRemote(manifest, options), { message: 'REMOTE_LOAD_FAILED' });
  assert.equal(requests[0].credentials, 'omit');
  assert.equal(requests[0].redirect, 'error');
  assert.equal(requests[0].headers, undefined);
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(new Uint8Array(1024 * 1024 + 1), {
        headers: { 'Content-Type': 'text/javascript' }
      })
  );
  await assert.rejects(loadBusinessRemote(manifest, options), { message: 'REMOTE_LOAD_FAILED' });
});
