/* eslint-disable no-await-in-loop -- CLI 用例顺序运行以减少本机并发进程。 */
import process from 'node:process';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('聚合 CLI 拒绝将缺少四项直接证据的报告判为成功', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stage2-incomplete-'));
  const input = join(directory, 'input.json');
  writeFileSync(input, JSON.stringify({ status: 'passed', runId: 'historical-run', reports: [] }));
  const result = spawnSync(process.execPath, ['scripts/stage2-aggregate.mjs', input, join(directory, 'result.json')], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /STAGE2_EVIDENCE_REJECTED/);
});

test('缺失输入和不可覆盖输出均传播为非零退出', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stage2-output-'));
  const output = join(directory, 'existing.json');
  writeFileSync(output, 'original evidence');
  const result = spawnSync(process.execPath, ['scripts/stage2-aggregate.mjs', join(directory, 'absent.json'), output], {
    encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /STAGE2_OUTPUT_REJECTED/);
});

test('四项同轮直接证据可关联；失败、跳过、未知错误和历史轮次均阻断退出', async t => {
  const { createHash } = await import('node:crypto');
  const groups = {
    security: [
      'fresh-console-bootstrap-two-tenants-and-real-mail-password-setup',
      'same-identity-tenant-switch-and-refresh',
      'locale-english-input-persistence-and-identity-path',
      'suspension-rejects-old-token-resumption-requires-login',
      'unauthorized-tenant-context',
      'wrong-user-token',
      'rotated-refresh-replay-rejected',
      'replay-revokes-unexpired-token-and-console-hides-workspace',
      'redis-fails-closed-and-console-does-not-blame-password',
      'redis-restored-authoritative-probe-and-console-login'
    ],
    oauth: [
      'same-issuance-replay-cannot-reread-secret',
      'runtime-create-close-refresh-navigation-no-secret-reread',
      'real-overlap-denial-chinese-and-english',
      'second-console-regular-rotation-rejected-with-stable-24h-window',
      'real-service-scope-insufficient',
      'old-secret-expired-new-secret-valid',
      'revocation-rejects-new-token-and-existing-unexpired-token',
      'visible-secret-cleared-on-refresh-leave-and-cross-tab-session-loss',
      'same-run-service-logs-contain-no-known-sensitive-material',
      'request-correlated-errors-and-no-sensitive-browser-storage-or-logs'
    ],
    recovery: [
      'committed-create-response-loss-and-original-actor-recovery',
      'committed-rotation-response-loss-recovery-preserves-overlap',
      'recovery-rejects-second-use-and-other-actor',
      'ten-minute-expiry-injection-rejects-recovery-and-restores'
    ],
    audit: ['SESSION_STARTED', 'TENANT_CREATED', 'TENANT_CONTEXT_SWITCHED'],
    runtime: ['scenario-correlated-runtime-errors']
  };
  const runId = '459cf54c-03aa-4394-877a-cfa8fae3f6c6';
  const handoff = JSON.stringify({
    status: 'ready',
    runId,
    startedAt: '2026-09-29T01:00:00Z',
    expiresAt: '2026-09-30T01:00:00Z',
    isolation: { kind: 'fresh-compose', project: `sf-acceptance-${runId}` },
    backend: { jdkMajor: 17 }
  });
  const digest = createHash('sha256').update(handoff).digest('hex');
  const report = (names: string[]) => ({
    schemaVersion: 1,
    status: 'passed',
    runId,
    handoffSha256: digest,
    startedAt: '2026-09-29T01:01:00Z',
    finishedAt: '2026-09-29T01:02:00Z',
    chrome: '154.0.8037.58',
    client: { version: '0.4.0', sourceCommit: 'e'.repeat(40) },
    driverSha256: { 'synthetic-test-driver.mjs': 'f'.repeat(64) },
    auditObservationsSha256: 'c'.repeat(64),
    observationsSha256: 'c'.repeat(64),
    frontend: { commit: 'a'.repeat(40), dirty: true, sourceSha256: 'b'.repeat(64), lockSha256: 'd'.repeat(64) },
    classification: { unknownErrors: 0, unexpectedRequests: 0 },
    checks: names.map(name => ({ name, status: 'passed' }))
  });
  for (const variant of [
    'complete',
    'failed',
    'skipped',
    'missing',
    'unknown-error',
    'historical-run',
    'wrong-handoff',
    'stale-runtime'
  ]) {
    await t.test(variant, () => {
      const directory = mkdtempSync(join(tmpdir(), 'stage2-synthetic-'));
      const handoffFile = join(directory, 'handoff.json');
      writeFileSync(handoffFile, handoff);
      const reports: Record<string, string> = {};
      for (const [kind, names] of Object.entries(groups)) {
        const value = report(names);
        if (kind === 'security') {
          if (variant === 'failed') value.status = 'failed';
          if (variant === 'skipped') value.checks[0].status = 'skipped';
          if (variant === 'missing') value.checks.pop();
          if (variant === 'unknown-error') value.classification.unknownErrors = 1;
          if (variant === 'historical-run') value.runId = 'different-run';
          if (variant === 'wrong-handoff') value.handoffSha256 = '0'.repeat(64);
        }
        if (kind === 'runtime') {
          Object.assign(value.checks[0], {
            securitySha256:
              variant === 'stale-runtime'
                ? '0'.repeat(64)
                : createHash('sha256').update(readFileSync(reports.security)).digest('hex'),
            oauthSha256: createHash('sha256').update(readFileSync(reports.oauth)).digest('hex')
          });
        }
        reports[kind] = join(directory, `${kind}.json`);
        writeFileSync(reports[kind], JSON.stringify(value));
      }
      const input = join(directory, 'input.json');
      writeFileSync(input, JSON.stringify({ handoff: handoffFile, reports }));
      const child = spawnSync(
        process.execPath,
        ['scripts/stage2-aggregate.mjs', input, join(directory, 'result.json')],
        { encoding: 'utf8' }
      );
      assert.equal(child.status, variant === 'complete' ? 0 : 1);
    });
  }
});
