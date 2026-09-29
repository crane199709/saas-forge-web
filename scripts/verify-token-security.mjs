/* eslint-disable no-await-in-loop -- 同轮业务前置和有界轮询必须顺序执行。 */
import process from 'node:process';
import { Buffer } from 'node:buffer';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { frontendProvenance } from '../build/provenance.ts';
import { verifyStage2MainChain } from './stage2-main-chain.mjs';
import { operationKey, verifyUnauthorizedTenant } from './tenant-context-security.mjs';

// 环境方提供受限配置；此入口不准备后端、不启动应用、不直接操作 Docker 或数据库。
const configFile = process.env.SF_SECURITY_CONFIG;
assert.ok(configFile && statSync(configFile).mode % 64 === 0, 'CONFIG_PERMISSIONS');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const handoffBytes = readFileSync(config.handoff);
const handoff = JSON.parse(handoffBytes);
assert.equal(handoff.status, 'ready');
assert.equal(handoff.isolation.kind, 'fresh-compose');
assert.equal(handoff.isolation.project, `sf-acceptance-${handoff.runId}`);
assert.equal(handoff.backend.jdkMajor, 17);
assert.ok(Date.parse(handoff.expiresAt) > Date.now());
for (const target of [config.gateway, config.mailbox]) {
  const url = new URL(target);
  assert.equal(url.origin, target);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.protocol, 'http:');
}
const output = resolve(process.argv[2]);
mkdirSync(output, { mode: 0o700 });
const report = {
  schemaVersion: 1,
  kind: 'token-security',
  runId: handoff.runId,
  handoffSha256: createHash('sha256').update(handoffBytes).digest('hex'),
  ...frontendProvenance(),
  driverSha256: Object.fromEntries(
    ['verify-token-security.mjs', 'stage2-main-chain.mjs', 'tenant-context-security.mjs'].map(name => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(name, import.meta.url)))
        .digest('hex')
    ])
  ),
  startedAt: new Date().toISOString(),
  status: 'failed',
  checks: [
    'fresh-console-bootstrap-two-tenants-and-real-mail-password-setup',
    'unauthorized-tenant-context',
    'wrong-user-token',
    'rotated-refresh-replay-rejected',
    'replay-revokes-unexpired-token-and-console-hides-workspace',
    'redis-fails-closed-and-console-does-not-blame-password',
    'redis-restored-authoritative-probe-and-console-login'
  ].map(name => ({ name, status: 'not-run' })),
  ...(config.stage2 ? { stage2: true } : {}),
  requests: [],
  errors: []
};
if (config.stage2) {
  report.checks.push(
    ...[
      'same-identity-tenant-switch-and-refresh',
      'locale-english-input-persistence-and-identity-path',
      'suspension-rejects-old-token-resumption-requires-login'
    ].map(name => ({ name, status: 'not-run' }))
  );
}
let phase = 'launch';
const pending = new Set();
const materials = new Set();
const auditObservations = [];
const sessionActors = new Map();
const sessionIds = new Map();
const secret = path => {
  assert.equal(statSync(path).mode % 64, 0, 'SECRET_PERMISSIONS');
  const value = readFileSync(path, 'utf8').trim();
  assert.ok(value && value.length <= 4096, 'SECRET_SIZE');
  materials.add(value);
  return value;
};
const save = () => {
  const value = JSON.stringify(report, null, 2);
  for (const material of materials) assert.ok(!value.includes(material), 'EVIDENCE_CONTAINS_SECRET');
  writeFileSync(resolve(output, 'security.json'), `${value}\n`, { mode: 0o600 });
};
const pass = (name, facts = {}) => {
  const check = report.checks.find(item => item.name === name);
  assert.ok(check, 'UNKNOWN_SCENARIO');
  Object.assign(check, { status: 'passed', ...facts });
  save();
};
const { chromium } = await import(process.env.SF_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: config.httpsPort
    ? [`--host-resolver-rules=MAP *.saas.forge.test 127.0.0.1:${config.httpsPort}`, '--no-proxy-server']
    : []
});
report.chrome = browser.version();
const button = (p, name) => p.getByRole('button', { name, exact: true });
const input = (p, name) => p.getByLabel(name, { exact: true });
let contextSequence = 0;
const contextIds = new WeakMap();
async function context() {
  contextSequence += 1;
  const contextId = contextSequence;
  const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  contextIds.set(ctx, contextId);
  ctx.on('page', page => {
    page.setDefaultTimeout(25000);
    page.on('pageerror', () => report.errors.push({ phase, contextId, kind: 'pageerror', at: Date.now() }));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      let path;
      try {
        path = new URL(message.location().url).pathname;
      } catch {
        /* 无来源的错误仍阻断。 */
      }
      report.errors.push({
        phase,
        kind: 'console',
        contextId,
        path,
        at: Date.now(),
        resourceFailure: /^Failed to load resource: the server responded with a status of (401|503) \(.*\)$/.test(
          message.text()
        )
      });
    });
  });
  ctx.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/api/')) return;
    const record = {
      phase,
      contextId,
      path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id'),
      pathSha256: createHash('sha256').update(path).digest('hex'),
      method: response.request().method(),
      status: response.status(),
      at: Date.now()
    };
    report.requests.push(record);
    if (
      config.stage2 &&
      response.status() < 300 &&
      (/^\/api\/v2\/auth\/(login|refresh)$/.test(path) ||
        (path === '/api/v1/platform/tenants' && response.request().method() === 'POST'))
    ) {
      const task = response
        .json()
        .then(body => {
          if (body.sessionId && body.identity?.identityId) {
            sessionActors.set(contextId, body.identity.identityId);
            sessionIds.set(contextId, body.sessionId);
            if (path.endsWith('/login'))
              auditObservations.push({
                action: 'SESSION_STARTED',
                phase: record.phase,
                startedAt: new Date(response.request().timing().startTime).toISOString(),
                finishedAt: new Date(record.at).toISOString(),
                actor: body.identity.identityId,
                resource: body.sessionId
              });
          } else if (path === '/api/v1/platform/tenants') {
            auditObservations.push({
              action: 'TENANT_CREATED',
              phase: record.phase,
              startedAt: new Date(response.request().timing().startTime).toISOString(),
              finishedAt: new Date(record.at).toISOString(),
              actor: sessionActors.get(contextId),
              resource: body.id
            });
          }
        })
        .catch(() => {
          report.errors.push({ phase, kind: 'audit-observation-failed', at: Date.now() });
        });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    if (config.stage2 && path === '/api/v2/auth/context-selections' && response.status() === 204) {
      const target = response.request().postDataJSON();
      if (target.type === 'TENANT')
        auditObservations.push({
          action: 'TENANT_CONTEXT_SWITCHED',
          phase: record.phase,
          actor: sessionActors.get(contextId),
          resource: sessionIds.get(contextId),
          membership: target.membershipId,
          startedAt: new Date(response.request().timing().startTime).toISOString(),
          finishedAt: new Date(record.at).toISOString()
        });
    }
    if (response.status() >= 400) {
      const task = response
        .json()
        .then(body => {
          record.code = body.code;
        })
        .catch(() => {
          record.code = 'NON_JSON_ERROR';
        });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
  });
  return ctx;
}
function observeToken(ctx) {
  let token;
  ctx.on('response', response => {
    if (response.status() !== 200 || !/\/api\/v2\/auth\/(login|refresh)$/.test(new URL(response.url()).pathname))
      return;
    const observedPhase = phase;
    const task = response
      .json()
      .then(body => {
        if (body.accessToken) {
          token = body.accessToken;
          materials.add(token);
        }
      })
      .catch(() => {
        report.errors.push({ phase: observedPhase, kind: 'token-observation-failed', at: Date.now() });
      });
    pending.add(task);
    task.then(() => pending.delete(task));
  });
  return () => {
    assert.ok(token, 'TOKEN_NOT_OBSERVED');
    return token;
  };
}
async function login(page, email, password) {
  // 已在登录页时直接等待表单，避免重新导航中断正在进行的 bootstrap。
  if (page.url() !== `${handoff.consoleOrigin}/login`)
    await page.goto(`${handoff.consoleOrigin}/login`, { waitUntil: 'domcontentloaded' });
  await input(page, '邮箱').fill(email);
  await input(page, '密码').fill(password);
  await button(page, '登录').click();
}
async function select(page, name, heading) {
  await button(page, name).click();
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/refresh' && r.status() === 200),
    button(page, '放弃未保存内容并切换').click()
  ]);
  await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
}
async function setupPassword(email, password) {
  let message;
  for (let n = 0; n < 60; n += 1) {
    const response = await fetch(`${config.mailbox}/api/v1/messages`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    message = (await response.json()).messages.find(m => m.To.some(t => t.Address === email));
    if (message) break;
    await delay(1000);
  }
  assert.ok(message, 'MAIL_NOT_DELIVERED');
  const response = await fetch(`${config.mailbox}/api/v1/message/${message.ID}`);
  assert.equal(response.status, 200);
  const mail = await response.json();
  const link = (mail.HTML || mail.Text)
    .match(/https:\/\/[^\s"<>]+\/password-setup[^\s"<>]*/)?.[0]
    ?.replaceAll('&amp;', '&');
  assert.ok(link, 'PASSWORD_SETUP_LINK_MISSING');
  assert.equal(new URL(link).origin, handoff.consoleOrigin);
  materials.add(link);
  const ctx = await context();
  const page = await ctx.newPage();
  try {
    await page.goto(link, { waitUntil: 'domcontentloaded' });
    await input(page, '新密码').fill(password);
    await input(page, '确认新密码').fill(password);
    const [established] = await Promise.all([
      page.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/auth/password-setups'),
      button(page, '设置新密码').click()
    ]);
    assert.equal(established.status(), 204);
    await page.getByText('密码已更新，请使用新密码重新登录。', { exact: true }).waitFor();
    await button(page, '返回登录').click();
    await input(page, '邮箱').waitFor();
  } finally {
    await ctx.close();
  }
}
async function provision(page, { name, email, password }, setup = true) {
  await page.goto(`${handoff.consoleOrigin}/tenants`, { waitUntil: 'domcontentloaded' });
  await button(page, '创建租户').click();
  const form = page.getByRole('form', { name: '创建租户', exact: true });
  await input(form, '租户名称').fill(name);
  await button(form, '创建租户').click();
  await page.getByRole('heading', { name: '租户详情', exact: true }).waitFor();
  await button(page, '配置订阅').click();
  await page.getByRole('dialog', { name: '配置订阅', exact: true }).locator('.el-select__wrapper').click();
  await page.getByRole('option', { name: /Issue 185 验收套餐/ }).click();
  await button(page, '确认配置订阅').click();
  await page.getByRole('dialog', { name: '配置订阅', exact: true }).waitFor({ state: 'hidden' });
  await button(page, '核查初始化状态').click();
  await button(page, '初始化管理员').click();
  await input(page, '管理员邮箱').fill(email);
  await button(page, '确认初始化').click();
  await page.getByText('初始化成功', { exact: true }).waitFor();
  const tenantId = new URL(page.url()).pathname.split('/').at(-1);
  if (setup) await setupPassword(email, password);
  return tenantId;
}
async function probe(token, expected, code) {
  const path = '/__test/platform-mechanism/identity';
  const traceId = randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  const response = await fetch(config.gateway + path, {
    headers: { Authorization: `Bearer ${token}`, traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01` },
    signal: AbortSignal.timeout(120000),
    redirect: 'error'
  });
  const body = await response.json();
  const record = {
    path,
    method: 'GET',
    traceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: response.status,
    ...(body.code ? { code: body.code } : {})
  };
  report.requests.push({ phase, source: 'independent-probe', ...record });
  assert.equal(response.status, expected);
  if (code) assert.equal(body.code, code);
  return record;
}
async function redis(state) {
  // 独立环境控制器只响应同轮 requestId；前端不操作服务生命周期。
  const requestId = randomBytes(16).toString('hex');
  writeFileSync(
    resolve(config.controlDirectory, 'request.json'),
    JSON.stringify({ runId: handoff.runId, requestId, state }),
    { mode: 0o600 }
  );
  for (let n = 0; n < 120; n += 1) {
    let result;
    try {
      result = JSON.parse(readFileSync(resolve(config.controlDirectory, 'response.json'), 'utf8'));
    } catch {
      /* 等待环境控制器。 */
    }
    if (result?.requestId === requestId) {
      assert.equal(result.runId, handoff.runId);
      assert.equal(result.state, state);
      assert.equal(result.status, 'passed');
      return result;
    }
    await delay(1000);
  }
  throw new Error('REDIS_CONTROL_TIMEOUT');
}
try {
  phase = 'fresh-console-prerequisites';
  const jwksResponse = await fetch(`${config.gateway}/.well-known/jwks.json`);
  assert.equal(jwksResponse.status, 200);
  const { keys } = await jwksResponse.json();
  const publicKeys = keys.map(key => ({ kid: key.kid, n: key.n, e: key.e })).sort((a, b) => a.kid.localeCompare(b.kid));
  assert.equal(createHash('sha256').update(JSON.stringify(publicKeys)).digest('hex'), handoff.jwksSha256);
  // 先确认验收专用路由存在；缺少构建 overlay 时不能消耗一次性的 Console 前置。
  await probe('wrong-user-token', 401, 'ACCESS_TOKEN_INVALID');

  const admin = await context();
  const page = await admin.newPage();
  await page.goto(`${handoff.consoleOrigin}/login`, { waitUntil: 'domcontentloaded' });
  assert.equal(await page.evaluate(() => window.isSecureContext), true);
  const browserKeys = await page.evaluate(async api => {
    const response = await fetch(`${api}/.well-known/jwks.json`, { credentials: 'omit' });
    if (!response.ok) throw new Error('JWKS_UNAVAILABLE');
    const value = await response.json();
    return value.keys.map(key => ({ kid: key.kid, n: key.n, e: key.e })).sort((a, b) => a.kid.localeCompare(b.kid));
  }, handoff.apiOrigin);
  assert.deepEqual(browserKeys, publicKeys);

  const email = secret(config.adminEmailFile);
  const initial = secret(config.initialPasswordFile);
  const password = config.stage2 ? secret(config.passwordFile) : `Sf185!${randomBytes(20).toString('hex')}`;
  materials.add(password);
  await login(page, email, initial);
  await input(page, '新密码').fill(password);
  await input(page, '确认新密码').fill(password);
  await button(page, '设置新密码').click();
  await input(page, '邮箱').waitFor();
  await login(page, email, password);
  await select(page, '平台管理', '平台工作台');
  assert.deepEqual(JSON.parse(await page.locator('meta[name=sf-build]').getAttribute('content')), frontendProvenance());
  await page.goto(`${handoff.consoleOrigin}/quota-definitions`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  await button(page, '准备额度定义').click();
  await button(page.getByRole('form', { name: '准备额度定义' }), '准备额度定义').click();
  await page.getByRole('heading', { name: '额度定义详情', exact: true }).waitFor();
  await button(page, '激活额度定义').click();
  await page.getByText('已激活', { exact: true }).first().waitFor();
  await page.goto(`${handoff.consoleOrigin}/plans`, { waitUntil: 'domcontentloaded' });
  await button(page, '创建套餐').click();
  const form = page.getByRole('form', { name: '创建套餐', exact: true });
  await input(form, '编码').fill('issue185-plan');
  await input(form, '套餐名称').fill('Issue 185 验收套餐');
  await input(form, 'max_users 上限').fill('5');
  await button(form, '创建套餐').click();
  await page.getByRole('heading', { name: '套餐详情', exact: true }).waitFor();
  await button(page, '激活套餐').click();
  await page.getByText('已激活', { exact: true }).first().waitFor();
  const users = ['a', 'b'].map(key => ({
    email: `member-${key}-${handoff.runId}@example.test`,
    password: `Sf185!${randomBytes(20).toString('hex')}`,
    name: `Issue185 公司${key.toUpperCase()}`
  }));
  for (const user of users) {
    materials.add(user.password);
    user.tenantId = await provision(page, user);
  }
  if (config.stage2) {
    await verifyStage2MainChain({
      handoff,
      config,
      report,
      adminPage: page,
      users,
      context,
      provision,
      login,
      select,
      observeToken,
      probe,
      button,
      input,
      pass,
      materials,
      contextId: ctx => contextIds.get(ctx),
      setPhase: value => {
        report.stage2Windows ??= {};
        if (report.stage2Windows[phase]) report.stage2Windows[phase].finishedAt = new Date().toISOString();
        phase = value;
        report.stage2Windows[phase] = { startedAt: new Date().toISOString() };
      }
    });
  }
  const attacker = await context();
  const owner = await context();
  const ap = await attacker.newPage();
  const op = await owner.newPage();
  const attackerToken = observeToken(attacker);
  await login(ap, users[0].email, users[0].password);
  await select(ap, users[0].name, '公司工作台');
  await login(op, users[1].email, users[1].password);
  await select(op, users[1].name, '公司工作台');
  pass('fresh-console-bootstrap-two-tenants-and-real-mail-password-setup');
  phase = 'unauthorized-tenant-context';
  report.tenantContext = { scenario: 'unauthorized-tenant-context', status: 'failed', requests: [] };
  report.tenantContext = await verifyUnauthorizedTenant({
    records: report.tenantContext.requests,
    attacker,
    owner,
    apiOrigin: handoff.apiOrigin,
    gateway: config.gateway,
    runId: handoff.runId
  });
  pass(phase);
  phase = 'wrong-user-token';
  await probe('wrong-user-token', 401, 'ACCESS_TOKEN_INVALID');
  pass(phase);
  phase = 'refresh-replay';
  const cookies = await attacker.cookies(handoff.apiOrigin);
  const oldCookie = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  materials.add(oldCookie);
  await Promise.all([
    ap.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/refresh' && r.status() === 200),
    ap.reload()
  ]);
  await ap.getByRole('heading', { name: '公司工作台', exact: true }).first().waitFor();
  await Promise.all([...pending]);
  const rotatedCookies = (await attacker.cookies(handoff.apiOrigin))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ');
  assert.notEqual(rotatedCookies, oldCookie, 'REFRESH_NOT_ROTATED');
  const liveToken = attackerToken();
  assert.ok(JSON.parse(Buffer.from(liveToken.split('.')[1], 'base64url')).exp * 1000 > Date.now());
  await probe(liveToken, 200);
  await delay(6000);
  const currentCookie = (await attacker.cookies(handoff.apiOrigin))
    .map(value => `${value.name}=${value.value}`)
    .join('; ');
  const session = await attacker.request.get(`${config.gateway}/api/v2/auth/session`, {
    headers: { Cookie: currentCookie, Origin: handoff.consoleOrigin, 'Sec-Fetch-Site': 'same-site' }
  });
  assert.equal(session.status(), 200);
  const traceId = randomBytes(16).toString('hex');
  report.replayInjection = { startedAt: new Date().toISOString() };
  const replay = await fetch(`${config.gateway}/api/v2/auth/refresh`, {
    method: 'POST',
    headers: {
      Cookie: oldCookie,
      Origin: handoff.consoleOrigin,
      'Sec-Fetch-Site': 'same-site',
      'X-SF-CSRF': '1',
      'If-Match': session.headers().etag,
      'Idempotency-Key': operationKey(),
      'Content-Type': 'application/json',
      traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`
    },
    body: '{}'
  });
  const replayBody = await replay.json();
  report.requests.push({
    phase,
    source: 'independent-probe',
    path: '/api/v2/auth/refresh',
    method: 'POST',
    traceId,
    startedAt: report.replayInjection.startedAt,
    finishedAt: new Date().toISOString(),
    status: replay.status,
    code: replayBody.code
  });
  assert.equal(replay.status, 401);
  assert.equal(replayBody.code, 'SESSION_INVALID');
  pass('rotated-refresh-replay-rejected', { traceId, statusCode: 401, code: 'SESSION_INVALID' });
  assert.ok(JSON.parse(Buffer.from(liveToken.split('.')[1], 'base64url')).exp * 1000 > Date.now());
  await probe(liveToken, 401, 'ACCESS_TOKEN_INVALID');
  await ap.reload();
  // Bootstrap 将已撤销的 Slot 标记为 ENDING，Console 完成登出后回到匿名登录页。
  await input(ap, '邮箱').waitFor();
  await button(ap, '登录').waitFor();
  assert.equal(await ap.getByRole('heading', { name: '公司工作台', exact: true }).count(), 0);
  report.replayInjection.finishedAt = new Date().toISOString();
  pass('replay-revokes-unexpired-token-and-console-hides-workspace', { consoleReturnedToLogin: true });
  await attacker.close();
  await owner.close();
  phase = 'redis-failure';
  const recovery = await context();
  const rp = await recovery.newPage();
  const recoveryToken = observeToken(recovery);
  await login(rp, users[0].email, users[0].password);
  await select(rp, users[0].name, '公司工作台');
  await Promise.all([...pending]);
  await probe(recoveryToken(), 200);
  try {
    report.redisStopped = await redis('stopped');
    await Promise.all([...pending]);
    await probe(recoveryToken(), 503, 'TOKEN_REVOCATION_STATUS_UNAVAILABLE');
    await rp.reload();
    await rp.getByText('无法确认当前会话，已隐藏受保护内容。', { exact: true }).waitFor({ timeout: 120000 });
    assert.equal(await rp.getByText('邮箱或密码不正确。', { exact: true }).count(), 0);
    assert.equal(await rp.getByRole('heading', { name: '公司工作台', exact: true }).count(), 0);
    pass('redis-fails-closed-and-console-does-not-blame-password');
  } finally {
    report.redisRestored = await redis('healthy');
  }
  phase = 'redis-recovery';
  await Promise.all([...pending]);
  await probe(recoveryToken(), 200);
  await button(rp, '退出当前 Console 的全部标签页').click();
  await input(rp, '邮箱').waitFor();
  await login(rp, users[0].email, users[0].password);
  await select(rp, users[0].name, '公司工作台');
  await rp.reload();
  await rp.getByRole('heading', { name: '公司工作台', exact: true }).first().waitFor();
  pass('redis-restored-authoritative-probe-and-console-login');
  if (config.stage2) {
    writeFileSync(config.otherActorFile, JSON.stringify({ email: users[1].email, password: users[1].password }), {
      mode: 0o600,
      flag: 'wx'
    });
  }
  await Promise.all([...pending]);
  await browser.close();
  await Promise.all([...pending]);
  const inWindow = (record, window) =>
    record.at >= Date.parse(window.startedAt) && record.at <= Date.parse(window.finishedAt);
  const expectedSuspensionPending = record => {
    const receipt = report.suspensionResponse;
    return Boolean(
      receipt?.completed &&
      receipt.status === 503 &&
      record.contextId === receipt.contextId &&
      record.pathSha256 === receipt.pathSha256 &&
      record.phase === 'stage2-suspension' &&
      record.method === 'POST' &&
      record.status === 503 &&
      record.code === 'TENANT_SUSPENSION_PENDING' &&
      record.at >= receipt.startedAt &&
      record.at <= receipt.finishedAt
    );
  };
  const expectedStage2 = record =>
    (config.stage2 &&
      record.contextId === report.stage2ContextId &&
      inWindow(record, report.stage2Windows['stage2-english-login-error']) &&
      record.phase === 'stage2-english-login-error' &&
      record.path === '/api/v2/auth/login' &&
      record.method === 'POST' &&
      record.status === 401 &&
      record.code === 'AUTHENTICATION_FAILED') ||
    (config.stage2 &&
      record.contextId === report.stage2ContextId &&
      inWindow(record, report.stage2Windows['stage2-suspension']) &&
      record.phase === 'stage2-suspension' &&
      record.path === '/api/v2/auth/session' &&
      record.method === 'GET' &&
      record.status === 401 &&
      record.code === 'SESSION_INVALID');
  const expected = record =>
    expectedSuspensionPending(record) ||
    expectedStage2(record) ||
    (record.phase === 'refresh-replay' &&
      inWindow(record, report.replayInjection) &&
      record.path === '/api/v2/auth/session' &&
      record.method === 'GET' &&
      record.status === 401 &&
      record.code === 'SESSION_INVALID') ||
    (record.phase === 'redis-failure' &&
      inWindow(record, { startedAt: report.redisStopped.startedAt, finishedAt: report.redisRestored.finishedAt }) &&
      record.path === '/api/v2/auth/session' &&
      record.method === 'GET' &&
      record.status === 503 &&
      ['SESSION_SECURITY_UNAVAILABLE', 'TOKEN_REVOCATION_STATUS_UNAVAILABLE'].includes(record.code));
  const unexpected = report.requests.filter(r => r.source !== 'independent-probe' && r.status >= 400 && !expected(r));
  const unknown = report.errors.filter(
    error =>
      error.kind !== 'console' ||
      !error.resourceFailure ||
      !report.requests.some(
        r =>
          expected(r) &&
          r.phase === error.phase &&
          r.contextId === error.contextId &&
          r.pathSha256 ===
            createHash('sha256')
              .update(error.path || '')
              .digest('hex') &&
          Math.abs(r.at - error.at) < 2000
      )
  );
  report.classification = { unexpectedRequests: unexpected.length, unknownErrors: unknown.length };
  assert.equal(unexpected.length, 0, 'UNEXPECTED_HTTP_FAILURE');
  assert.equal(unknown.length, 0, 'UNKNOWN_BROWSER_ERROR');
  assert.ok(
    report.checks.every(check => check.status === 'passed'),
    'INCOMPLETE_SCENARIOS'
  );
  report.status = 'passed';
} catch (error) {
  report.failure = {
    phase,
    kind: error.name,
    location: error.stack?.match(/(?:verify-token-security|stage2-main-chain)\.mjs:\d+:\d+/)?.[0]
  };
  let diagnostic = String(error.message);
  for (const value of materials) diagnostic = diagnostic.replaceAll(value, '[REDACTED]');
  writeFileSync(resolve(output, 'diagnostic.txt'), diagnostic, { mode: 0o600 });
  const next = report.checks.find(check => check.status === 'not-run');
  if (next) next.status = 'failed';
  process.exitCode = 1;
} finally {
  await browser.close();
  await Promise.allSettled([...pending]);
  report.finishedAt = new Date().toISOString();
  if (config.stage2)
    writeFileSync(config.auditInput, JSON.stringify({ runId: handoff.runId, observations: auditObservations }), {
      mode: 0o600,
      flag: 'wx'
    });
  if (config.stage2)
    report.auditObservationsSha256 = createHash('sha256').update(readFileSync(config.auditInput)).digest('hex');
  save();
  console.log(JSON.stringify({ status: report.status, phase, checks: report.checks.length }));
}
