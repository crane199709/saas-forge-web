import assert from 'node:assert/strict';
import test from 'node:test';
import { createConsoleI18n, normalizeLocale } from '../src/locales/messages';
import catalogs from '../src/locales/locale';
import { checkCatalogs } from '../scripts/check-locales';

test('only current product locales are accepted; legacy English returns to Chinese', () => {
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(normalizeLocale('zh-CN'), 'zh-CN');
  for (const value of ['en-US', 'en-GB', 'EN', '', undefined, null, {}, 1]) {
    assert.equal(normalizeLocale(value), 'zh-CN');
    assert.equal(createConsoleI18n(value, catalogs).global.t('console.signIn'), '登录');
  }
});

test('missing and malformed Chinese messages fall back to the English resource', () => {
  const i18n = createConsoleI18n('zh-CN', {
    'zh-CN': { greeting: '{name', unsafe: '<b>unsafe</b>', blank: ' ' },
    en: { greeting: 'Hello {name}', missing: 'English', unsafe: 'Plain text', blank: 'Available' }
  });
  assert.equal(i18n.global.t('greeting', { name: 'reader' }), 'Hello reader');
  assert.equal(i18n.global.t('missing'), 'English');
  assert.equal(i18n.global.t('unsafe'), 'Plain text');
  assert.equal(i18n.global.t('blank'), 'Available');
});

test('invalid messages in both languages give safe text, never keys or compiler errors', () => {
  const i18n = createConsoleI18n('en', { 'zh-CN': {}, en: { bad: '{name', 'flat.bad': '{broken' } });
  for (const key of ['missing', 'bad', 'flat.bad']) {
    assert.equal(i18n.global.t(key), 'This content is temporarily unavailable.');
  }
});

test('Vue i18n named/list interpolation and plural semantics remain available', () => {
  const i18n = createConsoleI18n('en', {
    'zh-CN': {},
    en: { named: 'Hello {name}', list: '{0} then {1}', count: 'no items | one item | {count} items' }
  });
  assert.equal(i18n.global.t('named', { name: 'reader' }), 'Hello reader');
  assert.equal(i18n.global.t('list', ['first', 'second']), 'first then second');
  assert.equal(i18n.global.t('count', 0), 'no items');
  assert.equal(i18n.global.t('count', 1), 'one item');
  assert.equal(i18n.global.t('count', 3), '3 items');
});

test('all committed resource keys, syntax and interpolation signatures agree', () => {
  assert.ok(checkCatalogs(catalogs) > 500);
});

test('resource validation fails for omissions, empty values, HTML, syntax and mismatched parameters', () => {
  for (const message of ['', '<b>unsafe</b>', '{broken', '{other}', '{count, plural, one {item} other {items}}']) {
    assert.throws(() => checkCatalogs({ en: { value: '{name}' }, 'zh-CN': { value: message } }));
  }
  assert.throws(() => checkCatalogs({ en: { value: 'text' }, 'zh-CN': {} }));
  assert.throws(() => checkCatalogs({ 'en-US': {}, 'zh-CN': {} }));
});
