import assert from 'node:assert/strict';
import test from 'node:test';
import { requireHttpsOrigin } from '../src/service/forge/config';

test('accepts a configured HTTPS Gateway origin', () => {
  assert.equal(requireHttpsOrigin('https://api.example.test/'), 'https://api.example.test');
  assert.equal(requireHttpsOrigin('https://api.example.test:8443'), 'https://api.example.test:8443');
});

test('rejects missing configuration, credentials, insecure targets and endpoint paths', () => {
  for (const input of [
    undefined,
    '',
    ' http://localhost',
    'http://api.example.test',
    'https://user:secret@api.example.test',
    'https://api.example.test/api',
    'https://api.example.test?token=secret',
    'https://api.example.test#fragment',
    'https://api.example.test//',
    'https://api.example.test/../'
  ]) {
    assert.throws(() => requireHttpsOrigin(input), { message: 'GATEWAY_CONFIGURATION_INVALID' });
  }
});
