import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatInstant, formatMoney, formatNumber } from '../src/locales/format';

// 来源：后端 b29a863 的 consoles/shared/i18n/test/index.test.ts；保留公开格式化行为。
test('calendar dates retain their date while instants follow the selected time zone', () => {
  assert.equal(formatDate({ value: '2026-01-02', locale: 'en' }), 'Jan 2, 2026');
  assert.equal(formatDate({ value: '2024-02-29', locale: 'zh-CN' }), '2024年2月29日');
  assert.equal(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en', timeZone: 'America/Los_Angeles' }),
    '2026-01-01 17:30:00 PST'
  );
  assert.equal(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'zh-CN', timeZone: 'Asia/Shanghai' }),
    '2026-01-02 09:30:00 GMT+8'
  );
});

// 202610162320：#13 统一时间点结构为 `YYYY-MM-DD HH:mm:ss <短时区名>`，中英文仅时区名随 Locale 本地化。
test('instants share one date-time-zone structure across locales and keep 24-hour time', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    assert.equal(
      formatInstant({ value: '2026-09-22T03:16:14Z', locale, timeZone: 'Asia/Shanghai' }),
      '2026-09-22 11:16:14 GMT+8'
    );
    assert.equal(
      formatInstant({ value: '2026-09-22T00:05:09+00:00', locale, timeZone: 'UTC' }),
      '2026-09-22 00:05:09 UTC'
    );
    assert.match(
      formatInstant({ value: '2026-09-22T03:16:14.123Z', locale }),
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \S+$/
    );
  }
  assert.equal(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'zh-CN', timeZone: 'America/Los_Angeles' }),
    '2026-01-01 17:30:00 GMT-8'
  );
});

test('numbers and money retain large integers, trailing zeros and negative zero', () => {
  assert.equal(
    formatNumber({ value: '123456789012345678901234567890.0012300', locale: 'en' }),
    '123,456,789,012,345,678,901,234,567,890.0012300'
  );
  assert.equal(formatNumber({ value: '-0.00', locale: 'zh-CN' }), '-0.00');
  assert.equal(
    formatMoney({ value: '12345678901234567890.40', currency: 'USD', locale: 'en' }),
    '$12,345,678,901,234,567,890.40'
  );
  assert.equal(formatMoney({ value: '1200.500', currency: 'EUR', locale: 'en' }), '€1,200.500');
});

test('invalid values produce localized safe text rather than leaking the supplied input', () => {
  assert.equal(formatDate({ value: '2026-02-30', locale: 'zh-CN' }), '暂时无法显示此内容。');
  assert.equal(
    formatInstant({ value: '2026-01-02T01:30:00Z', locale: 'en', timeZone: 'Mars/Olympus' }),
    'This content is temporarily unavailable.'
  );
  for (const value of ['1e3', '12\n', '<script>secret</script>']) {
    assert.equal(formatNumber({ value, locale: 'en' }), 'This content is temporarily unavailable.');
  }
  assert.equal(formatMoney({ value: '12.00', currency: '', locale: 'zh-CN' }), '暂时无法显示此内容。');
  assert.equal(formatInstant({ value: '2026-02-30T01:30:00Z', locale: 'zh-CN' }), '暂时无法显示此内容。');
  assert.equal(
    formatInstant({ value: '2026-01-02 01:30:00', locale: 'en' }),
    'This content is temporarily unavailable.'
  );
});
