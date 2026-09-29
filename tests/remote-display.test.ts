import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatInstant, formatMoney, formatNumber } from '../src/locales/format';

test('Remote host formatting preserves decimal precision and calendar/instant semantics', () => {
  assert.equal(
    formatNumber({ value: '123456789012345678901234567890.0012300', locale: 'en' }),
    '123,456,789,012,345,678,901,234,567,890.0012300'
  );
  assert.equal(formatNumber({ value: '-0.00', locale: 'zh-CN' }), '-0.00');
  assert.equal(
    formatMoney({ value: '12345678901234567890.400', currency: 'USD', locale: 'en' }),
    '$12,345,678,901,234,567,890.400'
  );
  assert.equal(formatMoney({ value: '1200', currency: 'JPY', locale: 'zh-CN' }), 'JP¥1,200');
  assert.equal(formatDate({ value: '2024-02-29', locale: 'en' }), 'Feb 29, 2024');
  assert.match(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en', timeZone: 'America/Los_Angeles' }),
    /Jan 1, 2026/
  );
});

test('Remote display never exposes invalid data or shifts invalid dates into another month', () => {
  const unavailable = 'This content is temporarily unavailable.';
  for (const value of ['1e3', '12\n', ' 12', '+12', 'NaN'])
    assert.equal(formatNumber({ value, locale: 'en' }), unavailable);
  assert.equal(formatDate({ value: '2026-02-30', locale: 'en' }), unavailable);
  assert.equal(formatInstant({ value: '2026-01-02T01:30:00', locale: 'en' }), unavailable);
  assert.equal(formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en', timeZone: 'Mars/Olympus' }), unavailable);
  assert.equal(formatMoney({ value: '12.00', currency: '', locale: 'zh-CN' }), '暂时无法显示此内容。');
});
