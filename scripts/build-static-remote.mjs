import { createHash } from 'node:crypto';
import { cp, mkdir, readFile } from 'node:fs/promises';

const source = new URL('../fixtures/static-remote/', import.meta.url);
const destination = new URL('../dist/static-remote-acceptance/', import.meta.url);
const checksums = JSON.parse(await readFile(new URL('checksums.json', source), 'utf8'));
// 固定旧制品字节，避免更换 bundler 后重写已发布的 immutable 路径。
await Promise.all(
  Object.entries(checksums).flatMap(([version, files]) =>
    Object.entries(files).map(async ([file, expected]) => {
      const actual = createHash('sha256')
        .update(await readFile(new URL(`${version}/${file}`, source)))
        .digest('hex');
      if (actual !== expected) throw new Error(`${version}/${file}: frozen artifact changed`);
    })
  )
);
await mkdir(destination, { recursive: true });
await Promise.all(
  Object.keys(checksums).map(version =>
    cp(new URL(version, source), new URL(version, destination), { recursive: true })
  )
);
console.log('Verified and copied frozen Remote v1/v2 artifacts');
