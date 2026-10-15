import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const required = {
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
const services = [
  'gateway',
  'iam-service',
  'tenant-access-service',
  'entitlement-service',
  'audit-service',
  'project-service',
  'remote-delivery-service'
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha256 = value => /^[0-9a-f]{64}$/.test(value);
const commit = value => /^[0-9a-f]{40}$/.test(value);
const read = path => {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes), sha256: hash(bytes) };
};
const time = value => {
  const parsed = Date.parse(value);
  assert.ok(Number.isFinite(parsed));
  return parsed;
};

const result = {
  schemaVersion: 1,
  kind: 'stage4-fresh-aggregate',
  scope: 'stage4-fresh',
  status: 'failed',
  gates: ['fresh-handoff', 'chrome-stable-source', 'backend-ci', 'api-client-ci', 'frontend-ci'].map(name => ({
    name,
    status: 'not_run'
  })),
  checks: Object.entries(required).flatMap(([suite, names]) => names.map(name => ({ suite, name, status: 'not_run' })))
};
try {
  const input = read(process.argv[2]).value;
  const handoff = read(input.handoff);
  const receipt = handoff.value;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.status, 'ready');
  assert.match(receipt.runId, /^[0-9a-f-]{36}$/);
  assert.equal(receipt.isolation?.kind, 'fresh-compose');
  assert.equal(receipt.isolation.project, `sf-acceptance-${receipt.runId}`);
  assert.equal(receipt.isolation.network, `${receipt.isolation.project}_default`);
  for (const volume of ['postgres-data', 'redis-data', 'kafka-data']) {
    assert.ok(receipt.isolation.volumes.includes(`${receipt.isolation.project}_${volume}`));
  }
  assert.equal(receipt.cleanup?.owner, 'environment-preparer');
  assert.equal(receipt.cleanup?.automatic, false);
  assert.equal(receipt.backend?.jdkMajor, 17);
  assert.ok(commit(receipt.backend.commit));
  assert.equal(receipt.backend.dirty, false);
  for (const service of services) {
    const matches = receipt.backend.images.filter(image => image.service === service);
    assert.equal(matches.length, 1);
    assert.match(matches[0].imageId, /^sha256:[0-9a-f]{64}$/);
    assert.ok(matches[0].containerId);
  }
  const readyAt = time(receipt.readyAt);
  const expiresAt = time(receipt.expiresAt);
  assert.ok(expiresAt > readyAt);
  Object.assign(result, {
    runId: receipt.runId,
    handoffSha256: handoff.sha256,
    backend: { commit: receipt.backend.commit, jdkMajor: 17 },
    isolation: receipt.isolation
  });
  result.gates[0].status = 'passed';

  const sources = {};
  for (const [suite, names] of Object.entries(required)) {
    const reportSource = read(input.reports[suite]);
    sources[suite] = reportSource.sha256;
    const report = reportSource.value;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.kind, `stage4-${suite}`);
    assert.equal(report.runId, receipt.runId);
    assert.equal(report.handoffSha256, handoff.sha256);
    assert.ok(time(report.startedAt) >= readyAt);
    assert.ok(time(report.finishedAt) >= time(report.startedAt));
    assert.ok(time(report.finishedAt) <= expiresAt);
    assert.ok(Array.isArray(report.checks));
    assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
    for (const name of names) {
      const entry = report.checks.find(check => check.name === name);
      if (entry) result.checks.find(check => check.suite === suite && check.name === name).status = entry.status;
    }
    assert.equal(report.status, 'passed');
    assert.ok(report.checks.length >= names.length);
    assert.ok(report.checks.every(check => check.status === 'passed'));
    assert.ok(result.checks.filter(check => check.suite === suite).every(check => check.status === 'passed'));
    if (suite === 'browser') {
      assert.match(report.chrome, /^\d+\.\d+\.\d+\.\d+$/);
      assert.ok(commit(report.frontend?.commit));
      assert.equal(report.frontend.dirty, false);
      assert.equal(report.frontend.versionSource, 'served-html-provenance-matched');
      assert.ok(sha256(report.frontend.lockSha256));
      assert.ok(sha256(report.frontend.sourceSha256));
      assert.equal(report.remote?.module, 'project');
      assert.match(report.remote.version, /^\d+\.\d+\.\d+$/);
      assert.ok(sha256(report.remote.entrySha256));
      assert.equal(report.client?.name, '@crane199709/saas-forge-api-client');
      assert.match(report.client.version, /^\d+\.\d+\.\d+$/);
      const [major, minor, patch] = report.client.version.split('.').map(Number);
      assert.ok(major > 0 || minor > 5 || (minor === 5 && patch > 0));
      assert.ok(commit(report.client.sourceCommit));
      assert.ok(Object.values(report.driverSha256 ?? {}).length > 0);
      assert.ok(Object.values(report.driverSha256).every(sha256));
      result.frontend = report.frontend;
      result.client = report.client;
      result.remote = report.remote;
      result.chrome = report.chrome;
    }
  }
  result.sources = sources;
  const chromeRelease = input.chromeRelease;
  result.gates[1].status = chromeRelease ? 'failed' : 'not_run';
  assert.equal(chromeRelease.version, result.chrome);
  assert.match(chromeRelease.url, /^https:\/\/chromereleases\.googleblog\.com\/\d{4}\/\d{2}\//);
  assert.ok(time(chromeRelease.checkedAt) <= time(read(input.reports.browser).value.startedAt));
  assert.ok(time(read(input.reports.browser).value.startedAt) - time(chromeRelease.checkedAt) <= 48 * 60 * 60 * 1000);
  result.chromeRelease = chromeRelease;
  result.gates[1].status = 'passed';

  const ci = read(input.ci);
  for (const [name, repository, expectedCommit, gate] of [
    ['backend', 'saas-forge', receipt.backend.commit, 2],
    ['apiClient', 'saas-forge', receipt.backend.commit, 3],
    ['frontend', 'saas-forge-web', result.frontend.commit, 4]
  ]) {
    const entry = ci.value[name];
    result.gates[gate].status = entry ? 'failed' : 'not_run';
    assert.equal(entry.commit, expectedCommit);
    assert.equal(entry.conclusion, 'success');
    assert.match(entry.url, new RegExp(`^https://github\\.com/crane199709/${repository}/actions/runs/[0-9]+$`));
    result.gates[gate].status = 'passed';
  }
  result.ciSha256 = ci.sha256;
  result.status = 'passed';
} catch {
  result.reason = 'STAGE4_EVIDENCE_REJECTED';
  process.exitCode = 1;
}
result.finishedAt = new Date().toISOString();
try {
  writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600
  });
} catch {
  process.exitCode = 1;
  result.status = 'failed';
  result.reason = 'STAGE4_OUTPUT_REJECTED';
}
console.log(JSON.stringify({ status: result.status, reason: result.reason }));
