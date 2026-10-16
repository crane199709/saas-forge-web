import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { BrandPolicyFailure, createBrandPolicyApi } from '../src/service/forge/brand-policy';

const id = '019535d9-0001-7000-8000-000000000028';

test('platform policy disable uses the formal operation without browser-managed headers', async () => {
  const request = mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, `https://api.example.test/api/v1/platform/brand-assets/${id}/disable`);
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'omit');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer platform-token');
    assert.equal(headers.get('X-SF-CSRF'), '1');
    for (const name of ['Cookie', 'Origin', 'Sec-Fetch-Site']) assert.equal(headers.get(name), null);
    return Response.json({
      id,
      tenantId: '019535d9-0001-7000-8000-000000000003',
      kind: 'LOGO',
      disabledAt: '2026-10-14T08:00:00Z'
    });
  });
  try {
    const result = await createBrandPolicyApi('https://api.example.test', () => 'platform-token').disable(id);
    assert.equal(result.id, id);
  } finally {
    request.mock.restore();
  }
});

test('policy disable exposes missing target without suggesting Tenant profile edits', async () => {
  const request = mock.method(globalThis, 'fetch', async () =>
    Response.json({ code: 'BRAND_ASSET_NOT_FOUND' }, { status: 404 })
  );
  try {
    await assert.rejects(
      createBrandPolicyApi('https://api.example.test', () => 'platform-token').disable(id),
      (error: unknown) => error instanceof BrandPolicyFailure && error.code === 'missing'
    );
  } finally {
    request.mock.restore();
  }
});
