import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatInstant, formatMoney, formatNumber } from '../src/locales/format';

// 来源：后端 b29a863 的 consoles/shared/i18n/test/index.test.ts；保留公开格式化行为。
test('calendar dates retain their date while instants follow the selected time zone', () => {
  assert.equal(formatDate({ value: '2026-01-02', locale: 'en-US' }), 'Jan 2, 2026');
  assert.equal(formatDate({ value: '2024-02-29', locale: 'zh-CN' }), '2024年2月29日');
  assert.match(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en-US', timeZone: 'America/Los_Angeles' }),
    /Jan 1, 2026/
  );
  assert.match(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
    /2026年1月2日/
  );
});

test('numbers and money retain large integers, trailing zeros and negative zero', () => {
  assert.equal(
    formatNumber({ value: '123456789012345678901234567890.0012300', locale: 'en-US' }),
    '123,456,789,012,345,678,901,234,567,890.0012300'
  );
  assert.equal(formatNumber({ value: '-0.00', locale: 'zh-CN' }), '-0.00');
  assert.equal(
    formatMoney({ value: '12345678901234567890.40', currency: 'USD', locale: 'en-US' }),
    '$12,345,678,901,234,567,890.40'
  );
  assert.equal(formatMoney({ value: '1200.500', currency: 'EUR', locale: 'en-US' }), '€1,200.500');
});

test('invalid values produce localized safe text rather than leaking the supplied input', () => {
  assert.equal(formatDate({ value: '2026-02-30', locale: 'zh-CN' }), '暂时无法显示此内容。');
  assert.equal(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en-US', timeZone: 'Mars/Olympus' }),
    'This content is temporarily unavailable.'
  );
  for (const value of ['1e3', '12\n', '<script>secret</script>']) {
    assert.equal(formatNumber({ value, locale: 'en-US' }), 'This content is temporarily unavailable.');
  }
  assert.equal(formatMoney({ value: '12.00', currency: '', locale: 'zh-CN' }), '暂时无法显示此内容。');
});
