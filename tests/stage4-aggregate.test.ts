/* eslint-disable no-await-in-loop -- CLI 变体顺序执行，避免本机并发进程。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import process from 'node:process';

const runId = '459cf54c-03aa-4394-877a-cfa8fae3f6c6';
const backendCommit = 'a'.repeat(40);
const frontendCommit = 'b'.repeat(40);
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
const cases = {
  browser: [
    'organization-tree-and-membership-association',
    'tenant-role-delegation-and-admin-protection',
    'invitation-new-identity-setup-and-waiting-authorization',
    'invitation-existing-identity-and-wrong-identity-rejection',
    'membership-disable-enable-and-old-session-rejection',
    'password-recovery-all-contexts',
    'platform-role-grant-revoke-and-tenant-session-preservation',
    'tenant-details-expiry-and-closure',
    'brand-five-fields-preview-conflict-and-fallback',
    'example-project-task-ten-crud-allow-deny',
    'zh-en-keyboard-accessibility-and-visual'
  ],
  authority: [
    'fresh-v2-controlled-enablement',
    'cross-tenant-organization-role-data-brand-isolation',
    'concurrent-last-admin-protection',
    'invitation-quota-compensation-and-retry',
    'membership-revocation-and-quota-recovery',
    'password-recovery-fence-and-restart-recovery',
    'platform-historical-token-rejection',
    'tenant-closure-revocation-and-recovery',
    'brand-asset-validation-public-read-disable-cleanup',
    'permission-revocation-immediate-and-authority-failure',
    'example-ten-crud-rls-version-idempotency'
  ],
  audit: [
    'stage4-committed-facts-in-outbox-and-audit',
    'outbox-retry-and-audit-idempotency',
    'failed-transactions-have-no-success-fact',
    'audit-records-exclude-sensitive-material'
  ]
};

function fixture(directory: string) {
  const readyAt = '2026-10-14T01:00:00Z';
  const finishedAt = '2026-10-14T01:30:00Z';
  const handoffPath = join(directory, 'handoff.json');
  const handoff = {
    schemaVersion: 1,
    status: 'ready',
    runId,
    readyAt,
    expiresAt: '2026-10-15T01:00:00Z',
    backend: {
      commit: backendCommit,
      dirty: false,
      jdkMajor: 17,
      images: [
        'gateway',
        'iam-service',
        'tenant-access-service',
        'entitlement-service',
        'audit-service',
        'project-service',
        'remote-delivery-service'
      ].map(service => ({
        service,
        imageId: `sha256:${'c'.repeat(64)}`,
        containerId: service
      }))
    },
    isolation: {
      kind: 'fresh-compose',
      project: `sf-acceptance-${runId}`,
      network: `sf-acceptance-${runId}_default`,
      volumes: ['postgres-data', 'redis-data', 'kafka-data'].map(name => `sf-acceptance-${runId}_${name}`)
    },
    cleanup: { owner: 'environment-preparer', automatic: false }
  };
  writeFileSync(handoffPath, JSON.stringify(handoff));
  const handoffSha256 = sha(readFileSync(handoffPath, 'utf8'));
  const reports: Record<string, string> = {};
  for (const [kind, names] of Object.entries(cases)) {
    const path = join(directory, `${kind}.json`);
    reports[kind] = path;
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        kind: `stage4-${kind}`,
        runId,
        handoffSha256,
        startedAt: readyAt,
        finishedAt,
        status: 'passed',
        checks: names.map(name => ({ name, status: 'passed' })),
        ...(kind === 'browser'
          ? {
              chrome: '155.0.8059.80',
              frontend: {
                commit: frontendCommit,
                dirty: false,
                versionSource: 'served-html-provenance-matched',
                lockSha256: 'd'.repeat(64),
                sourceSha256: 'e'.repeat(64)
              },
              remote: { module: 'project', version: '1.0.0', entrySha256: '1'.repeat(64) },
              client: {
                name: '@crane199709/saas-forge-api-client',
                version: '0.6.0',
                sourceCommit: backendCommit
              },
              driverSha256: { 'stage4-browser.mjs': 'f'.repeat(64) }
            }
          : {})
      })
    );
  }
  const ciPath = join(directory, 'ci.json');
  writeFileSync(
    ciPath,
    JSON.stringify({
      backend: {
        commit: backendCommit,
        conclusion: 'success',
        url: 'https://github.com/crane199709/saas-forge/actions/runs/1'
      },
      apiClient: {
        commit: backendCommit,
        conclusion: 'success',
        url: 'https://github.com/crane199709/saas-forge/actions/runs/3'
      },
      frontend: {
        commit: frontendCommit,
        conclusion: 'success',
        url: 'https://github.com/crane199709/saas-forge-web/actions/runs/2'
      }
    })
  );
  const manifestPath = join(directory, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      handoff: handoffPath,
      reports,
      ci: ciPath,
      chromeRelease: {
        version: '155.0.8059.80',
        checkedAt: '2026-10-14T00:45:00Z',
        url: 'https://chromereleases.googleblog.com/2026/10/stable-channel-update-for-desktop_01668083673.html'
      }
    })
  );
  return { manifestPath, reports, ciPath };
}

function aggregate(directory: string, manifestPath: string) {
  return spawnSync(process.execPath, ['scripts/stage4-aggregate.mjs', manifestPath, join(directory, 'result.json')], {
    encoding: 'utf8'
  });
}

test('阶段 4 同轮 Fresh、真实场景、持久审计与两仓 CI 完整时才能聚合通过', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stage4-complete-'));
  const { manifestPath } = fixture(directory);
  const result = aggregate(directory, manifestPath);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'));
  assert.equal(output.status, 'passed');
  assert.equal(output.scope, 'stage4-fresh');
  assert.equal(output.runId, runId);
});

test('阶段 4 缺场景、失败、跳过、跨轮次、旧 Client 与缺 CI 都阻断聚合', async t => {
  for (const variant of ['missing', 'failed', 'skipped', 'wrong-run', 'old-client', 'missing-ci']) {
    await t.test(variant, () => {
      const directory = mkdtempSync(join(tmpdir(), 'stage4-reject-'));
      const { manifestPath, reports, ciPath } = fixture(directory);
      if (
        variant === 'missing' ||
        variant === 'failed' ||
        variant === 'skipped' ||
        variant === 'wrong-run' ||
        variant === 'old-client'
      ) {
        const report = JSON.parse(readFileSync(reports.browser, 'utf8'));
        if (variant === 'missing') report.checks.pop();
        if (variant === 'failed' || variant === 'skipped') report.checks[0].status = variant;
        if (variant === 'wrong-run') report.runId = 'another-run';
        if (variant === 'old-client') report.client.version = '0.5.0';
        writeFileSync(reports.browser, JSON.stringify(report));
      }
      if (variant === 'missing-ci') {
        const ci = JSON.parse(readFileSync(ciPath, 'utf8'));
        ci.frontend.conclusion = 'queued';
        writeFileSync(ciPath, JSON.stringify(ci));
      }
      const result = aggregate(directory, manifestPath);
      assert.equal(result.status, 1, `${variant}: ${result.stdout}${result.stderr}`);
      assert.equal(JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')).status, 'failed');
    });
  }
});

test('阶段 4 输出不能覆盖已有证据；仅旧 handoff 冒烟无法充作完整聚合', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stage4-output-'));
  const { manifestPath } = fixture(directory);
  const output = join(directory, 'result.json');
  writeFileSync(output, 'original');
  assert.equal(aggregate(directory, manifestPath).status, 1);
  assert.equal(readFileSync(output, 'utf8'), 'original');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.reports = { browser: manifest.reports.browser };
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.equal(
    spawnSync(process.execPath, ['scripts/stage4-aggregate.mjs', manifestPath, join(directory, 'second.json')]).status,
    1
  );
});
