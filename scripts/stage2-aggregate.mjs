import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import process from 'node:process';

// 四项规格的直接证据缺一不可；历史切片的 passed 不能代替本轮逐场景结果。
const required = {
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
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const load = file => {
  const bytes = readFileSync(file);
  return { data: JSON.parse(bytes), sha256: digest(bytes) };
};
const result = { schemaVersion: 1, kind: 'stage2-fresh-aggregate', status: 'failed', checks: [] };
try {
  const input = load(process.argv[2]).data;
  const handoff = load(input.handoff);
  assert.equal(handoff.data.status, 'ready');
  assert.equal(handoff.data.isolation.kind, 'fresh-compose');
  assert.equal(handoff.data.backend.jdkMajor, 17);
  const { runId, startedAt, expiresAt } = handoff.data;
  assert.equal(handoff.data.isolation.project, `sf-acceptance-${runId}`);
  Object.assign(result, { runId, handoffSha256: handoff.sha256, backend: handoff.data.backend });
  let frontend;
  const sources = {};
  for (const [kind, names] of Object.entries(required)) {
    const evidence = load(input.reports[kind]);
    sources[kind] = evidence;
    const report = evidence.data;
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.runId, runId);
    assert.equal(report.handoffSha256, handoff.sha256);
    assert.equal(report.status, 'passed');
    assert.ok(Date.parse(report.startedAt) >= Date.parse(startedAt));
    assert.ok(Date.parse(report.finishedAt) >= Date.parse(report.startedAt));
    assert.ok(Date.parse(report.finishedAt) <= Date.parse(expiresAt));
    assert.ok(Array.isArray(report.checks) && report.checks.length > 0);
    assert.ok(report.checks.every(check => check.status === 'passed'));
    assert.equal(new Set(report.checks.map(check => check.name)).size, report.checks.length);
    for (const name of names) assert.ok(report.checks.some(check => check.name === name));
    assert.equal(report.classification?.unknownErrors, 0);
    assert.equal(report.classification?.unexpectedRequests, 0);
    if (kind === 'runtime') {
      const scan = report.checks.find(check => check.name === 'scenario-correlated-runtime-errors');
      assert.equal(scan.securitySha256, sources.security.sha256);
      assert.equal(scan.oauthSha256, sources.oauth.sha256);
    }
    if (kind === 'audit') {
      assert.match(report.observationsSha256, /^[0-9a-f]{64}$/);
      assert.equal(report.observationsSha256, sources.security.data.auditObservationsSha256);
    }
    if (!['audit', 'runtime'].includes(kind)) {
      assert.match(report.chrome, /^\d+\.\d+\.\d+\.\d+$/);
      assert.match(report.client?.version, /^\d+\.\d+\.\d+$/);
      assert.match(report.client.sourceCommit, /^[0-9a-f]{40}$/);
      assert.match(report.frontend?.lockSha256, /^[0-9a-f]{64}$/);
      assert.ok(Object.values(report.driverSha256 ?? {}).length > 0);
      for (const value of Object.values(report.driverSha256)) assert.match(value, /^[0-9a-f]{64}$/);
      assert.match(report.frontend?.commit, /^[0-9a-f]{40}$/);
      assert.equal(typeof report.frontend.dirty, 'boolean');
      assert.match(report.frontend.sourceSha256, /^[0-9a-f]{64}$/);
      const source = { ...report.frontend, client: report.client, chrome: report.chrome };
      if (frontend) assert.deepEqual(source, frontend);
      frontend = source;
    }
    result.checks.push({ name: kind, status: 'passed', sha256: evidence.sha256, scenarios: names });
  }
  result.status = 'passed';
} catch {
  result.reason = 'STAGE2_EVIDENCE_REJECTED';
  process.exitCode = 1;
}
result.finishedAt = new Date().toISOString();
try {
  writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
} catch {
  process.exitCode = 1;
  result.status = 'failed';
  result.reason = 'STAGE2_OUTPUT_REJECTED';
}
console.log(JSON.stringify({ status: result.status, reason: result.reason }));
