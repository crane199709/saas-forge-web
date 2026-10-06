import { createHash } from 'node:crypto';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import vuePlugin from '@vitejs/plugin-vue';
import { version as vueVersion } from 'vue';
import { version as elementPlusVersion } from 'element-plus';

const root = fileURLToPath(new URL('../', import.meta.url));
const origin = new URL(process.argv[2] ?? 'https://console.saas.forge.test');
if (
  origin.protocol !== 'https:' ||
  origin.port ||
  !origin.hostname.startsWith('console.') ||
  origin.origin !== origin.href.slice(0, -1)
)
  throw new Error('Controlled Console origin required');
const result = await build({
  configFile: false,
  root,
  plugins: [vuePlugin()],
  logLevel: 'warn',
  build: {
    write: false,
    minify: false,
    lib: {
      entry: `${root}src/remotes/project/Remote.vue`,
      formats: ['cjs'],
      fileName: 'remote'
    },
    rollupOptions: { external: ['vue', 'element-plus'] }
  }
});
const outputs = Array.isArray(result) ? result.flatMap(item => item.output) : result.output;
if (outputs.length !== 1 || outputs[0].type !== 'chunk')
  throw new Error('Remote must have one entry and inherit Shell styles');
// 统一 Vue/Element Plus 由 Shell 注入；Remote 不打包第二份框架、主题或全局样式。
const script = `export function createComponent(dependencies) {
const module = { exports: {} }; const exports = module.exports;
const require = name => { if (name === 'vue') return dependencies.vue; if (name === 'element-plus') return dependencies.elementPlus; throw new Error('Remote dependency refused'); };
${outputs[0].code}
return module.exports.default || module.exports;
}\n`;
const version = '1.0.0';
const directory = `${root}dist/business-remotes/project/${version}`;
await mkdir(directory, { recursive: true });
await writeFile(`${directory}/remote.js`, script);
await writeFile(
  `${directory}/manifest-declaration.json`,
  `${JSON.stringify(
    {
      module: 'project',
      version,
      source: `https://remote.${origin.hostname.slice(8)}/project/${version}/remote.js`,
      uiVersion: `vue@${vueVersion};element-plus@${elementPlusVersion}`,
      entrySha256: createHash('sha256').update(script).digest('hex')
    },
    null,
    2
  )}\n`
);
console.log(
  'Built Project Remote with shared Shell UI; declaration requires CI registration and administrator approval'
);
