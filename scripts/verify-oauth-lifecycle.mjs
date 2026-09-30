/* eslint-disable no-await-in-loop -- 同轮真实业务和故障恢复必须顺序执行。 */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { frontendProvenance } from '../build/provenance.ts';
import { verifyStage2OAuthRecovery } from './stage2-oauth-recovery.mjs';

const configPath = process.env.SF_OAUTH_CONFIG;
assert.ok(configPath);
assert.equal(statSync(configPath).mode % 64, 0);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const handoffBytes = readFileSync(config.handoff);
const handoff = JSON.parse(handoffBytes);
assert.equal(handoff.status, 'ready');
assert.equal(handoff.isolation.kind, 'fresh-compose');
assert.equal(handoff.isolation.project, `sf-acceptance-${handoff.runId}`);
assert.equal(handoff.backend.jdkMajor, 17);
assert.ok(Date.parse(handoff.expiresAt) > Date.now());
assert.equal(new URL(config.gateway).hostname, '127.0.0.1');
assert.equal(new URL(config.gateway).origin, config.gateway);
assert.equal(new URL(config.gateway).protocol, 'http:');
const attempt = randomBytes(4).toString('hex');
const output = resolve(process.argv[2]);
mkdirSync(output, { mode: 0o700 });
const materials = new Set();
const logs = [];
const pending = new Set();
const alias = value => createHash('sha256').update(value).digest('hex');
const report = {
  schemaVersion: 1,
  kind: 'oauth-lifecycle-platform-mechanism',
  runId: handoff.runId,
  handoffSha256: alias(handoffBytes),
  ...frontendProvenance(),
  driverSha256: Object.fromEntries(
    ['verify-oauth-lifecycle.mjs', 'stage2-oauth-recovery.mjs', 'tenant-context-security.mjs'].map(name => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(name, import.meta.url)))
        .digest('hex')
    ])
  ),
  startedAt: new Date().toISOString(),
  status: 'failed',
  checks: [],
  requests: [],
  errors: []
};
let phase = 'launch';
const remember = value => {
  assert.ok(value);
  materials.add(value);
  return value;
};
function secret(path) {
  assert.equal(statSync(path).mode % 64, 0);
  return remember(readFileSync(path, 'utf8').trim());
}
function save() {
  const value = JSON.stringify(report, null, 2);
  for (const material of materials) assert.ok(!value.includes(material), 'EVIDENCE_CONTAINS_SECRET');
  writeFileSync(resolve(output, 'oauth.json'), `${value}\n`, { mode: 0o600 });
}
async function drainResponses() {
  let timeout;
  try {
    await Promise.race([
      Promise.all(pending),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('RESPONSE_BODY_TIMEOUT')), 30000);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
const pass = (name, facts = {}) => {
  report.checks.push({ name, status: 'passed', ...facts });
  save();
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
const input = (page, name) => page.getByRole('textbox', { name, exact: true });
const { chromium } = await import(process.env.SF_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: config.httpsPort
    ? [`--host-resolver-rules=MAP *.saas.forge.test 127.0.0.1:${config.httpsPort}`, '--no-proxy-server']
    : []
});
report.chrome = browser.version();
let contextNumber = 0;
async function context() {
  contextNumber += 1;
  const contextId = contextNumber;
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  ctx.on('page', page => {
    page.setDefaultTimeout(30000);
    page.on('pageerror', () => report.errors.push({ kind: 'pageerror', phase, contextId, at: Date.now() }));
    page.on('console', message => {
      logs.push(message.text());
      if (message.type() === 'error')
        report.errors.push({
          kind: 'console',
          phase,
          contextId,
          at: Date.now(),
          resourceFailure:
            /^(Failed to load resource: the server responded with a status of 409 \(.*\)|Failed to load resource: net::ERR_FAILED)$/.test(
              message.text()
            ),
          path: (() => {
            try {
              return new URL(message.location().url).pathname;
            } catch {
              return '';
            }
          })()
        });
    });
  });
  ctx.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/api/')) return;
    const record = {
      source: 'console',
      phase,
      contextId,
      path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      method: response.request().method(),
      status: response.status(),
      at: Date.now()
    };
    report.requests.push(record);
    if (response.status() >= 400) {
      const task = response
        .json()
        .then(body => {
          record.code = body.code;
        })
        .catch(() => {
          record.code = 'NON_JSON';
        });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
  });
  return ctx;
}
async function login(page, email, password) {
  // 已在登录页时直接等待表单，避免重新导航中断正在进行的 bootstrap。
  if (page.url() !== `${handoff.consoleOrigin}/login`)
    await page.goto(`${handoff.consoleOrigin}/login`, { waitUntil: 'domcontentloaded' });
  await input(page, '邮箱').fill(email);
  await input(page, '密码').fill(password);
  await button(page, '登录').click();
}
async function platform(page) {
  await button(page, '平台管理').click();
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/refresh' && r.status() === 200),
    button(page, '放弃未保存内容并切换').click()
  ]);
  await page.getByRole('heading', { name: '平台工作台', exact: true }).waitFor();
}
async function displayed(page) {
  const field = input(page, '一次性 Secret');
  await field.waitFor();
  return remember(await field.inputValue());
}
async function closeSecret(page) {
  await button(page.getByRole('dialog'), '关闭').focus();
  await page.keyboard.press('Enter');
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
}
async function create(page, label, scope = 'runtime:read') {
  await page.goto(`${handoff.consoleOrigin}/oauth-clients`, { waitUntil: 'domcontentloaded' });
  await button(page, '创建 OAuth Client').focus();
  await page.keyboard.press('Enter');
  const form = page.getByRole('form', { name: '创建 OAuth Client', exact: true });
  await input(form, '名称').fill(`Issue187 ${handoff.runId} ${label}-${attempt}`);
  await form.locator('label').filter({ hasText: scope }).click();
  const [response] = await Promise.all([
    page.waitForResponse(
      r => new URL(r.url()).pathname === '/api/v1/platform/oauth-clients' && r.request().method() === 'POST'
    ),
    button(form, '创建 OAuth Client').click()
  ]);
  assert.equal(response.status(), 201);
  const body = await response.json();
  remember(body.clientSecret);
  const value = await displayed(page);
  assert.equal(value, body.clientSecret);
  return {
    id: body.clientId,
    secret: value,
    scope,
    key: await response.request().headerValue('idempotency-key'),
    name: `Issue187 ${handoff.runId} ${label}-${attempt}`
  };
}
async function credentials(page, id) {
  // 等当前页面请求完成，立即读取新响应体，避免导航销毁上一文档的网络记录。
  await page.waitForLoadState('networkidle');
  const result = page
    .waitForResponse(r => new URL(r.url()).pathname === `/api/v1/platform/oauth-clients/${id}/credential-status`)
    .then(async response => {
      assert.equal(response.status(), 200);
      return response.json();
    });
  await page.goto(`${handoff.consoleOrigin}/oauth-clients/${id}`, { waitUntil: 'domcontentloaded' });
  return result;
}

