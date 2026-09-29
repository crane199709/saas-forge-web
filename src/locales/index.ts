import type { App } from 'vue';
import { localStg } from '@/utils/storage';
import messages from './locale';
import { createConsoleI18n, normalizeLocale } from './messages';

const initialLocale = normalizeLocale(localStg.get('lang'));
// 旧标识不再作为别名接受；失效偏好回到中文并写回，所有消费者读取同一结果。
localStg.set('lang', initialLocale);
const i18n = createConsoleI18n(initialLocale, messages);

export function setupI18n(app: App) {
  app.use(i18n);
  document.documentElement.lang = i18n.global.locale.value;
}

export const $t = i18n.global.t as App.I18n.$T;
export const getLocale = () => i18n.global.locale.value;

export function setLocale(locale: App.I18n.LangType) {
  i18n.global.locale.value = normalizeLocale(locale);
  document.documentElement.lang = i18n.global.locale.value;
}
