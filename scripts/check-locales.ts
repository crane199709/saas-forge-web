import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseMessage } from '../src/locales/messages';
import catalogs from '../src/locales/locale';

function flatten(value: unknown, path = '', result = new Map<string, string>()) {
  if (typeof value === 'string') result.set(path, value);
  else if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, path ? `${path}.${key}` : key, result);
  } else throw new Error(`Invalid message value: ${path}`);
  return result;
}

function signature(value: string) {
  const parameters = new Set<string>();
  function visit(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    if (item.type === 4) parameters.add(`named:${item.key}`);
    if (item.type === 5) parameters.add(`list:${item.index}`);
    Object.values(item).forEach(child => (Array.isArray(child) ? child.forEach(visit) : visit(child)));
  }
  visit(parseMessage(value));
  return [...parameters].sort().join(',');
}

/** 检查实际 Vue i18n 资源，保留旧门禁的完整性、参数和文本安全约束。 */
export function checkCatalogs(messages: Record<string, unknown>) {
  if (Object.keys(messages).sort().join(',') !== 'en,zh-CN') throw new Error('Unsupported locale registry');
  const reference = flatten(messages.en);
  for (const [locale, catalog] of Object.entries(messages)) {
    const entries = flatten(catalog);
    if ([...entries.keys()].sort().join('\n') !== [...reference.keys()].sort().join('\n'))
      throw new Error(`Message keys differ: ${locale}`);
    for (const [key, value] of entries) {
      try {
        if (signature(value) !== signature(reference.get(key)!)) throw new Error('PARAMETERS_DIFFER');
      } catch {
        // 不把资源原文或插值值写入错误日志。
        throw new Error(`Invalid message syntax or parameters: ${locale}.${key}`);
      }
    }
  }
  return reference.size;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Locale resources checked: ${checkCatalogs(catalogs)} keys in zh-CN/en`);
}
