import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createGatewayClient } from '../src/service/forge/client';

test('public discovery uses only the configured Gateway without credentials or redirects', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/.well-known/jwks.json');
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), null);
    return Response.json({ keys: [] });
  });
  try {
    assert.equal(await createGatewayClient('https://api.example.test').readPublicKeys(new AbortController().signal), 0);
    assert.equal(request.mock.callCount(), 1);
  } finally {
    request.mock.restore();
  }
});

for (const [status, code] of [
  [403, 'sourceRejected'],
  [503, 'serviceUnavailable']
] as const) {
  test(`reports HTTP ${status} as ${code}`, async () => {
    const request = mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
    try {
      await assert.rejects(
        createGatewayClient('https://api.example.test').readPublicKeys(new AbortController().signal),
        { code }
      );
    } finally {
      request.mock.restore();
    }
  });
}

test('reports network failure without leaking the fetch error', async () => {
  const request = mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('private-network-details');
  });
  try {
    await assert.rejects(createGatewayClient('https://api.example.test').readPublicKeys(new AbortController().signal), {
      code: 'networkUnavailable',
      message: 'networkUnavailable'
    });
  } finally {
    request.mock.restore();
  }
});

test('reports invalid service responses separately from network failure', async () => {
  const request = mock.method(globalThis, 'fetch', async () => Response.json({ unexpected: true }));
  try {
    await assert.rejects(createGatewayClient('https://api.example.test').readPublicKeys(new AbortController().signal), {
      code: 'serviceUnavailable'
    });
  } finally {
    request.mock.restore();
  }
});
