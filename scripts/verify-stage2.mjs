/* eslint-disable no-await-in-loop -- 顺序等待环境方同轮 Audit 结果。 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';

// 前端只执行本仓 Chrome 场景并等候环境方 Audit 只读结果，不启动或清理后端。
const output = resolve(process.argv[2]);
mkdirSync(output, { mode: 0o700 });
const result = { kind: 'stage2-execution', status: 'failed', stages: [] };
try {
  const configPath = process.env.SF_STAGE2_CONFIG;
  assert.equal(statSync(configPath).mode % 64, 0);
  const config = JSON.parse(readFileSync(configPath));
  const security = JSON.parse(readFileSync(config.securityConfig));
  const oauth = JSON.parse(readFileSync(config.oauthConfig));
  assert.equal(security.stage2, true);
  assert.equal(oauth.stage2, true);
  assert.equal(security.handoff, oauth.handoff);
  assert.equal(security.passwordFile, oauth.passwordFile);
  const handoff = JSON.parse(readFileSync(security.handoff));
  result.runId = handoff.runId;
  const run = (name, script, { args, env = {} }) => {
    const child = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, ...env },
      stdio: 'inherit',
      timeout: 30 * 60 * 1000
    });
    result.stages.push({ name, status: child.status === 0 ? 'passed' : 'failed', exitCode: child.status });
    assert.equal(child.status, 0, 'CHILD_STAGE_FAILED');
  };
  run('main-chain-security-locale-lifecycle', 'scripts/verify-token-security.mjs', {
    args: [resolve(output, 'security')],
    env: { SF_SECURITY_CONFIG: config.securityConfig }
  });
  run('oauth-lifecycle-and-recovery', 'scripts/verify-oauth-lifecycle.mjs', {
    args: [resolve(output, 'oauth')],
    env: { SF_OAUTH_CONFIG: config.oauthConfig }
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      JSON.parse(readFileSync(config.auditReport));
      JSON.parse(readFileSync(config.runtimeReport));
      break;
    } catch {
      await delay(1000);
    }
  }
  const manifest = {
    handoff: security.handoff,
    reports: {
      security: resolve(output, 'security/security.json'),
      oauth: resolve(output, 'oauth/oauth.json'),
      recovery: resolve(output, 'oauth/oauth.json'),
      audit: config.auditReport,
      runtime: config.runtimeReport
    }
  };
  const input = resolve(output, 'manifest.json');
  writeFileSync(input, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
  run('four-criteria-correlation', 'scripts/stage2-aggregate.mjs', {
    args: [input, resolve(output, 'aggregate.json')]
  });
  result.status = 'passed';
} catch {
  process.exitCode = 1;
} finally {
  writeFileSync(resolve(output, 'execution.json'), JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: result.status, stages: result.stages }));
}
