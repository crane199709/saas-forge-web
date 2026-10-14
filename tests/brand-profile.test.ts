import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { BrandProfileFailure, createBrandProfileApi } from '../src/service/forge/brand-profile';

const change = {
  displayName: 'Acme',
  logoUrl: '/brands/019535d9-0001-7000-8000-000000000011',
  faviconUrl: '/brands/019535d9-0001-7000-8000-000000000012',
  primaryColor: '#123456',
  accentColor: '#234567'
};

test('formal brand profile save sends one revision and five fields without browser-managed security headers', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.example.test/api/v1/brand-profile');
    assert.equal(init.method, 'PUT');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('If-Match'), '"2"');
    assert.equal(headers.get('X-SF-CSRF'), '1');
    assert.equal(headers.get('Authorization'), 'Bearer user-access-token');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.get(name), null);
    assert.deepEqual(JSON.parse(String(init.body)), change);
    return Response.json({ revision: 3, profile: change });
  });
  try {
    const saved = await createBrandProfileApi('https://api.example.test', () => 'user-access-token').save(2, change);
    assert.equal(saved.revision, 3);
    assert.deepEqual(saved.profile, change);
  } finally {
    request.mock.restore();
  }
});

test('stale brand profile save is a distinct recoverable conflict', async () => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'BRAND_PROFILE_STALE' }, { status: 412 })
  );
  try {
    await assert.rejects(
      createBrandProfileApi('https://api.example.test', () => 'user-access-token').save(2, change),
      (error: unknown) => error instanceof BrandProfileFailure && error.code === 'stale'
    );
  } finally {
    request.mock.restore();
  }
});
