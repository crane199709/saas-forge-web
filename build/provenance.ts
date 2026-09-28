import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 只暴露源码摘要和公开制品来源，不读取或输出环境变量、个人配置及凭据。 */
export function frontendProvenance() {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const source = JSON.parse(
    readFileSync(
      new URL('../node_modules/@crane199709/saas-forge-api-client/contract-source.json', import.meta.url),
      'utf8'
    )
  );
  const version = manifest.dependencies['@crane199709/saas-forge-api-client'];
  if (source.version !== version || source.dirty || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error('CLIENT_VERSION_MISMATCH');
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url));
  if (!lock.toString().includes(`'@crane199709/saas-forge-api-client@${version}':`))
    throw new Error('CLIENT_LOCK_MISMATCH');
  const resolution = /'@crane199709\/saas-forge-api-client':\s+specifier: ([^\n]+)\s+version: ([^\n]+)/.exec(
    lock.toString()
  );
  if (!resolution || resolution[1].trim() !== version || resolution[2].trim() !== version)
    throw new Error('CLIENT_IMPORTER_MISMATCH');
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: new URL('../', import.meta.url), encoding: 'utf8' }).trim();
  const sourceHash = createHash('sha256');
  const paths = git(
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
    '--',
    'src',
    'build',
    'public',
    'packages',
    'index.html',
    'vite.config.ts',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.json'
  );
  for (const path of [...new Set(paths.split('\0').filter(Boolean))].sort()) {
    const file = resolve(fileURLToPath(new URL('../', import.meta.url)), path);
    sourceHash
      .update(path)
      .update('\0')
      .update(existsSync(file) ? readFileSync(file) : '<deleted>')
      .update('\0');
  }
  return {
    frontend: {
      commit: git('rev-parse', 'HEAD'),
      dirty: Boolean(git('status', '--porcelain')),
      sourceSha256: sourceHash.digest('hex'),
      lockSha256: createHash('sha256').update(lock).digest('hex')
    },
    client: { name: source.package, version, sourceCommit: source.commit }
  };
}
