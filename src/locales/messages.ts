import { createI18n } from 'vue-i18n';
import { createParser } from '@intlify/message-compiler';
import { resolveValue } from '@intlify/core-base';

export type ConsoleLocale = 'zh-CN' | 'en';
type MessageCatalog = { [key: string]: string | MessageCatalog };
export const recoveryMessages = {
  'zh-CN': '暂时无法显示此内容。',
  en: 'This content is temporarily unavailable.'
};

/** 只接受当前产品语言；历史值、区域别名和不可信存储值统一回到中文。 */
export function normalizeLocale(value: unknown): ConsoleLocale {
  return value === 'en' ? 'en' : 'zh-CN';
}

/** 沿用 Vue i18n 的消息语法；资源只允许文本，不将富文本或编译异常送入页面。 */
export function parseMessage(value: string) {
  if (!value.trim() || /<\/?[a-z][^>]*>/i.test(value)) throw new Error('MESSAGE_INVALID');
  let invalid = false;
  const ast = createParser({
    onError: () => {
      invalid = true;
    }
  }).parse(value);
  if (invalid) throw new Error('MESSAGE_INVALID');
  return ast;
}

/** 一个 Realm 仍只有一个 Vue i18n；这里仅适配正式 resolver/missing 扩展点。 */
export function createConsoleI18n(locale: unknown, messages: Record<ConsoleLocale, MessageCatalog>) {
  const validity = new Map<string, boolean>();
  return createI18n({
    legacy: false,
    locale: normalizeLocale(locale),
    fallbackLocale: 'en',
    messages,
    missingWarn: false,
    fallbackWarn: false,
    missing: language => recoveryMessages[normalizeLocale(language)],
    messageResolver: (catalog, path) => {
      const value = resolveValue(catalog, path);
      if (typeof value !== 'string') return false;
      if (!validity.has(value)) {
        try {
          parseMessage(value);
          validity.set(value, true);
        } catch {
          validity.set(value, false);
        }
      }
      // false 让 Vue i18n 继续英文回退；null 会触发库内未经校验的平铺 key 读取。
      return validity.get(value) ? value : false;
    }
  });
}