async function probe(path, options, { expected, client, code }) {
  const traceId = randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  const response = await fetch(config.gateway + path, {
    ...options,
    headers: { ...options.headers, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` },
    signal: AbortSignal.timeout(60000),
    redirect: 'error'
  });
  const body = await response.json();
  const record = {
    source: 'independent-consumer',
    phase,
    path,
    method: options.method,
    traceId,
    client: alias(client.id),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: response.status,
    ...(body.code || body.error ? { code: body.code || body.error } : {})
  };
  report.requests.push(record);
  // 先登记敏感响应，任何断言失败也不会把响应正文写入产物。
  if (body.access_token) remember(body.access_token);
  assert.equal(response.status, expected);
  if (code) assert.equal(record.code, code);
  return body;
}
async function issue(client, key = client.secret, expected = 200) {
  const body = await probe(
    '/oauth2/token',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${remember(Buffer.from(`${client.id}:${key}`).toString('base64'))}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', scope: client.scope })
    },
    { expected, client, code: expected === 401 ? 'CLIENT_CREDENTIALS_INVALID' : undefined }
  );
  return body.access_token;
}
async function consume(client, token, expected = 200) {
  const body = await probe(
    '/__test/platform-mechanism',
    { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
    { expected, client, code: { 401: 'ACCESS_TOKEN_INVALID', 403: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }[expected] }
  );
  if (expected === 200) {
    assert.equal(body.clientId, client.id);
    assert.ok(body.scopes.includes(client.scope));
  }
}
async function storageClean(ctx) {
  for (const page of ctx.pages().filter(p => new URL(p.url()).origin === handoff.consoleOrigin)) {
    const storage = await page.evaluate(async () => {
      const databases = await indexedDB.databases();
      const cachesPresent = await caches.keys();
      return {
        serialized: JSON.stringify([localStorage, sessionStorage]),
        databases: databases.length,
        caches: cachesPresent.length
      };
    });
    for (const value of materials) assert.ok(!storage.serialized.includes(value), 'SECRET_IN_STORAGE');
    assert.equal(storage.databases, 0);
    assert.equal(storage.caches, 0);
  }
  for (const value of materials) assert.ok(!logs.some(line => line.includes(value)), 'SECRET_IN_BROWSER_LOG');
}
async function timeState(client, state) {
  const requestId = randomBytes(16).toString('hex');
  const data = { runId: handoff.runId, requestId, clientId: client.id, operationId: client.operationId, state };
  writeFileSync(resolve(config.controlDirectory, 'request.tmp'), JSON.stringify(data), { mode: 0o600 });
  renameSync(resolve(config.controlDirectory, 'request.tmp'), resolve(config.controlDirectory, 'request.json'));
  for (let i = 0; i < 120; i += 1) {
    let result;
    try {
      result = JSON.parse(readFileSync(resolve(config.controlDirectory, 'response.json')));
    } catch {
      /* 等待环境方。 */
    }
    if (result?.requestId === requestId) {
      assert.equal(result.runId, handoff.runId);
      assert.equal(result.state, state);
      assert.equal(result.status, 'passed');
      return;
    }
    await delay(500);
  }
  throw new Error('TIME_CONTROL_TIMEOUT');
}
let injected = false;
let client;
try {
  phase = 'fresh-console-bootstrap';
  const ctx = await context();
  let adminToken;
  ctx.on('response', response => {
    if (!new URL(response.url()).pathname.startsWith('/api/v2/auth/') || response.status() !== 200) return;
    const task = response
      .json()
      .then(body => {
        if (body.accessToken) adminToken = remember(body.accessToken);
      })
      .catch(() => {});
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  const page = await ctx.newPage();
  await page.goto(`${handoff.consoleOrigin}/login`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  assert.deepEqual(JSON.parse(await page.locator('meta[name=sf-build]').getAttribute('content')), frontendProvenance());
  const keys = await page.evaluate(async api => {
    const r = await fetch(`${api}/.well-known/jwks.json`, { credentials: 'omit' });
    if (!r.ok) throw new Error('JWKS_FAILED');
    return (await r.json()).keys.map(k => ({ kid: k.kid, n: k.n, e: k.e })).sort((a, b) => a.kid.localeCompare(b.kid));
  }, handoff.apiOrigin);
  assert.equal(alias(JSON.stringify(keys)), handoff.jwksSha256);
  const email = secret(config.adminEmailFile);
  const initial = secret(config.initialPasswordFile);
  const password = secret(config.passwordFile);
  if (!config.stage2) {
    await login(page, email, initial);
    await input(page, '新密码').fill(password);
    await input(page, '确认新密码').fill(password);
    await button(page, '设置新密码').click();
    await input(page, '邮箱').waitFor();
  }
  await login(page, email, password);
  await platform(page);
  pass(config.stage2 ? 'same-run-admin-platform-context' : 'fresh-admin-initial-password-change-and-platform-context');

  phase = 'create-and-real-consumption';
  client = await create(page, 'rotation');
  await storageClean(ctx);
  await closeSecret(page);
  await drainResponses();
  assert.ok(adminToken);
  const replay = await probe(
    '/api/v1/platform/oauth-clients',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': client.key
      },
      body: JSON.stringify({ displayName: client.name, allowedScopes: [client.scope] })
    },
    { expected: 409, client, code: 'CLIENT_SECRET_ALREADY_REVEALED' }
  );
  assert.equal(replay.clientSecret, undefined);
  pass('same-issuance-replay-cannot-reread-secret', { client: alias(client.id) });
  const originalToken = await issue(client);
  await consume(client, originalToken);
  await page.reload();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await credentials(page, client.id);
  await page.goto(`${handoff.consoleOrigin}/oauth-clients`, { waitUntil: 'domcontentloaded' });
  await page.goBack();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await page.goForward();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  pass('runtime-create-close-refresh-navigation-no-secret-reread', { client: alias(client.id) });

  phase = 'rotation-and-overlap-rejection';
  const other = await context();
  const second = await other.newPage();
  await login(second, email, password);
  await platform(second);
  await credentials(second, client.id);
  // 暂扣第二个真实 Console 的请求，不伪造权限或响应；首次提交后再放行以覆盖服务端竞态拒绝。
  const cdp = await other.newCDPSession(second);
  let held;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: `*/oauth-clients/${client.id}/secret-rotations`, requestStage: 'Request' }]
  });
  const parked = new Promise(resolveHeld => {
    cdp.on('Fetch.requestPaused', event => {
      if (event.request.method !== 'POST') {
        cdp.send('Fetch.continueRequest', { requestId: event.requestId }).catch(() => {
          report.errors.push({ kind: 'interception-failed', phase });
        });
        return;
      }
      report.delayedRequest = { method: event.request.method, phase };
      held = event.requestId;
      resolveHeld();
    });
  });
  await button(second, '轮换 Secret').click();
  await button(second.getByRole('dialog'), '确认').click();
  await Promise.race([
    parked,
    delay(30000).then(() => {
      throw new Error('ROTATION_NOT_PARKED');
    })
  ]);
  let rotated;
  try {
    await credentials(page, client.id);
    await button(page, '轮换 Secret').click();
    const [response] = await Promise.all([
      page.waitForResponse(
        r =>
          new URL(r.url()).pathname === `/api/v1/platform/oauth-clients/${client.id}/secret-rotations` &&
          r.request().method() === 'POST'
      ),
      button(page.getByRole('dialog'), '确认').click()
    ]);
    assert.equal(response.status(), 200);
    const rotationResult = await response.json();
    remember(rotationResult.clientSecret);
    const rotatedAt = rotationResult.updatedAt;
    rotated = await displayed(page);
    assert.equal(rotated, rotationResult.clientSecret);
    await storageClean(ctx);
    await closeSecret(page);
    await storageClean(ctx);
    const before = await credentials(page, client.id);
    assert.equal(before.canRotate, false);
    assert.equal(Date.parse(before.overlapEndsAt) - Date.parse(rotatedAt), 86400000);
    const denial = second.waitForResponse(
      r =>
        new URL(r.url()).pathname === `/api/v1/platform/oauth-clients/${client.id}/secret-rotations` &&
        r.request().method() === 'POST'
    );
    await cdp.send('Fetch.continueRequest', { requestId: held });
    held = undefined;
    const rejected = await denial;
    assert.equal(rejected.status(), 409);
    assert.equal((await rejected.json()).code, 'CLIENT_SECRET_ROTATION_OVERLAP_ACTIVE');
    await second.getByText('Secret 重叠窗口尚未结束，请等待服务器允许轮换后重试。', { exact: true }).waitFor();
    assert.equal(await second.getByText('操作结果未知，已保留原操作信息并锁定替代请求。', { exact: true }).count(), 0);
    await second.getByLabel('切换语言', { exact: true }).click();
    await second.getByRole('menuitem', { name: 'English', exact: true }).click();
    await second
      .getByText('The Secret overlap window is still active. Wait until the server permits another rotation.', {
        exact: true
      })
      .waitFor();
    await second.getByLabel('Switch Language', { exact: true }).click();
    await second.getByRole('menuitem', { name: '中文', exact: true }).click();
    pass('real-overlap-denial-chinese-and-english');
    const after = await credentials(page, client.id);
    assert.equal(after.overlapEndsAt, before.overlapEndsAt);
    assert.equal(after.canRotate, false);
    assert.equal(await button(page, '轮换 Secret').isDisabled(), true);
    await consume(client, await issue(client));
    await consume(client, await issue(client, rotated));
    pass('second-console-regular-rotation-rejected-with-stable-24h-window', {
      client: alias(client.id),
      rotationUpdatedAt: rotatedAt,
      overlapEndsAt: before.overlapEndsAt,
      denialStatus: 409,
      denialCode: 'CLIENT_SECRET_ROTATION_OVERLAP_ACTIVE',
      credentialsRemainValid: true,
      injection: 'second-real-request-delayed-until-first-commit'
    });
  } finally {
    if (held)
      await cdp.send('Fetch.failRequest', { requestId: held, errorReason: 'Aborted' }).catch(() => {
        report.interceptionCleanup = 'request-already-ended';
      });
    await cdp.send('Fetch.disable');
    await cdp.detach();
  }
  await other.close();

  phase = 'scope-denial';
  const limited = await create(page, 'scope', 'runtime:quota:write');
  await closeSecret(page);
  await consume(limited, await issue(limited), 403);
  pass('real-service-scope-insufficient');

  phase = 'overlap-expiry-injection';
  injected = true;
  await timeState(client, 'expired');
  try {
    await issue(client, client.secret, 401);
    await consume(client, await issue(client, rotated));
    const expired = await credentials(page, client.id);
    assert.equal(expired.canRotate, true);
    pass('old-secret-expired-new-secret-valid', { client: alias(client.id), actualWait24Hours: false });
  } finally {
    await timeState(client, 'restored');
    injected = false;
  }

  phase = 'revocation';
  const current = await issue(client, rotated);
  await consume(client, current);
  const expiresAt = JSON.parse(Buffer.from(current.split('.')[1], 'base64url').toString()).exp;
  await credentials(page, client.id);
  await button(page, '吊销').click();
  const [revoked] = await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname.includes(client.id) && r.request().method() === 'POST'),
    button(page.getByRole('dialog'), '确认').click()
  ]);
  assert.equal(revoked.status(), 204);
  assert.ok(expiresAt * 1000 > Date.now());
  await issue(client, rotated, 401);
  await consume(client, current, 401);
  pass('revocation-rejects-new-token-and-existing-unexpired-token', { client: alias(client.id), expiresAt });

  phase = 'oauth-accessibility-and-keyboard';
  await page.evaluate(readFileSync(new URL(import.meta.resolve('axe-core/axe.min.js')), 'utf8'));
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document.getElementById('app'), { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] });
    return result.violations.map(v => ({ id: v.id, impact: v.impact, count: v.nodes.length }));
  });
  assert.deepEqual(violations, []);
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  pass('real-oauth-detail-accessibility-and-keyboard-create-close', {
    violations: 0,
    scope: 'product-app-root',
    developerToolsExcluded: true
  });

  if (config.stage2) {
    let actorContext;
    let actorPage;
    let actorEmail;
    let actorLoginAttempted = false;
    let otherActorToken;
    async function cleanupActor() {
      try {
        if (actorLoginAttempted) {
          assert.equal(await input(actorPage, '邮箱').isVisible(), false, 'OTHER_ACTOR_SESSION_CLEANUP_UNCONFIRMED');
          await actorPage.getByText(actorEmail, { exact: true }).first().click();
          await actorPage.getByRole('menuitem', { name: '退出登录', exact: true }).click();
          await button(actorPage.getByRole('dialog'), '确认').click();
          await input(actorPage, '邮箱').waitFor();
        }
        report.otherActorSessionCleanup = { status: 'passed' };
      } catch (error) {
        report.otherActorSessionCleanup = { status: 'failed', kind: error.name };
        throw error;
      } finally {
        await actorContext?.close();
      }
    }
    try {
      if (config.otherActorAuthorized) {
        phase = 'other-actor-platform-login';
        report.phase = phase;
        save();
        assert.equal(statSync(config.otherActorFile).mode % 64, 0);
        const actor = JSON.parse(readFileSync(config.otherActorFile));
        remember(actor.password);
        actorContext = await context();
        actorContext.on('response', response => {
          if (new URL(response.url()).pathname !== '/api/v2/auth/refresh' || response.status() !== 200) return;
          const task = response.json().then(body => {
            otherActorToken = remember(body.accessToken);
          });
          pending.add(task);
          task.finally(() => pending.delete(task));
        });
        actorEmail = actor.email;
        actorPage = await actorContext.newPage();
        actorLoginAttempted = true;
        await login(actorPage, actor.email, actor.password);
        await platform(actorPage);
        report.phase = 'other-actor-response-bodies';
        save();
        await drainResponses();
        const identity = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).identityId;
        assert.match(identity(otherActorToken), /^[0-9a-f-]{36}$/);
        assert.match(identity(adminToken), /^[0-9a-f-]{36}$/);
        assert.notEqual(identity(otherActorToken), identity(adminToken));
        report.otherActorPlatformContext = { distinctIdentity: true, selectedThroughConsole: true };
      }
      await verifyStage2OAuthRecovery({
        page,
        ctx,
        handoff,
        button,
        input,
        remember,
        displayed,
        closeSecret,
        credentials,
        issue,
        consume,
        probe,
        timeState,
        pass,
        create,
        report,
        otherActorToken,
        adminToken: () => adminToken,
        currentPhase: () => phase,
        phase: value => {
          phase = value;
          report.phase = phase;
          save();
        }
      });
    } finally {
      await cleanupActor();
    }
  }

  phase = 'secret-visible-refresh-leave-session-loss';
  await create(page, 'refresh');
  await page.reload();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await create(page, 'leave');
  await page.goto(`${handoff.consoleOrigin}/plans`, { waitUntil: 'domcontentloaded' });
  await page.goBack();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await create(page, 'session');
  const logout = await ctx.newPage();
  await logout.goto(`${handoff.consoleOrigin}/oauth-clients`, { waitUntil: 'domcontentloaded' });
  await logout.getByText(email, { exact: true }).first().click();
  await logout.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await button(logout.getByRole('dialog'), '确认').click();
  await input(logout, '邮箱').waitFor();
  await input(page, '邮箱').waitFor();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await page.goBack();
  await input(page, '一次性 Secret').waitFor({ state: 'hidden' });
  await storageClean(ctx);
  pass('visible-secret-cleared-on-refresh-leave-and-cross-tab-session-loss');

  phase = 'error-and-privacy-audit';
  await timeState(client, 'logs');
  const serviceLogs = readFileSync(resolve(config.controlDirectory, 'service-logs.txt'), 'utf8');
  for (const value of materials) assert.ok(!serviceLogs.includes(value), 'SECRET_IN_SERVICE_LOGS');
  pass('same-run-service-logs-contain-no-known-sensitive-material');

  await drainResponses();
  const denied = report.requests.filter(r => r.source === 'console' && r.status >= 400);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].code, 'CLIENT_SECRET_ROTATION_OVERLAP_ACTIVE');
  const unexpected = report.errors.filter(
    error =>
      !(
        config.stage2 &&
        error.kind === 'console' &&
        error.resourceFailure &&
        report.responseLosses?.some(
          loss => loss.phase === error.phase && loss.path === error.path && Math.abs(loss.at - error.at) < 3000
        )
      ) &&
      !(
        error.kind === 'console' &&
        error.resourceFailure &&
        error.phase === 'rotation-and-overlap-rejection' &&
        denied.some(
          r =>
            r.contextId === error.contextId &&
            r.method === 'POST' &&
            r.path === error.path?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id') &&
            r.path.endsWith('/secret-rotations') &&
            Math.abs(r.at - error.at) < 3000
        )
      )
  );
  assert.equal(unexpected.length, 0);
  for (const error of report.errors) error.path = error.path?.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id');
  pass('request-correlated-errors-and-no-sensitive-browser-storage-or-logs', { unexpectedErrors: 0 });
  report.classification = { unknownErrors: 0, unexpectedRequests: 0 };
  assert.ok(
    report.checks.every(check => check.status === 'passed'),
    'INCOMPLETE_SCENARIOS'
  );
  report.status = 'passed';
} catch (error) {
  report.failure = {
    phase,
    kind: error.name,
    location: error.stack?.match(/verify-oauth-lifecycle\.mjs:\d+:\d+/)?.[0]
  };
  let diagnostic = String(error.message);
  for (const material of materials) diagnostic = diagnostic.replaceAll(material, '[REDACTED]');
  writeFileSync(resolve(output, 'diagnostic.txt'), diagnostic, { mode: 0o600 });
  process.exitCode = 1;
} finally {
  if (injected) {
    try {
      await timeState(client, 'restored');
    } catch {
      report.restoration = 'unconfirmed';
      process.exitCode = 1;
    }
  }
  await browser.close();
  try {
    await drainResponses();
  } catch {
    report.status = 'failed';
    report.failure ??= { phase, kind: 'ResponseBodyTimeout' };
    process.exitCode = 1;
  }
  report.finishedAt = new Date().toISOString();
  save();
}
