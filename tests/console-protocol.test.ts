import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sources(path) : [path].filter(file => /\.(ts|vue)$/.test(file));
  });
}

// 迁入原 BrowserSessionSlotContractTest 的调用方门禁，并按统一 Console v2 协议调整。
test('production Console callers do not revive retired browser slots or raw authentication endpoints', () => {
  for (const directory of ['src/runtime', 'src/service/forge', 'src/pages']) {
    const files = sources(directory);
    assert.ok(files.length > 0, `Missing production callers: ${directory}`);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(source, /__Host-sf_(?:refresh|platform_refresh|tenant_refresh)/, file);
      assert.doesNotMatch(source, /\/api\/v[12]\/auth\/(?:login|refresh|logout|context-selections)/, file);
      assert.doesNotMatch(
        source,
        /(?:localStorage|sessionStorage)\.setItem\(\s*['"](?:accessToken|refreshToken|token)['"]/,
        file
      );
    }
  }
});
