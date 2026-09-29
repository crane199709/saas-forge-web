import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomBytes } from 'node:crypto';

/** 同轮主链使用页面建立第二 Membership，生命周期结束后关闭会话，避免影响后续攻击场景。 */
export async function verifyStage2MainChain(h) {
  const {
    handoff,
    adminPage,
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
    setPhase
  } = h;
  setPhase('stage2-context-switch');
  const other = { ...users[0], name: `Issue189 第二公司 ${handoff.runId}` };
  other.tenantId = await provision(adminPage, other, false);
  const ctx = await context();
  h.report.stage2ContextId = h.contextId(ctx);
  const page = await ctx.newPage();
  const token = observeToken(ctx);
  await login(page, users[0].email, users[0].password);
  await select(page, users[0].name, '公司工作台');
  await select(page, other.name, '公司工作台');
  await Promise.all([
    page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/refresh' && r.status() === 200),
    page.reload()
  ]);
  await page.getByRole('heading', { name: '公司工作台', exact: true }).first().waitFor();
  const claims = () => JSON.parse(Buffer.from(token().split('.')[1], 'base64url').toString());
  assert.equal(claims().tenantId, other.tenantId);
  pass('same-identity-tenant-switch-and-refresh');

  setPhase('stage2-locale');
  await page.getByText(users[0].email, { exact: true }).first().click();
  await page.getByRole('menuitem', { name: '退出登录', exact: true }).click();
  await button(page, '确认').click();
  await input(page, '邮箱').waitFor();
  await input(page, '邮箱').fill(users[0].email);
  await input(page, '密码').fill(users[0].password);
  const writes = [];
  const track = request => {
    if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/'))
      writes.push(request.method());
  };
  page.on('request', track);
  await page.getByLabel('切换语言', { exact: true }).click();
  await page.getByRole('menuitem', { name: 'English', exact: true }).click();
  assert.equal(await input(page, 'Email').inputValue(), users[0].email);
  assert.equal(await input(page, 'Password').inputValue(), users[0].password);
  assert.deepEqual(writes, []);
  page.off('request', track);
  await page.reload();
  await input(page, 'Email').waitFor();
  await input(page, 'Email').fill(users[0].email);
  await input(page, 'Password').fill('Wrong!Stage189Password');
  setPhase('stage2-english-login-error');
  const rejected = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/login' && r.status() === 401);
  await button(page, 'Sign in').click();
  await rejected;
  await page.getByText('The email or password is incorrect.', { exact: true }).waitFor();
  setPhase('stage2-english-login');
  await input(page, 'Password').fill(users[0].password);
  await button(page, 'Sign in').click();
  async function englishSelect(name) {
    await button(page, name).click();
    await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/api/v2/auth/refresh' && r.status() === 200),
      button(page, 'Discard changes and switch').click()
    ]);
    await page.getByRole('heading', { name: 'Company workspace', exact: true }).first().waitFor();
  }
  await englishSelect(users[0].name);
  await englishSelect(other.name);
  await page.reload();
  await page.getByRole('heading', { name: 'Company workspace', exact: true }).first().waitFor();
  pass('locale-english-input-persistence-and-identity-path', {
    originCount: 1,
    locale: 'en',
    inputPreserved: true,
    businessWritesOnLocaleChange: 0
  });

  setPhase('stage2-suspension');
  const oldToken = token();
  const oldCookie = (await ctx.cookies(handoff.apiOrigin)).map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
  h.materials.add(oldCookie);
  const expiresAt = JSON.parse(Buffer.from(oldToken.split('.')[1], 'base64url').toString()).exp * 1000;
  await probe(oldToken, 200);
  await adminPage.goto(`${handoff.consoleOrigin}/tenants/${other.tenantId}`, { waitUntil: 'domcontentloaded' });
  await button(adminPage, '冻结租户').click();
  const suspensionPath = `/api/v1/platform/tenants/${other.tenantId}/suspensions`;
  const responsePromise = adminPage.waitForResponse(
    response => new URL(response.url()).pathname === suspensionPath && response.request().method() === 'POST'
  );
  const requestStartedAt = Date.now();
  await button(adminPage.getByRole('dialog'), '确认').click();
  const suspensionResponse = await responsePromise;
  const suspension = {
    contextId: h.contextId(adminPage.context()),
    pathSha256: createHash('sha256').update(suspensionPath).digest('hex'),
    startedAt: requestStartedAt,
    finishedAt: Date.now(),
    status: suspensionResponse.status(),
    completed: false
  };
  if (suspension.status === 503) {
    suspension.code = (await suspensionResponse.json()).code;
    suspension.retryAfter = suspensionResponse.headers()['retry-after'];
    assert.equal(suspension.code, 'TENANT_SUSPENSION_PENDING');
    assert.match(suspension.retryAfter || '', /^[1-9][0-9]*$/);
  } else assert.equal(suspension.status, 200);
  h.report.suspensionResponse = suspension;
  await button(adminPage, '解除冻结').waitFor();
  await page
    .getByRole('heading', { name: 'Company workspace', exact: true })
    .first()
    .waitFor({ state: 'hidden', timeout: 90000 });
  await page.getByText('The session could not be confirmed. Protected content is hidden.', { exact: true }).waitFor();
  assert.ok(Date.now() < expiresAt);
  await probe(oldToken, 401, 'ACCESS_TOKEN_INVALID');
  await button(adminPage, '解除冻结').click();
  await button(adminPage.getByRole('dialog'), '确认').click();
  await button(adminPage, '冻结租户').waitFor();
  assert.ok(Date.now() < expiresAt);
  await probe(oldToken, 401, 'ACCESS_TOKEN_INVALID');
  const traceId = randomBytes(16).toString('hex');
  const startedAt = new Date().toISOString();
  const oldSession = await fetch(`${h.config.gateway}/api/v2/auth/session`, {
    headers: {
      Cookie: oldCookie,
      Origin: handoff.consoleOrigin,
      'Sec-Fetch-Site': 'same-site',
      traceparent: `00-${traceId}-${randomBytes(8).toString('hex')}-01`
    },
    signal: AbortSignal.timeout(15000),
    redirect: 'error'
  });
  const denied = await oldSession.json();
  h.report.requests.push({
    source: 'independent-probe',
    phase: 'stage2-suspension',
    method: 'GET',
    path: '/api/v2/auth/session',
    traceId,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: oldSession.status,
    code: denied.code
  });
  assert.equal(oldSession.status, 401);
  assert.equal(denied.code, 'SESSION_INVALID');
  await button(page, 'Sign out everywhere in this Console').click();
  await input(page, 'Email').waitFor();
  await input(page, 'Email').fill(users[0].email);
  await input(page, 'Password').fill(users[0].password);
  await button(page, 'Sign in').click();
  await englishSelect(other.name);
  await probe(token(), 200);
  suspension.completed = true;
  pass('suspension-rejects-old-token-resumption-requires-login', {
    oldTokenExpiresAt: new Date(expiresAt).toISOString(),
    oldTokenRejectedAfterResume: true
  });
  await ctx.close();
  setPhase('stage2-complete');
}
