import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';
import test from 'node:test';

test('build provenance remains available after an unstaged source deletion and changes its digest', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-provenance-'));
  try {
    for (const dir of ['build', 'src', 'node_modules/@crane199709/saas-forge-api-client']) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    copyFileSync(new URL('../build/provenance.ts', import.meta.url), join(root, 'build/provenance.ts'));
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        type: 'module',
        dependencies: {
          '@crane199709/saas-forge-api-client': '0.4.0'
        }
      })
    );
    writeFileSync(
      join(root, 'pnpm-lock.yaml'),
      "importers:\n  .:\n    dependencies:\n      '@crane199709/saas-forge-api-client':\n        specifier: 0.4.0\n        version: 0.4.0\npackages:\n  '@crane199709/saas-forge-api-client@0.4.0': {}\n"
    );
    writeFileSync(
      join(root, 'node_modules/@crane199709/saas-forge-api-client/contract-source.json'),
      JSON.stringify({
        package: '@crane199709/saas-forge-api-client',
        version: '0.4.0',
        dirty: false,
        commit: 'a'.repeat(40)
      })
    );
    writeFileSync(join(root, 'src/removed.ts'), 'export const visible = true;\n');
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
    git('init');
    git('add', 'package.json', 'pnpm-lock.yaml', 'src', 'build');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture');
    const run = () => {
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {frontendProvenance} from './build/provenance.ts'; console.log(JSON.stringify(frontendProvenance()));"
        ],
        { cwd: root, encoding: 'utf8' }
      );
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const before = run();
    rmSync(join(root, 'src/removed.ts'));
    const after = run();
    assert.notEqual(after.frontend.sourceSha256, before.frontend.sourceSha256);
    assert.equal(after.frontend.commit, before.frontend.commit);
    assert.equal(after.client.version, '0.4.0');
    assert.ok(!JSON.stringify(after).includes(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
