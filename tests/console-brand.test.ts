import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { controlledBrandAsset, resolveConsoleBrand, validBrand } from '../src/runtime/console-brand';

const brand = {
  displayName: 'Company A',
  logoUrl: '/brands/a.svg',
  faviconUrl: '/brands/a.png',
  primaryColor: '#123456',
  accentColor: '#654321'
};
const snapshot = {
  sessionId: 'session',
  revision: '3',
  state: 'AUTHENTICATED' as const,
  activeContext: { type: 'TENANT' as const, brand }
};

test('brand profiles reject external assets, path escapes, incomplete profiles and unreadable colors', () => {
  assert.equal(validBrand(brand), true);
  for (const url of [
    'https://evil.test/a.svg',
    '//evil.test/a.svg',
    '/brands/../../a.svg',
    '/brands/%2e%2e/a.svg',
    '/brands/a.svg?redirect=evil',
    '/brands/a.svg#x',
    '/brands/'
  ]) {
    assert.equal(controlledBrandAsset(url), false, url);
  }
  assert.equal(validBrand({ ...brand, faviconUrl: undefined }), false);
  assert.equal(validBrand({ ...brand, primaryColor: '#ffffff' }), false);
  assert.equal(validBrand({ ...brand, displayName: '\u0001' }), false);
});

test('invalid brand asset MIME types fall back to the platform brand', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async (_url: string | URL | Request, options?: RequestInit) => {
    assert.equal(options?.credentials, 'omit');
    assert.equal(options?.redirect, 'error');
    return new Response('wrong type', { headers: { 'content-type': 'text/html' } });
  });
  try {
    assert.equal(await resolveConsoleBrand(snapshot), undefined);
    assert.equal(await resolveConsoleBrand({ ...snapshot, activeContext: { type: 'PLATFORM' } }), undefined);
  } finally {
    fetchMock.mock.restore();
  }
});

test('a failed favicon releases the loaded logo and never exposes a partial tenant brand', async () => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    value: class {
      src = '';
      naturalWidth = 20;
      naturalHeight = 20;
      async decode() {
        assert.match(this.src, /^blob:/);
      }
    }
  });
  const revoked = mock.method(URL, 'revokeObjectURL');
  const fetchMock = mock.method(globalThis, 'fetch', async (url: string | URL | Request) =>
    String(url).endsWith('.svg')
      ? new Response('logo', { headers: { 'content-type': 'image/svg+xml' } })
      : new Response('', { status: 404 })
  );
  try {
    assert.equal(await resolveConsoleBrand(snapshot), undefined);
    assert.equal(revoked.mock.callCount(), 1);
    assert.match(revoked.mock.calls[0].arguments[0], /^blob:/);
  } finally {
    fetchMock.mock.restore();
    revoked.mock.restore();
    if (originalImage) Object.defineProperty(globalThis, 'Image', originalImage);
    else Reflect.deleteProperty(globalThis, 'Image');
  }
});
